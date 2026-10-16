"""Async web search for the verification pipelines (GA dates, exam concepts).

Two backends: Tavily when TAVILY_API_KEY is set, otherwise DuckDuckGo HTML
scraping over the already-present httpx (no new dependency). Contract for
every public function: failures degrade to an empty result list — search is
best-effort evidence and must never break a verification run, so nothing
here raises.
"""

import asyncio
import html
import os
import re
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import httpx
from loguru import logger

SEARCH_TIMEOUT_SECONDS = 8
SEARCH_CONCURRENCY = 5

TAVILY_ENDPOINT = "https://api.tavily.com/search"
DUCKDUCKGO_ENDPOINT = "https://html.duckduckgo.com/html/"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; OpenNotebook/1.0; "
        "+https://github.com/lfnovo/open-notebook)"
    )
}

# DuckDuckGo HTML results: one title anchor (result__a) followed by one
# snippet anchor (result__snippet) per result, in document order.
_ANCHOR_RE = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_SPAN_RE = re.compile(r"\s+")

# Created lazily: an asyncio.Semaphore binds to the loop of its first use, so
# an import-time one would leak across pytest event loops. Tests can call
# reset_search_semaphore() between loops.
_SEARCH_SEMAPHORE: Optional[asyncio.Semaphore] = None


def _semaphore() -> asyncio.Semaphore:
    global _SEARCH_SEMAPHORE
    if _SEARCH_SEMAPHORE is None:
        _SEARCH_SEMAPHORE = asyncio.Semaphore(SEARCH_CONCURRENCY)
    return _SEARCH_SEMAPHORE


def reset_search_semaphore() -> None:
    global _SEARCH_SEMAPHORE
    _SEARCH_SEMAPHORE = None


def _strip_tags(fragment: str) -> str:
    return _SPAN_RE.sub(" ", _TAG_RE.sub("", fragment)).strip()


def _clean_text(fragment: str) -> str:
    return _strip_tags(html.unescape(str(fragment or "")))


def _result_url(href: str) -> str:
    """DuckDuckGo wraps outbound links as /l/?uddg=<encoded-url>; unwrap."""
    href = html.unescape(str(href or "").strip())
    if href.startswith("//"):
        href = f"https:{href}"
    parsed = urlparse(href)
    if parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return target or href
    return href


async def search_tavily(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Tavily API search; [] on any failure (missing key, HTTP error, bad shape)."""
    api_key = os.getenv("TAVILY_API_KEY", "").strip()
    if not api_key:
        return []
    async with _semaphore():
        try:
            async with httpx.AsyncClient(
                timeout=SEARCH_TIMEOUT_SECONDS, headers=_HEADERS
            ) as client:
                response = await client.post(
                    TAVILY_ENDPOINT,
                    json={
                        "api_key": api_key,
                        "query": query,
                        "max_results": max_results,
                    },
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as e:
            logger.warning(f"Tavily search failed for query {query!r}: {e}")
            return []
    results: List[Dict[str, str]] = []
    for item in (payload or {}).get("results") or []:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        results.append(
            {
                "title": _clean_text(item.get("title")),
                "url": url,
                "snippet": _clean_text(item.get("content")),
            }
        )
        if len(results) >= max_results:
            break
    return results


async def search_duckduckgo(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """DuckDuckGo HTML search; [] on any failure (blocked, timeout, layout change)."""
    async with _semaphore():
        try:
            async with httpx.AsyncClient(
                timeout=SEARCH_TIMEOUT_SECONDS,
                headers=_HEADERS,
                follow_redirects=True,
            ) as client:
                response = await client.get(DUCKDUCKGO_ENDPOINT, params={"q": query})
                response.raise_for_status()
                body = response.text
        except Exception as e:
            logger.warning(f"DuckDuckGo search failed for query {query!r}: {e}")
            return []

    titles: List[str] = []
    snippets: List[str] = []
    urls: List[str] = []
    for attrs, inner in _ANCHOR_RE.findall(body):
        if "result__a" in attrs.lower():
            href_match = re.search(r'href="([^"]+)"', attrs, re.IGNORECASE)
            url = _result_url(href_match.group(1)) if href_match else ""
            if not url:
                continue
            urls.append(url)
            titles.append(_clean_text(inner))
        elif "result__snippet" in attrs.lower():
            snippets.append(_clean_text(inner))

    results: List[Dict[str, str]] = []
    for index, url in enumerate(urls):
        if len(results) >= max_results:
            break
        results.append(
            {
                "title": titles[index] if index < len(titles) else "",
                "url": url,
                # a missing snippet keeps the result usable for GA extraction
                "snippet": snippets[index] if index < len(snippets) else "",
            }
        )
    return results


async def web_search(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Search the web for one query. Tavily when configured (falling back to
    DuckDuckGo when it returns nothing), DuckDuckGo otherwise. Returns a list
    of {title, url, snippet}; never raises — failures return []."""
    query = str(query or "").strip()
    if not query:
        return []
    if os.getenv("TAVILY_API_KEY", "").strip():
        results = await search_tavily(query, max_results)
        if results:
            return results
    return await search_duckduckgo(query, max_results)


def snippets_text(results: List[Dict[str, str]], max_chars: int = 2000) -> str:
    """Flatten search results into one plain-text block for downstream
    extraction (GA month parsing, concept definitions). The returned text is
    at most max_chars long including the newline separators."""
    lines: List[str] = []
    used = 0
    for result in results or []:
        piece = " ".join(
            part
            for part in (
                str(result.get("title") or ""),
                str(result.get("snippet") or ""),
            )
            if part
        )
        if not piece:
            continue
        budget = max_chars - used - (1 if lines else 0)
        if budget <= 0:
            break
        piece = piece[:budget]
        lines.append(piece)
        used += len(piece) + (1 if used else 0)
    return "\n".join(lines)


def tavily_configured() -> bool:
    return bool(os.getenv("TAVILY_API_KEY", "").strip())
