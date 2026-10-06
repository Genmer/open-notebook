"""UTC timestamp helpers shared by every chat-message write point.

LangChain messages carry no timestamp of their own, so history-writing code
paths stamp `additional_kwargs["created_at"]` with this helper's UTC ISO
string. The frontend renders it in the viewer's local timezone.
"""

from datetime import datetime, timezone


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string (timezone-aware)."""
    return datetime.now(timezone.utc).isoformat()
