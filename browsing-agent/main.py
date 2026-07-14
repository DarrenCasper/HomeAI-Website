import asyncio
import ipaddress
import logging
import os
import socket
import time
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


class WeatherRequest(BaseModel):
    location: str


class DiscoverApiSchemaRequest(BaseModel):
    domain_or_name: str


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


# WMO weather codes (https://open-meteo.com/en/docs) - the forecast API
# returns a numeric code, not a description.
_WMO_DESCRIPTIONS = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "depositing rime fog",
    51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
    56: "light freezing drizzle", 57: "dense freezing drizzle",
    61: "slight rain", 63: "moderate rain", 65: "heavy rain",
    66: "light freezing rain", 67: "heavy freezing rain",
    71: "slight snow fall", 73: "moderate snow fall", 75: "heavy snow fall",
    77: "snow grains",
    80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
    85: "slight snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
}


# get_weather is a dedicated tool (not a registry entry) because it's two
# chained calls - geocode the location name to coordinates, then look up
# the forecast for those coordinates - which the generic single-endpoint
# registry caller (backend/src/lib/apiRegistry.js) doesn't support.
# Open-Meteo needs no API key for either endpoint.
async def _get_weather(location: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        geo_resp = await client.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": location, "count": 1},
        )
        geo_resp.raise_for_status()
        results = geo_resp.json().get("results") or []
        if not results:
            raise ValueError(f'No location found matching "{location}"')
        place = results[0]

        forecast_resp = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
                "temperature_unit": "celsius",
            },
        )
        forecast_resp.raise_for_status()
        current = forecast_resp.json().get("current") or {}

    code = current.get("weather_code")
    description = _WMO_DESCRIPTIONS.get(code, "unknown conditions")
    place_name = ", ".join(filter(None, [place.get("name"), place.get("admin1"), place.get("country")]))

    return {
        "place": place_name,
        "summary": (
            f"{place_name}: {description}, {current.get('temperature_2m')}°C "
            f"(feels like {current.get('apparent_temperature')}°C), "
            f"wind {current.get('wind_speed_10m')} km/h"
        ),
    }


# In-memory cache for APIs.guru's directory (a large, slow-changing file) -
# see _get_apis_guru_list below.
_apis_guru_cache = {"data": None, "fetched_at": 0.0}
APIS_GURU_CACHE_TTL_S = 3600

_COMMON_OPENAPI_PATHS = [
    "/openapi.json", "/swagger.json", "/v1/openapi.json",
    "/v2/swagger.json", "/.well-known/openapi.json", "/docs/openapi.json",
]
# Response text is JSON at this point, not HTML - MAX_CHARS above is sized
# for scraped page text, so the summary gets its own (larger) cap.
MAX_SCHEMA_SUMMARY_PATHS = 20


async def _get_apis_guru_list() -> dict:
    now = time.time()
    if _apis_guru_cache["data"] is not None and now - _apis_guru_cache["fetched_at"] < APIS_GURU_CACHE_TTL_S:
        return _apis_guru_cache["data"]

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get("https://api.apis.guru/v2/list.json")
        resp.raise_for_status()
        data = resp.json()

    _apis_guru_cache["data"] = data
    _apis_guru_cache["fetched_at"] = now
    return data


def _extract_base_url(spec: dict) -> str | None:
    if spec.get("servers"):
        return spec["servers"][0].get("url")
    if spec.get("host"):
        scheme = (spec.get("schemes") or ["https"])[0]
        return f"{scheme}://{spec['host']}{spec.get('basePath', '')}"
    return None


