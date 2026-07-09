import asyncio
import ipaddress
import logging
import os
import socket
from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from browser_use import Agent, BrowserProfile
from browser_use.llm import ChatOllama

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browsing-agent")

app = FastAPI()

BROWSER_AGENT_MODEL = os.environ.get("BROWSER_AGENT_MODEL", "qwen2.5:7b")
# Three separate, nested timeouts in browser-use/this service - each one
# needs headroom over the one it wraps, or the outer one becomes unreachable
# and silently overrides whatever the inner one was set to:
#   llm_timeout   < step_timeout       < BROWSER_AGENT_TIMEOUT_S
#   (one LLM call)  (LLM call + browser  (whole task: N steps, each
#                    action execution)    possibly retried up to 6x)
# step_timeout defaults to 180 inside browser-use itself and was never
# overridden here originally - on slow CPU-only hardware it fired before
# llm_timeout ever got a chance to matter.
BROWSER_AGENT_LLM_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_LLM_TIMEOUT_S", "120"))
BROWSER_AGENT_STEP_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_STEP_TIMEOUT_S", "180"))
BROWSER_AGENT_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_TIMEOUT_S", "600"))
ALLOW_PRIVATE_NET = os.environ.get("BROWSER_AGENT_ALLOW_PRIVATE_NET", "false").lower() == "true"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MAX_CHARS = 8000

# Only one real Chromium instance at a time -- too much for a dual-core CPU
# box to run more than one /browse task concurrently.
_browse_semaphore = asyncio.Semaphore(1)

# Two earlier fixes here (an object.__setattr__ patch, then a subclass
# declaring .provider/.model_name) both worked at Agent-construction time but
# broke again mid-run with the exact same error, on an object literally named
# 'ChatOllama' rather than our subclass - something inside browser-use's
# LangChain-compat path reconstructs a fresh plain ChatOllama internally
# (bind_tools or similar hardcodes the class rather than using type(self)),
# discarding whatever subclass was passed in. browser_use.llm.ChatOllama is
# browser-use's own native Ollama integration (uses the plain `ollama` client
# directly, no LangChain at all) - it's the class their Agent actually
# expects, so none of these gaps exist in the first place.


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
            llm = ChatOllama(
                model=BROWSER_AGENT_MODEL,
                host=OLLAMA_URL,
                ollama_options={"num_ctx": 8000},
            )
            agent = Agent(
                task=req.task,
                llm=llm,
                browser_profile=_build_browser_profile(),
                llm_timeout=BROWSER_AGENT_LLM_TIMEOUT_S,
                step_timeout=BROWSER_AGENT_STEP_TIMEOUT_S,
                # browser-use defaults to use_vision=True, sending a screenshot
                # with every step. BROWSER_AGENT_MODEL is a text-only model
                # (not the vl/vision variant) - it can't use the image, so
                # that's pure wasted encode+context overhead on every single
                # call, on a CPU that's already the bottleneck. Text-only DOM
                # analysis is well-supported by browser-use without vision.
                use_vision=False,
            )
            result = await asyncio.wait_for(
                agent.run(max_steps=req.max_steps), timeout=BROWSER_AGENT_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="browse_web task timed out")
        except Exception as err:
            # str(err) alone doesn't say *where* it happened - full traceback
            # to the container logs (Coolify's Logs tab) without changing the
            # client-facing response, so a repeat failure is actually debuggable.
            logger.exception("/browse failed")
            raise HTTPException(status_code=500, detail=str(err))
    return {"result": str(result)}
