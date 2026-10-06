"""Locate the passage an inline citation points at, without any model call.

Chat answers cite whole sources as ``[source:id]``; the surrounding answer
text is the only clue about *which passage* backs the claim. This module
scores that text against the source's embedding chunks (plain character
n-gram overlap) and returns the best-matching excerpt, which the reader UI
then highlights in the original document.

Pure string work — synchronous, milliseconds on typical chunk sets.
"""

import bisect
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

# Overlap below this fraction of the passage's n-grams is "not found": the
# answer text was paraphrased too far from any stored chunk.
MIN_SCORE = 0.12

# n-gram length for overlap scoring. Long enough to be specific, short enough
# to survive whitespace/punctuation edits between answer text and source text.
_N = 6

# Long passages are truncated before scoring: the far tail of a long window
# rarely adds signal but always adds cost.
_MAX_PASSAGE_CHARS = 400

# Only the highest-overlap chunks get the precise sliding-window pass; the
# rest are near-misses that can never win.
_MAX_WINDOW_CANDIDATES = 8

# Sliding-window step (normalized chars) when trimming the quote out of the
# winning chunk.
_WINDOW_STEP = 24

_WHITESPACE_RE = re.compile(r"\s+")

# Fullwidth ASCII (U+FF01..U+FF5E) → halfwidth, plus curly quotes → straight.
# Extraction pipelines and the browser's pdf.js text layer disagree on which
# form CJK-adjacent punctuation takes, so matching folds both to one side.
_PUNCT_FOLD = {0xFF01 + i: 0x21 + i for i in range(0x5E)}
_PUNCT_FOLD.update({0x2018: 0x27, 0x2019: 0x27, 0x201C: 0x22, 0x201D: 0x22})


def _fold_char(ch: str) -> str:
    return chr(_PUNCT_FOLD.get(ord(ch), ord(ch)))


def normalize_with_map(text: str) -> Tuple[str, List[int]]:
    """Lowercase, fold fullwidth punctuation and collapse whitespace, keeping
    an index map back.

    Returns ``(normalized, index_map)`` where ``index_map[i]`` is the offset in
    ``text`` that produced normalized char ``i`` — required to translate a
    match on normalized text back to a quote of the original text.
    """
    norm_chars: List[str] = []
    index_map: List[int] = []
    pending_space = False
    for i, ch in enumerate(text):
        if ch.isspace():
            pending_space = bool(norm_chars)
            continue
        if pending_space:
            norm_chars.append(" ")
            index_map.append(i)
            pending_space = False
        norm_chars.append(_fold_char(ch).lower())
        index_map.append(i)
    return "".join(norm_chars), index_map


def _ngrams(text: str) -> set:
    if len(text) < _N:
        return {text} if text else set()
    return {text[i : i + _N] for i in range(len(text) - _N + 1)}


def locate_passage_in_chunks(
    passage: str, chunks: List[Tuple[int, str]]
) -> Optional[Tuple[int, str, float]]:
    """Find the chunk (and excerpt inside it) best matching ``passage``.

    ``chunks`` is a list of ``(order, content)`` in document order. Returns
    ``(order, quote, score)`` where ``score`` is the fraction of the passage's
    n-grams found in the excerpt, or ``None`` when nothing clears
    ``MIN_SCORE``.
    """
    norm_passage, _ = normalize_with_map(passage[:_MAX_PASSAGE_CHARS])
    if not norm_passage:
        return None
    wanted = _ngrams(norm_passage)
    if not wanted:
        return None

    # Pass 1 — chunk-level overlap ranking. Keeps memory bounded on large
    # sources: the per-chunk gram set is dropped as soon as it scores.
    candidates: List[Tuple[int, int, str, str, List[int]]] = []
    # (overlap, order, content, norm_chunk, index_map)
    for order, content in chunks:
        norm_chunk, index_map = normalize_with_map(content)
        if not norm_chunk:
            continue
        overlap = len(wanted & _ngrams(norm_chunk))
        if overlap / len(wanted) < MIN_SCORE:
            continue
        candidates.append((overlap, order, content, norm_chunk, index_map))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (-c[0], c[1]))
    candidates = candidates[:_MAX_WINDOW_CANDIDATES]

    # Pass 2 — sliding window on the finalists. positions maps each wanted
    # gram to its ascending start offsets in the normalized chunk, so each
    # window scores with one bisect per gram.
    best: Optional[Tuple[float, int, str]] = None  # (score, order, quote)
    for _overlap, order, content, norm_chunk, index_map in candidates:
        positions: Dict[str, List[int]] = defaultdict(list)
        for i in range(len(norm_chunk) - _N + 1):
            gram = norm_chunk[i : i + _N]
            if gram in wanted:
                positions[gram].append(i)

        window_len = min(len(norm_passage), len(norm_chunk))
        local_best_score = 0.0
        local_best_start = 0
        for start in range(0, max(1, len(norm_chunk) - window_len + 1), _WINDOW_STEP):
            end = min(start + window_len, len(norm_chunk))
            hits = 0
            for offsets in positions.values():
                j = bisect.bisect_left(offsets, start)
                if j < len(offsets) and offsets[j] + _N - 1 < end:
                    hits += 1
            score = hits / len(wanted)
            if score > local_best_score:
                local_best_score = score
                local_best_start = start
        if local_best_score < MIN_SCORE:
            continue

        # Map the normalized window back to original-text offsets: the map's
        # entry for a normalized index is the original offset that produced
        # that char; +1 on the last one recovers the full closing char.
        norm_end = min(local_best_start + window_len, len(norm_chunk))
        orig_start = index_map[local_best_start]
        orig_end = index_map[min(norm_end - 1, len(index_map) - 1)] + 1
        quote = content[orig_start:orig_end].strip()
        if not quote:
            continue
        if best is None or local_best_score > best[0]:
            best = (local_best_score, order, quote)

    if best is None:
        return None
    score, order, quote = best
    return order, quote, min(1.0, score)