# Specs can be huge (hundreds of paths, deeply nested $refs) - this pulls
# out exactly what a propose_api draft needs (real param names/types/auth
# from the actual spec) rather than handing the whole thing to the model,
# and caps how many paths it summarizes so one enormous API doesn't blow
# out the tool-result budget.
def _summarize_openapi_spec(spec: dict) -> dict:
    is_v3 = "openapi" in spec
    security_schemes = (
        (spec.get("components") or {}).get("securitySchemes", {}) if is_v3 else spec.get("securityDefinitions", {})
    )

    paths_summary = []
    for path, methods in list((spec.get("paths") or {}).items())[:MAX_SCHEMA_SUMMARY_PATHS]:
        if not isinstance(methods, dict):
            continue
        for method, op in methods.items():
            if method.lower() not in ("get", "post", "put", "delete", "patch") or not isinstance(op, dict):
                continue
            params = []
            for p in op.get("parameters") or []:
                if not isinstance(p, dict):
                    continue
                schema = p.get("schema") or {}
                params.append({
                    "name": p.get("name"),
                    "in": p.get("in"),
                    "required": bool(p.get("required")),
                    "type": schema.get("type") or p.get("type"),
                })
            paths_summary.append({"path": path, "method": method.upper(), "params": params})

    return {
        "found": True,
        "title": (spec.get("info") or {}).get("title"),
        "baseUrl": _extract_base_url(spec),
        "authSchemes": list(security_schemes.keys()),
        "paths": paths_summary,
    }


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


@app.post("/weather")
async def weather(req: WeatherRequest):
    try:
        return await _get_weather(req.location)
    except ValueError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as err:
        logger.exception("/weather failed")
        raise HTTPException(status_code=502, detail=str(err))


# Upstream of propose_api - tries structured, scrape-resistant sources
# before the calling model ever resorts to browse_web on a docs page.
# Deliberately does NOT fall back to browse_web itself on a miss: that's
# the model's call to make (see the discover_api_schema tool description
# in backend/src/lib/ollama.js), this just reports found: false and stops.
@app.post("/discover-api-schema")
async def discover_api_schema(req: DiscoverApiSchemaRequest):
    query = req.domain_or_name.strip().lower()
    if not query:
        raise HTTPException(status_code=400, detail="domain_or_name is required")

    # (a) APIs.guru directory - a curated index of known OpenAPI specs,
    # keyed by provider domain, with each entry's own title to also match
    # against (so a common name like "OpenWeather" can resolve even if the
    # caller doesn't know the exact registered domain).
    try:
        directory = await _get_apis_guru_list()
        match_key = None
        for key, entry in directory.items():
            preferred = entry.get("preferred")
            title = ""
            if preferred:
                title = ((entry.get("versions") or {}).get(preferred, {}).get("info") or {}).get("title", "")
            if query in key.lower() or (title and query in title.lower()):
                match_key = key
                break

        if match_key:
            version_info = directory[match_key]["versions"][directory[match_key]["preferred"]]
            swagger_url = version_info.get("swaggerUrl")
            if swagger_url:
                async with httpx.AsyncClient(timeout=20) as client:
                    spec_resp = await client.get(swagger_url)
                    spec_resp.raise_for_status()
                    return _summarize_openapi_spec(spec_resp.json())
    except Exception as err:
        logger.warning("APIs.guru lookup failed: %s", err)

    # (b) common OpenAPI spec paths directly on the domain - same
    # private-network guard as /fetch, since query is caller-influenced
    # and this makes outbound requests to it.
    domain = query if query.startswith("http") else f"https://{query}"
    domain = domain.rstrip("/")
    if not ALLOW_PRIVATE_NET and _is_private_host(domain):
        return {"found": False}

    async with httpx.AsyncClient(timeout=8) as client:
        for candidate_path in _COMMON_OPENAPI_PATHS:
            try:
                resp = await client.get(f"{domain}{candidate_path}")
                if resp.status_code != 200:
                    continue
                spec = resp.json()
                if isinstance(spec, dict) and ("openapi" in spec or "swagger" in spec):
                    return _summarize_openapi_spec(spec)
            except Exception:
                continue

    # (c) nothing found - the calling model decides whether to try
    # browse_web next, and should expect that to sometimes fail too.
    return {"found": False}


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
