"""Best-effort credential scrubbing for text that leaves the machine (prompts, diagnostics)."""

import re

# The URL rule excludes '/', ':' and '@' from user/pass so ordinary URLs
# (ports, path fragments) survive; only user:pass@ style credentials match.
_REDACT_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{8,}", re.IGNORECASE),
    re.compile(r"Bearer\s+\S+", re.IGNORECASE),
    re.compile(r"api[_-]?key\s*[:=]\s*\S+", re.IGNORECASE),
    re.compile(r"[a-zA-Z][a-zA-Z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE),
]


def redact_text(text: str) -> str:
    """Replace credential-like substrings with [REDACTED]; non-matching text passes through."""
    if not text:
        return text
    for pattern in _REDACT_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text
