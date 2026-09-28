"""Model price lookup against LiteLLM's public price database.

Prices are normalized to CNY per 1M tokens (LiteLLM lists USD per token).
Fetching is best-effort: the JSON lives on GitHub raw, which is slow or
blocked on some networks, so every caller must treat failure as "no price
data" and fall back to manual entry. Set OPEN_NOTEBOOK_USD_CNY to override
the exchange rate used for the conversion.
"""

import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

PRICE_DB_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)
PRICE_DB_TIMEOUT_SECONDS = 15.0
PRICE_DB_CACHE_TTL_SECONDS = 6 * 3600
USD_TO_CNY_DEFAULT = 7.2

# Set once a fetch succeeds so callers within the TTL don't re-pay the download.
_cache: Dict[str, Any] = {"db": None, "fetched_at": 0.0}

# Official vendor price lists for models LiteLLM does not carry. Prices are
# already CNY per 1M tokens (real-time inference, cache-miss input; batch
# inference is typically half price). Longest pattern wins so
# "mimo-v2.6-pro-ultraspeed" is matched before "mimo-v2.6-pro".
# Source: https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go
OFFICIAL_PRICE_TABLES: Dict[str, Tuple[Tuple[str, float, float], ...]] = {
    "xiaomi_mimo": (
        ("mimo-v2.6-pro-ultraspeed", 30.0, 60.0),
        ("mimo-v2.6-pro", 3.0, 6.0),
        ("mimo-v2.5-pro", 3.0, 6.0),
        ("mimo-v2.6-flash", 1.0, 2.0),
        ("mimo-v2.5", 1.0, 2.0),
    ),
    # Token Plan bills against a subscription quota rather than per token;
    # the pay-as-you-go list price is the best available per-token estimate.
    "xiaomi_mimo_token_plan": (
        ("mimo-v2.6-pro-ultraspeed", 30.0, 60.0),
        ("mimo-v2.6-pro", 3.0, 6.0),
        ("mimo-v2.5-pro", 3.0, 6.0),
        ("mimo-v2.6-flash", 1.0, 2.0),
        ("mimo-v2.5", 1.0, 2.0),
    ),
}
OFFICIAL_PRICE_SOURCE = "official"


def usd_to_cny() -> float:
    raw = os.environ.get("OPEN_NOTEBOOK_USD_CNY", "")
    try:
        rate = float(raw) if raw else USD_TO_CNY_DEFAULT
    except ValueError:
        rate = USD_TO_CNY_DEFAULT
    return rate if rate > 0 else USD_TO_CNY_DEFAULT


def _candidate_keys(model_name: str, provider: Optional[str]) -> List[str]:
    """LiteLLM keys look like 'qwen-max', 'openai/gpt-4o', 'dashscope/qwen-plus'."""
    name = (model_name or "").strip()
    if not name:
        return []
    candidates: List[str] = []
    lowered = name.lower()

    def push(value: str) -> None:
        if value and value not in candidates:
            candidates.append(value)

    push(name)
    push(lowered)
    # Strip a provider prefix the user may have pasted ("openai/gpt-4o").
    if "/" in lowered:
        push(lowered.split("/")[-1])
    # Strip common variant suffixes ("gpt-4o:free").
    for base in list(candidates):
        if ":" in base:
            push(base.split(":", 1)[0])
    if provider:
        prov = provider.strip().lower()
        for base in list(candidates):
            push(f"{prov}/{base}")
    return candidates


def _entry_costs(entry: Any) -> Optional[Tuple[float, float]]:
    """Per-1M-token (input, output) in USD, or None when the entry has no prices."""
    if not isinstance(entry, dict):
        return None
    input_cost = entry.get("input_cost_per_token")
    output_cost = entry.get("output_cost_per_token")
    if input_cost is None and output_cost is None:
        # Tiered listings (e.g. qwen-flash: cheaper under 256K tokens) carry
        # no flat price; approximate with the first (cheapest) tier.
        tiers = entry.get("tiered_pricing")
        if isinstance(tiers, list) and tiers and isinstance(tiers[0], dict):
            input_cost = tiers[0].get("input_cost_per_token")
            output_cost = tiers[0].get("output_cost_per_token")
    if input_cost is None and output_cost is None:
        return None
    # A missing side defaults to 0 (e.g. some free/explicit-only listings).
    return (
        float(input_cost or 0) * 1_000_000,
        float(output_cost or 0) * 1_000_000,
    )


def match_official_prices(
    model_name: str, provider: Optional[str]
) -> Optional[Dict[str, Any]]:
    """Match a model against official vendor tables (CNY per 1M tokens).

    Only consulted for providers with an official table. Returns
    {"matched_key", "price_input_per_m", "price_output_per_m", "price_source"}
    or None.
    """
    table = OFFICIAL_PRICE_TABLES.get((provider or "").strip().lower())
    if not table:
        return None
    name = (model_name or "").strip().lower()
    if not name:
        return None
    for pattern, input_per_m, output_per_m in sorted(table, key=lambda e: -len(e[0])):
        if name == pattern or name.startswith(pattern):
            return {
                "matched_key": pattern,
                "price_input_per_m": input_per_m,
                "price_output_per_m": output_per_m,
                "price_source": OFFICIAL_PRICE_SOURCE,
            }
    return None


