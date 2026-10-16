"""Unit tests for open_notebook/utils/web_search.py.

Contract under test: normal parsing, timeout, empty results, exceptions —
every path returns a list (empty on failure) and never raises.
"""

import asyncio
from typing import Any, Dict, List

import httpx
import pytest

from open_notebook.utils import web_search as ws

DDG_HTML = """
<html><body>
<div class="result">
  <a rel="nofollow" class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fga">Python <b>3.13</b> release</a>
  <a class="result__snippet" href="//example.com/x">Released in <span>October 2024</span>.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://sample.org/page">Second result</a>
  <a class="result__snippet">Second snippet</a>
</div>
</body></html>
"""


class _FakeResponse:
    def __init__(self, payload: Any = None, text: str = "", status: int = 200):
        self._payload = payload
        self.text = text
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "http error",
                request=httpx.Request("GET", "https://example.test"),
                response=httpx.Response(
                    self.status_code,
                    request=httpx.Request("GET", "https://example.test"),
                ),
            )

    def json(self) -> Any:
        return self._payload


class _FakeAsyncClient:
    """httpx.AsyncClient seam: routes get/post to the installed handler."""

    handler: Any = None
    calls: List[str] = []
    client_kwargs: List[Dict[str, Any]] = []

    def __init__(self, *args: Any, **kwargs: Any):
        type(self).client_kwargs.append(dict(kwargs))

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def get(self, url: str, **kwargs: Any) -> Any:
        type(self).calls.append(f"GET {url}")
        return type(self).handler("GET", url, kwargs)

    async def post(self, url: str, **kwargs: Any) -> Any:
        type(self).calls.append(f"POST {url}")
        return type(self).handler("POST", url, kwargs)


@pytest.fixture(autouse=True)
def _fresh_semaphore():
    ws.reset_search_semaphore()
    yield
    ws.reset_search_semaphore()


