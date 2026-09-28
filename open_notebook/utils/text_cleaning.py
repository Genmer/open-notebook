"""
Source-text cleaning for Open Notebook.

Removes extraction noise that PDF/OCR converters leave behind — page footers
(第 12 页 / Page 12 of 300 / "- 12 -"), the same short header line repeated on
every page, and vertical watermarks rendered one character per line — before
the text is chunked and embedded.

Pure functions only: the stored source full_text is never rewritten. The
cleaning runs upstream of chunk_text inside the embedding pipeline
(commands/embedding_commands.py) and can be reused by display-side consumers
that want to show cleaned text without touching storage.
"""

import re
from collections import Counter
from typing import List

# Lines that are pure page furniture: 第 12 页 / 第 12 页，共 300 页 /
# Page 12 of 300 / "- 12 -" / "·12·" / a bare number.
_PAGE_FOOTER_RE = re.compile(
    r"^(?:第\s*\d+\s*页(?:\s*[,，]\s*共\s*\d+\s*页)?"
    r"|page\s+\d+(?:\s+of\s+\d+)?"
    r"|[\s\-–—·.…]*\d{1,4}[\s\-–—·.…]*)$",
    re.IGNORECASE,
)

# A short line repeated this many times is a header/footer/watermark, not prose.
_REPEAT_THRESHOLD = 3
# Only short lines are eligible for the repeat filter: long duplicated
# paragraphs can be legitimate content.
_REPEAT_MAX_LINE_LEN = 30
# Fail-safe: if cleaning would drop more than this share of the document's
# non-empty lines, the filter has misfired on an unusual document (poetry,
# tables, a text that IS mostly short lines) — keep the original.
_MAX_DROP_RATIO = 0.5


def _is_noise_line(line: str, counts: Counter[str]) -> bool:
    """Decide whether one stripped line is extraction noise."""
    if len(line) <= 1:
        # Vertical watermarks render one character per line; meaningful
        # single-character lines essentially never occur in prose.
        return True
    if _PAGE_FOOTER_RE.match(line):
        return True
    if len(line) <= _REPEAT_MAX_LINE_LEN and counts[line] >= _REPEAT_THRESHOLD:
        return True
    return False


def clean_source_text(text: str) -> str:
    """Drop watermark/footer lines from extracted document text.

    Idempotent and conservative: a no-op on already-clean text, and a no-op
    whenever the filters would remove too much of the document or leave it
    empty. The original text is returned unchanged in those cases, so callers
    never need a fallback path.
    """
    if not text or not text.strip():
        return text
    lines = text.split("\n")
    stripped = [line.strip() for line in lines]
    non_empty = [line for line in stripped if line]
    counts: Counter[str] = Counter(non_empty)

    kept: List[str] = []
    dropped = 0
    for line, s in zip(lines, stripped):
        if s and _is_noise_line(s, counts):
            dropped += 1
        else:
            kept.append(line)

    if not dropped or dropped > len(non_empty) * _MAX_DROP_RATIO:
        return text
    cleaned = "\n".join(kept)
    return cleaned if cleaned.strip() else text