def match_official_prices_any_provider(
    model_name: str,
) -> Optional[Dict[str, Any]]:
    """Cross-provider official fallback, matched by model id alone.

    Generic providers ("openai", "openai_compatible") often host a vendor's
    models via a hand-set base URL; the model id still names the vendor's
    model, so its official price applies. matched_key carries the owning
    provider ("xiaomi_mimo:mimo-v2.6-pro") for provenance.
    """
    name = (model_name or "").strip().lower()
    if not name:
        return None
    best: Optional[Tuple[str, str, float, float]] = None
    for provider, table in OFFICIAL_PRICE_TABLES.items():
        for pattern, input_per_m, output_per_m in table:
            if name != pattern and not name.startswith(pattern):
                continue
            if best is None or len(pattern) > len(best[0]):
                best = (pattern, provider, input_per_m, output_per_m)
    if best is None:
        return None
    pattern, provider, input_per_m, output_per_m = best
    return {
        "matched_key": f"{provider}:{pattern}",
        "price_input_per_m": input_per_m,
        "price_output_per_m": output_per_m,
        "price_source": OFFICIAL_PRICE_SOURCE,
    }


def match_price_entry(
    db: Dict[str, Any], model_name: str, provider: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Match a model against the price DB.

    Returns {"matched_key", "input_per_m_usd", "output_per_m_usd"} or None.
    """
    for key in _candidate_keys(model_name, provider):
        costs = _entry_costs(db.get(key))
        if costs is not None:
            return {
                "matched_key": key,
                "input_per_m_usd": costs[0],
                "output_per_m_usd": costs[1],
            }
    return None


def match_price_entry_any_provider(
    db: Dict[str, Any], model_name: str
) -> Optional[Dict[str, Any]]:
    """Last-resort LiteLLM lookup: the model id listed under some provider
    prefix ("dashscope/qwen-plus") while no provider-scoped candidate matched.
    Ties resolve alphabetically for determinism.
    """
    hits: List[str] = []
    for base in _candidate_keys(model_name, None):
        prefix = f"/{base}"
        for key in db:
            if key.lower().endswith(prefix) and key.lower() not in hits:
                hits.append(key.lower())
    for key in sorted(hits):
        costs = _entry_costs(db[key])
        if costs is not None:
            return {
                "matched_key": key,
                "input_per_m_usd": costs[0],
                "output_per_m_usd": costs[1],
            }
    return None


async def fetch_price_db(force: bool = False) -> Dict[str, Any]:
    """Fetch (and cache) the LiteLLM price database. Raises on failure."""
    now = time.time()
    if (
        not force
        and _cache["db"]
        and now - float(_cache["fetched_at"]) < PRICE_DB_CACHE_TTL_SECONDS
    ):
        return _cache["db"]
    async with httpx.AsyncClient(
        timeout=PRICE_DB_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        response = await client.get(PRICE_DB_URL)
        response.raise_for_status()
        db = response.json()
    if not isinstance(db, dict):
        raise ValueError("Price database payload is not a JSON object")
    _cache["db"] = db
    _cache["fetched_at"] = now
    return db


async def fetch_model_prices(
    model_name: str, provider: Optional[str] = None, force: bool = False
) -> Optional[Dict[str, Any]]:
    """Best-effort price lookup; returns CNY-per-1M values or None on any failure.

    Resolution order, most to least authoritative:
    1. official table for the model's own provider
    2. LiteLLM under the model's provider (incl. provider/name keys)
    3. official table by model id alone (generic providers hosting vendor models)
    4. LiteLLM by model id alone (same id listed under another provider)
    """
    official = match_official_prices(model_name, provider)
    if official:
        return official
    try:
        db = await fetch_price_db(force=force)
    except Exception as e:
        logger.warning(f"Could not fetch model price database: {e}")
        db = None
    if db is not None:
        matched = match_price_entry(db, model_name, provider)
        if matched:
            rate = usd_to_cny()
            return {
                "matched_key": matched["matched_key"],
                "price_input_per_m": round(matched["input_per_m_usd"] * rate, 4),
                "price_output_per_m": round(matched["output_per_m_usd"] * rate, 4),
                "price_source": "litellm",
            }
    official_any = match_official_prices_any_provider(model_name)
    if official_any:
        return official_any
    if db is not None:
        matched = match_price_entry_any_provider(db, model_name)
        if matched:
            rate = usd_to_cny()
            return {
                "matched_key": matched["matched_key"],
                "price_input_per_m": round(matched["input_per_m_usd"] * rate, 4),
                "price_output_per_m": round(matched["output_per_m_usd"] * rate, 4),
                "price_source": "litellm",
            }
    return None


def estimate_cost_cny(
    input_tokens: Optional[float],
    output_tokens: Optional[float],
    price_input_per_m: Optional[float],
    price_output_per_m: Optional[float],
) -> Optional[float]:
    """Cost in CNY for one usage row; None when the model has no stored price."""
    if price_input_per_m is None and price_output_per_m is None:
        return None
    input_cost = (input_tokens or 0) / 1_000_000 * (price_input_per_m or 0)
    output_cost = (output_tokens or 0) / 1_000_000 * (price_output_per_m or 0)
    return round(input_cost + output_cost, 6)
