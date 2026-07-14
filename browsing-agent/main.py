import asyncio
import ipaddress
import logging
import os
import socket
from urllib.parse import urlparse

import httpx
import requests
import trafilatura
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from browser_use import Agent, BrowserProfile
from browser_use.llm import ChatOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browsing-agent")

app = FastAPI()

BROWSER_AGENT_MODEL = os.environ.get("BROWSER_AGENT_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
BROWSER_AGENT_MAX_TOKENS = int(os.environ.get("BROWSER_AGENT_MAX_TOKENS", "2048"))

# Fail loudly at startup (uvicorn won't even come up) rather than on the
# first /browse call - a missing key should never surface as a confusing
# downstream ChatOpenAI/httpx error.
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required")

# Three separate, nested timeouts in browser-use/this service - each one
# needs headroom over the one it wraps, or the outer one becomes unreachable
# and silently overrides whatever the inner one was set to:
#   llm_timeout   < step_timeout       < BROWSER_AGENT_TIMEOUT_S
#   (one LLM call)  (LLM call + browser  (whole task: N steps, each
#                    action execution)    possibly retried up to 6x)
# step_timeout defaults to 180 inside browser-use itself. Kept generous even
# on OpenAI (fast + reliable) since a slow or rate-limited response is still
# possible and shouldn't be able to hang a request indefinitely.
BROWSER_AGENT_LLM_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_LLM_TIMEOUT_S", "120"))
BROWSER_AGENT_STEP_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_STEP_TIMEOUT_S", "180"))
BROWSER_AGENT_TIMEOUT_S = int(os.environ.get("BROWSER_AGENT_TIMEOUT_S", "600"))
ALLOW_PRIVATE_NET = os.environ.get("BROWSER_AGENT_ALLOW_PRIVATE_NET", "false").lower() == "true"
MAX_CHARS = 8000

# Where the Node backend lives, for the fire-and-forget usage-logging POST
# below - defaults to same-host for local dev; override for docker-compose
# (e.g. http://backend:3000) or a split deployment.
BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:3000")
USAGE_LOG_TIMEOUT_S = 5

# Only one real Chromium instance at a time -- too much for a dual-core CPU
# box to run more than one /browse task concurrently.
_browse_semaphore = asyncio.Semaphore(1)

# Uses OpenAI directly rather than a local Ollama model - browser-use's
# tool-calling/structured-action loop is most thoroughly tested against
# OpenAI models, and gpt-4.1-mini is cheap enough to run per-task while being
# both faster and more reliable than local CPU-bound inference was. The main
# chat model (qwen3.5) is unaffected and stays fully local;
# only this browsing sub-agent's own LLM call goes external.
#
# Uses browser_use.llm.ChatOpenAI (their own native OpenAI wrapper), NOT
# langchain_openai's - browser-use's Agent reads llm.provider/.model_name
# internally (browser_use/agent/service.py:237) and reconstructs a fresh
# plain LangChain object mid-run in at least one internal code path,
# discarding any subclass. This is the exact same failure mode the earlier
# local-Ollama setup hit (twice) with langchain_ollama.ChatOllama - browser-
# use's own native wrapper classes are the only ones guaranteed not to have
# this gap, for any provider, not just Ollama.


class FetchRequest(BaseModel):
    url: str


class BrowseRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task: str
    max_steps: int = 12
    # Purely for usage-log attribution (see _log_usage below) - optional so
    # a manual/test call against this service directly still works.
    user_id: str | None = Field(default=None, alias="userId")


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


# Fire-and-forget: scheduled via asyncio.create_task (not awaited by the
# /browse handler), so a slow or unreachable backend can never delay or
# break the actual /browse response - only ever logged here, never raised.
# agent.token_cost_service accumulates usage across every LLM call browser-
# use made during this run (one per agent step, possibly several), so this
# is the total for the whole task, not just the last step.
async def _log_usage(agent: Agent, user_id: str | None) -> None:
    try:
        summary = await agent.token_cost_service.get_usage_summary()
        async with httpx.AsyncClient(timeout=USAGE_LOG_TIMEOUT_S) as client:
            await client.post(
                f"{BACKEND_URL}/api/usage/log",
                json={
                    "userId": user_id,
                    "kind": "browsing",
                    "model": BROWSER_AGENT_MODEL,
                    "promptTokens": summary.total_prompt_tokens,
                    "completionTokens": summary.total_completion_tokens,
                },
            )
    except Exception as err:
        logger.warning("usage logging failed: %s", err)


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
            llm = ChatOpenAI(
                model=BROWSER_AGENT_MODEL,
                api_key=OPENAI_API_KEY,
                # browser_use.llm.ChatOpenAI's param is max_completion_tokens,
                # not max_tokens (OpenAI's newer chat-completions naming) -
                # langchain_openai used the old name, this class doesn't.
                max_completion_tokens=BROWSER_AGENT_MAX_TOKENS,
            )
            agent = Agent(
                task=req.task,
                llm=llm,
                browser_profile=_build_browser_profile(),
                llm_timeout=BROWSER_AGENT_LLM_TIMEOUT_S,
                step_timeout=BROWSER_AGENT_STEP_TIMEOUT_S,
            )
            result = await asyncio.wait_for(
                agent.run(max_steps=req.max_steps), timeout=BROWSER_AGENT_TIMEOUT_S
            )
            asyncio.create_task(_log_usage(agent, req.user_id))
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="browse_web task timed out")
        except Exception as err:
            # str(err) alone doesn't say *where* it happened - full traceback
            # to the container logs (Coolify's Logs tab) without changing the
            # client-facing response, so a repeat failure is actually debuggable.
            logger.exception("/browse failed")
            raise HTTPException(status_code=500, detail=str(err))
    return {"result": str(result)}