@pytest.fixture(autouse=True)
def _patch_client(monkeypatch):
    monkeypatch.setattr(ws.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.client_kwargs = []
    yield


@pytest.fixture(autouse=True)
def _no_tavily(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)


@pytest.mark.asyncio
async def test_duckduckgo_normal_results():
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(text=DDG_HTML)
    results = await ws.web_search("python 3.13 GA")
    assert len(results) == 2
    # redirect-wrapped link is unwrapped, tags are stripped
    assert results[0]["url"] == "https://example.com/ga"
    assert results[0]["title"] == "Python 3.13 release"
    assert results[0]["snippet"] == "Released in October 2024."
    assert results[1]["url"] == "https://sample.org/page"
    assert results[1]["snippet"] == "Second snippet"


@pytest.mark.asyncio
async def test_timeout_returns_empty(monkeypatch):
    async def raise_timeout(*args: Any, **kwargs: Any) -> Any:
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(_FakeAsyncClient, "get", raise_timeout)
    monkeypatch.setattr(_FakeAsyncClient, "post", raise_timeout)
    assert await ws.web_search("anything") == []


@pytest.mark.asyncio
async def test_http_error_returns_empty():
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(status=403)
    assert await ws.web_search("anything") == []


@pytest.mark.asyncio
async def test_layout_change_returns_empty():
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(
        text="<html><body>unexpected</body></html>"
    )
    assert await ws.web_search("anything") == []


@pytest.mark.asyncio
async def test_empty_query_skips_http():
    assert await ws.web_search("   ") == []
    assert _FakeAsyncClient.calls == []


@pytest.mark.asyncio
async def test_tavily_used_when_configured(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(
        payload={
            "results": [
                {
                    "title": "T <b>result</b>",
                    "url": "https://t.example/a",
                    "content": "content snippet",
                },
                {"title": "no url", "url": "", "content": "dropped"},
            ]
        }
    )
    results = await ws.web_search("q")
    assert len(results) == 1
    assert results[0]["title"] == "T result"
    assert results[0]["url"] == "https://t.example/a"
    assert results[0]["snippet"] == "content snippet"
    # only the Tavily POST, no DuckDuckGo fallback
    assert [call for call in _FakeAsyncClient.calls if "GET" in call] == []


@pytest.mark.asyncio
async def test_tavily_failure_falls_back_to_duckduckgo(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")

    def handler(method: str, url: str, kwargs: Dict[str, Any]) -> Any:
        if "tavily" in url:
            raise httpx.ConnectError("network down")
        return _FakeResponse(text=DDG_HTML)

    _FakeAsyncClient.handler = handler
    results = await ws.web_search("q")
    assert len(results) == 2
    assert results[0]["url"] == "https://example.com/ga"


@pytest.mark.asyncio
async def test_tavily_empty_falls_back_to_duckduckgo(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")

    def handler(method: str, url: str, kwargs: Dict[str, Any]) -> Any:
        if "tavily" in url:
            return _FakeResponse(payload={"results": []})
        return _FakeResponse(text=DDG_HTML)

    _FakeAsyncClient.handler = handler
    results = await ws.web_search("q")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_concurrent_calls_all_succeed():
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(text=DDG_HTML)
    results = await asyncio.gather(*[ws.web_search(f"query {i}") for i in range(12)])
    assert all(len(batch) == 2 for batch in results)


def test_snippets_text_flattens_and_caps():
    results = [
        {"title": "t1", "url": "u1", "snippet": "s1"},
        {"title": "", "url": "u2", "snippet": "s2"},
        {"title": "t3", "url": "u3", "snippet": ""},
        {"title": "t4", "url": "u4", "snippet": "s4"},
    ]
    text = ws.snippets_text(results)
    assert "t1 s1" in text
    assert "s2" in text
    assert "t3" in text  # title-only result still contributes
    assert "s4" in text
    assert ws.snippets_text([], max_chars=10) == ""
    assert len(ws.snippets_text(results, max_chars=8)) <= 8


# --- parameter contract: 8s timeout, concurrency cap 5 ---


@pytest.mark.asyncio
async def test_should_use_eight_second_timeout_for_every_http_call():
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(text=DDG_HTML)
    await ws.web_search("python 3.13 GA")

    assert ws.SEARCH_TIMEOUT_SECONDS == 8
    assert _FakeAsyncClient.client_kwargs, "no http call was made"
    for kwargs in _FakeAsyncClient.client_kwargs:
        assert kwargs.get("timeout") == 8


@pytest.mark.asyncio
async def test_should_cap_concurrent_searches_at_five(monkeypatch):
    _FakeAsyncClient.handler = lambda method, url, kwargs: _FakeResponse(text=DDG_HTML)
    in_flight = 0
    max_in_flight = 0

    async def _slow(method: str, url: str, kwargs: Dict[str, Any]) -> Any:
        nonlocal in_flight, max_in_flight
        in_flight += 1
        max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.02)  # force overlap so the cap is observable
        in_flight -= 1
        return _FakeAsyncClient.handler(method, url, kwargs)

    async def slow_get(self, url: str, **kwargs: Any) -> Any:
        type(self).calls.append(f"GET {url}")
        return await _slow("GET", url, kwargs)

    async def slow_post(self, url: str, **kwargs: Any) -> Any:
        type(self).calls.append(f"POST {url}")
        return await _slow("POST", url, kwargs)

    monkeypatch.setattr(_FakeAsyncClient, "get", slow_get)
    monkeypatch.setattr(_FakeAsyncClient, "post", slow_post)

    results = await asyncio.gather(*[ws.web_search(f"query {i}") for i in range(12)])

    assert all(len(batch) == 2 for batch in results)
    assert ws.SEARCH_CONCURRENCY == 5
    assert max_in_flight <= 5
    assert max_in_flight >= 2  # actually concurrent, not serialized


@pytest.mark.asyncio
async def test_should_return_empty_when_handler_raises_unexpected_error():
    def boom(method: str, url: str, kwargs: Dict[str, Any]) -> Any:
        raise ValueError("unexpected seam failure")

    _FakeAsyncClient.handler = boom
    assert await ws.web_search("anything") == []
