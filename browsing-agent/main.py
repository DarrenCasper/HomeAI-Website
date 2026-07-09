import asyncio
import ipaddress
import os
import socket
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from browser_use import Agent, BrowserProfile
from langchain_ollama import ChatOllama

app = FastAPI()

BROWSER_AGENT_MODEL = os.environ.get("BROWSER_AGENT_MODEL", "qwen2.5:7b")
BROWSER_AGENT_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_TIMEOUT_S", "90"))
ALLOW_PRIVATE_NET = os.environ.get("BROWSER_AGENT_ALLOW_PRIVATE_NET", "false").lower() == "true"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MAX_CHARS = 8000

# Only one real Chromium instance at a time -- too much for a dual-core CPU
# box to run more than one /browse task concurrently.
_browse_semaphore = asyncio.Semaphore(1)


# browser-use's Agent reads both `llm.provider` and `llm.model_name` off
# whatever LLM object it's given, matching the shape of its own/langchain-
# openai-style wrappers. Plain langchain_ollama.ChatOllama exposes neither
# (only `.model`) - see browser-use/browser-use#3752 for the same failure.
# A subclass with these declared is the permanent fix, replacing the earlier
# object.__setattr__ patch which only covered `.provider` and broke again
# the moment browser-use also started reading `.model_name`.
class OllamaLLM(ChatOllama):
    provider: str = Field(default="langchain_ollama")
    model_config = {"extra": "allow"}

    @property
    def model_name(self):
        return self.model


class FetchRequest(BaseModel):
    url: str


class BrowseRequest(BaseModel):
    task: str
    max_steps: int = 12


def _is_private_host(url: str) -> bool:
    try:
        host = urlparse(url).hostname
        if not host:
            return True
        ip = socket.gethostbyname(host)
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except Exception:
        return True  # can't resolve it -> don't blindly allow it through


# block_ip_addresses blocks navigation to any literal-IP URL (covers RFC1918,
# loopback, and 169.254.0.0/16 in one native browser_use flag); prohibited_domains
# additionally covers internal hostnames that aren't raw IPs, including
# Tailscale's own MagicDNS suffix - a prompt-injected page could otherwise
# redirect the agent straight at this homelab over the tailnet.
def _build_browser_profile() -> BrowserProfile:
    if ALLOW_PRIVATE_NET:
        return BrowserProfile()
    return BrowserProfile(
        block_ip_addresses=True,
        prohibited_domains=["localhost", "*.local", "*.internal", "*.lan", "*.ts.net"],
    )


def _beautifulsoup_fallback(url: str) -> str:
    resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return " ".join(soup.get_text(separator=" ").split())


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/fetch")
async def fetch_page(req: FetchRequest):
    if not ALLOW_PRIVATE_NET and _is_private_host(req.url):
        raise HTTPException(status_code=400, detail="Refusing to fetch a private/internal address")

    text = None
    downloaded = trafilatura.fetch_url(req.url)
    if downloaded:
        text = trafilatura.extract(downloaded)

    if not text:
        try:
            text = _beautifulsoup_fallback(req.url)
        except Exception as err:
            return {"text": "", "error": str(err)}

    return {"text": (text or "")[:MAX_CHARS]}


@app.post("/browse")
async def browse(req: BrowseRequest):
    async with _browse_semaphore:
        try:
            # See OllamaLLM above for why this can't be plain ChatOllama.
            llm = OllamaLLM(model=BROWSER_AGENT_MODEL, base_url=OLLAMA_URL, num_ctx=8000)
            agent = Agent(
                task=req.task,
                llm=llm,
                browser_profile=_build_browser_profile(),
            )
            result = await asyncio.wait_for(
                agent.run(max_steps=req.max_steps), timeout=BROWSER_AGENT_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="browse_web task timed out")
        except Exception as err:
            raise HTTPException(status_code=500, detail=str(err))
    return {"result": str(result)}
