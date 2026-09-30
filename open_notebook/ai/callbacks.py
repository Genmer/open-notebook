import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Union
from uuid import UUID

from langchain_core.callbacks.base import BaseCallbackHandler
from loguru import logger


class TextRingBuffer:
    """Fixed-capacity sliding character window buffer."""

    def __init__(self, capacity: int = 1000) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._capacity = capacity
        self._buffer = ""
        self._total_chars = 0
        self._lock = threading.Lock()

    def append(self, text: str) -> None:
        if not text:
            return
        with self._lock:
            self._total_chars += len(text)
            self._buffer = (self._buffer + text)[-self._capacity :]

    def get_window(self) -> str:
        with self._lock:
            return self._buffer

    def clear(self) -> None:
        with self._lock:
            self._buffer = ""
            self._total_chars = 0

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def total_chars_written(self) -> int:
        with self._lock:
            return self._total_chars

    def __len__(self) -> int:
        with self._lock:
            return len(self._buffer)


@dataclass
class StreamingProgress:
    token_count: int
    tokens_per_second: float
    elapsed_seconds: float
    window_text: str
    total_chars: int
    is_final: bool = False
    error: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


class OpenNotebookStreamingHandler(BaseCallbackHandler):
    """
    Streaming callback handler collecting tokens, speed, and sliding text window.
    Throttles progress sync (default 500ms) to avoid saturating storage or sockets.
    """

    def __init__(
        self,
        sync_interval_ms: float = 500.0,
        window_size: int = 1000,
        sync_callback: Optional[Callable[[StreamingProgress], Any]] = None,
    ) -> None:
        super().__init__()
        if sync_interval_ms < 0:
            raise ValueError("sync_interval_ms cannot be negative")
        self.sync_interval_sec = sync_interval_ms / 1000.0
        self.window_buffer = TextRingBuffer(capacity=window_size)
        self.sync_callback = sync_callback

        self.token_count = 0
        self.start_time: Optional[float] = None
        self.last_token_time: Optional[float] = None
        self.last_sync_time: float = 0.0
        self._sync_invocations = 0
        self._lock = threading.Lock()

    @property
    def sync_invocations(self) -> int:
        with self._lock:
            return self._sync_invocations

    def _extract_token_text(self, token: Any, chunk: Optional[Any] = None) -> str:
        if token and isinstance(token, str):
            return token
        if chunk is not None:
            text = getattr(chunk, "text", None)
            if isinstance(text, str) and text:
                return text
            msg = getattr(chunk, "message", None)
            if msg is not None:
                content = getattr(msg, "content", None)
                if isinstance(content, str) and content:
                    return content
        if isinstance(token, dict) and "text" in token:
            return str(token["text"])
        return str(token) if token is not None else ""

    def _calculate_speed(self, now: float) -> tuple[float, float]:
        if self.start_time is None:
            return 0.0, 0.0
        elapsed = max(0.0, now - self.start_time)
        speed = self.token_count / elapsed if elapsed > 1e-6 else 0.0
        return elapsed, speed

    def _dispatch_sync(self, progress: StreamingProgress) -> None:
        with self._lock:
            self._sync_invocations += 1

        if not self.sync_callback:
            return

        try:
            res = self.sync_callback(progress)
            if asyncio.iscoroutine(res):
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(res)
                except RuntimeError:
                    asyncio.run(res)
        except Exception as e:
            logger.warning(f"Error in streaming sync_callback: {e}")

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: Optional[UUID] = None,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        now = time.monotonic()
        with self._lock:
            self.start_time = now
            self.token_count = 0
            self.last_token_time = None
            self.last_sync_time = now
            self.window_buffer.clear()

    def on_llm_new_token(
        self,
        token: Union[str, Any],
        *,
        chunk: Optional[Any] = None,
        run_id: Optional[UUID] = None,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        text = self._extract_token_text(token, chunk)
        now = time.monotonic()
        progress_to_sync: Optional[StreamingProgress] = None

        with self._lock:
            if self.start_time is None:
                self.start_time = now
            self.last_token_time = now
            self.token_count += 1
            self.window_buffer.append(text)

            elapsed, speed = self._calculate_speed(now)
            if (now - self.last_sync_time) >= self.sync_interval_sec:
                self.last_sync_time = now
                progress_to_sync = StreamingProgress(
                    token_count=self.token_count,
                    tokens_per_second=round(speed, 2),
                    elapsed_seconds=round(elapsed, 3),
                    window_text=self.window_buffer.get_window(),
                    total_chars=self.window_buffer.total_chars_written,
                    is_final=False,
                )

        if progress_to_sync is not None:
            self._dispatch_sync(progress_to_sync)

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: Optional[UUID] = None,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        now = time.monotonic()
        with self._lock:
            elapsed, speed = self._calculate_speed(now)
            self.last_sync_time = now
            progress = StreamingProgress(
                token_count=self.token_count,
                tokens_per_second=round(speed, 2),
                elapsed_seconds=round(elapsed, 3),
                window_text=self.window_buffer.get_window(),
                total_chars=self.window_buffer.total_chars_written,
                is_final=True,
            )
        self._dispatch_sync(progress)

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: Optional[UUID] = None,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> Any:
        now = time.monotonic()
        with self._lock:
            elapsed, speed = self._calculate_speed(now)
            self.last_sync_time = now
            progress = StreamingProgress(
                token_count=self.token_count,
                tokens_per_second=round(speed, 2),
                elapsed_seconds=round(elapsed, 3),
                window_text=self.window_buffer.get_window(),
                total_chars=self.window_buffer.total_chars_written,
                is_final=True,
                error=str(error),
            )
        self._dispatch_sync(progress)

    def get_progress(self, is_final: bool = False) -> StreamingProgress:
        now = time.monotonic()
        with self._lock:
            elapsed, speed = self._calculate_speed(now)
            return StreamingProgress(
                token_count=self.token_count,
                tokens_per_second=round(speed, 2),
                elapsed_seconds=round(elapsed, 3),
                window_text=self.window_buffer.get_window(),
                total_chars=self.window_buffer.total_chars_written,
                is_final=is_final,
            )

    def flush(self, is_final: bool = False) -> StreamingProgress:
        progress = self.get_progress(is_final=is_final)
        with self._lock:
            self.last_sync_time = time.monotonic()
        self._dispatch_sync(progress)
        return progress
