import asyncio
import ipaddress
import os
import socket
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from browser_use import Agent, BrowserProfile
from langchain_ollama import ChatOllama

app = FastAPI()

BROWSER_AGENT_MODEL = os.environ.get("BROWSER_AGENT_MODEL", "qwen2.5:7b")
BROWSER_AGENT_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_TIMEOUT_S", "90"))
ALLOW_PRIVATE_NET = os.environ.get("BROWSER_AGENT_ALLOW_PRIVATE_NET", "false").lower() == "true"
MAX_CHARS = 8000

# Only one real Chromium instance at a time -- too much for a dual-core CPU
# box to run more than one /browse task concurrently.
_browse_semaphore = asyncio.Semaphore(1)


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
            llm = ChatOllama(model=BROWSER_AGENT_MODEL, num_ctx=8000)
            # Recent browser-use versions check `llm.provider` internally
            # (browser_use/agent/service.py:237) purely to special-case their
            # own hosted LLM wrapper ("flash_mode" for ChatBrowserUse); plain
            # LangChain models like ChatOllama never had that attribute, so
            # this crashes before the agent runs a single step - see
            # browser-use/browser-use#3534 for the same failure against a
            # different LangChain model. Any value other than "browser-use"
            # is safe (it's otherwise only read for telemetry). ChatOllama is
            # a Pydantic model that rejects setting undeclared fields
            # normally, so this bypasses that via object.__setattr__ rather
            # than switching to browser-use's own (cloud-routed) LLM class.
            object.__setattr__(llm, "provider", "langchain_ollama")
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
