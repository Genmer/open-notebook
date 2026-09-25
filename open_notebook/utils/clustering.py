"""Pure numpy clustering helpers for AI source classification (no IO, no sklearn)."""

from collections.abc import Iterable, Sized
from typing import Dict, List, Sequence, Tuple

import numpy as np


def pool_embeddings(
    chunks: List[Tuple[str, Sequence[float]]],
) -> Dict[str, np.ndarray]:
    """Mean-pool chunk vectors per key (source id)."""
    pooled: Dict[str, List[np.ndarray]] = {}
    for key, vec in chunks:
        pooled.setdefault(key, []).append(np.asarray(vec, dtype=np.float64))
    return {key: np.mean(vecs, axis=0) for key, vecs in pooled.items()}


def dominant_dimension(vectors: Iterable[Sized]) -> int:
    """Most frequent vector length; mixed-dimension providers make this the majority."""
    if not vectors:
        return 0
    lengths = [len(v) for v in vectors]
    return int(np.argmax(np.bincount(lengths)))


def _l2_normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1.0, norms)


def kmeans(
    vectors: np.ndarray,
    k: int,
    seed: int = 42,
    n_init: int = 3,
    max_iter: int = 50,
) -> np.ndarray:
    """Cosine k-means on L2-normalized vectors; returns integer labels of shape (n,).

    k is capped at n; empty clusters are re-seeded with the point farthest from
    its centroid so labels always stay within range(k).
    """
    vectors = np.asarray(vectors, dtype=np.float64)
    n = len(vectors)
    if n == 0:
        return np.empty(0, dtype=int)
    k = max(1, min(k, n))

    normalized = _l2_normalize(vectors)
    rng = np.random.default_rng(seed)

    best_labels: np.ndarray = np.zeros(n, dtype=int)
    best_inertia = np.inf
    for _ in range(max(1, n_init)):
        labels, inertia = _single_kmeans(normalized, k, rng, max_iter)
        if inertia < best_inertia:
            best_inertia, best_labels = inertia, labels
    return best_labels


def _kmeanspp_seeds(normalized: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    n = len(normalized)
    seeds = [int(rng.integers(n))]
    # Squared cosine distance to the closest chosen seed, cumulative for the draw.
    dist = np.sum((normalized - normalized[seeds[0]]) ** 2, axis=1)
    while len(seeds) < k:
        total = dist.sum()
        if total <= 0:
            seeds.append(int(rng.integers(n)))
            continue
        seeds.append(int(rng.choice(n, p=dist / total)))
        dist = np.minimum(dist, np.sum((normalized - normalized[seeds[-1]]) ** 2, axis=1))
    return normalized[seeds]


def _single_kmeans(
    normalized: np.ndarray, k: int, rng: np.random.Generator, max_iter: int
) -> Tuple[np.ndarray, float]:
    n = len(normalized)
    centroids = _kmeanspp_seeds(normalized, k, rng)
    labels = np.zeros(n, dtype=int)

    for _ in range(max_iter):
        # Cosine similarity == dot product on unit vectors
        sims = normalized @ centroids.T
        labels = np.argmax(sims, axis=1)

        new_centroids = np.zeros_like(centroids)
        for cluster in range(k):
            members = normalized[labels == cluster]
            if len(members) == 0:
                # Re-seed with the point worst served by its centroid
                worst = int(np.argmin(np.max(normalized @ centroids.T, axis=1)))
                new_centroids[cluster] = normalized[worst]
            else:
                new_centroids[cluster] = _l2_normalize(members.mean(axis=0)[np.newaxis, :])[0]

        if np.allclose(new_centroids, centroids):
            centroids = new_centroids
            break
        centroids = new_centroids

    sims = normalized @ centroids.T
    labels = np.argmax(sims, axis=1)
    inertia = float(np.sum(1.0 - sims[np.arange(n), labels]))
    return labels, inertia
