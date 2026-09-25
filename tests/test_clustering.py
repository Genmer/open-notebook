"""Tests for the pure clustering helpers in open_notebook/utils/clustering.py."""

import numpy as np
import pytest

from open_notebook.utils.clustering import (
    dominant_dimension,
    kmeans,
    pool_embeddings,
)


def _blobs(seed=0, per_blob=15):
    rng = np.random.default_rng(seed)
    centers = [[10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0, 10.0]]
    points, truth = [], []
    for label, center in enumerate(centers):
        points.append(np.array(center) + rng.normal(scale=0.5, size=(per_blob, 3)))
        truth.extend([label] * per_blob)
    return np.vstack(points), truth


class TestPoolEmbeddings:
    def test_means_per_key(self):
        pooled = pool_embeddings([("a", [1.0, 1.0]), ("a", [3.0, 3.0]), ("b", [0.0, 5.0])])
        assert set(pooled) == {"a", "b"}
        assert pooled["a"] == pytest.approx([2.0, 2.0])
        assert pooled["b"] == pytest.approx([0.0, 5.0])

    def test_empty_input(self):
        assert pool_embeddings([]) == {}


class TestDominantDimension:
    def test_mode_wins(self):
        vectors = [[1, 2], [1, 2, 3], [4, 5], [6, 7], [8, 9, 10, 11]]
        assert dominant_dimension(vectors) == 2

    def test_single_dimension(self):
        assert dominant_dimension([[1, 2, 3], [4, 5, 6]]) == 3

    def test_empty(self):
        assert dominant_dimension([]) == 0


class TestKmeans:
    def test_three_synthetic_blobs_converge(self):
        points, truth = _blobs()
        labels = kmeans(points, 3, seed=42)

        # Every cluster must be pure (one blob per label)
        for cluster in np.unique(labels):
            members = {truth[i] for i in np.where(labels == cluster)[0]}
            assert len(members) == 1

    def test_labels_in_range_and_count(self):
        points, _ = _blobs()
        labels = kmeans(points, 3)
        assert labels.shape == (45,)
        assert set(np.unique(labels)) <= {0, 1, 2}

    def test_deterministic_for_seed(self):
        points, _ = _blobs(seed=7)
        assert np.array_equal(kmeans(points, 3, seed=1), kmeans(points, 3, seed=1))

    def test_n_zero_returns_empty(self):
        assert len(kmeans(np.empty((0, 3)), 3)) == 0

    def test_n_below_k_caps_k(self):
        points = np.array([[1.0, 0.0], [0.0, 1.0]])
        labels = kmeans(points, 5)
        assert set(np.unique(labels)) <= {0, 1}

    def test_single_point(self):
        labels = kmeans(np.array([[3.0, 4.0]]), 4)
        assert labels.tolist() == [0]

    def test_empty_cluster_reseeded_without_nan(self):
        # Duplicate points force an empty centroid during k-means++ iterations
        points = np.array([[0.0, 0.0], [0.0, 0.0], [10.0, 10.0]])
        labels = kmeans(points, 3)
        assert not np.isnan(labels).any()
        assert len(labels) == 3
        # The two duplicates stay together; the far point is separated
        assert labels[0] == labels[1]
        assert labels[2] != labels[0]

    def test_all_identical_points(self):
        points = np.ones((6, 4))
        labels = kmeans(points, 3)
        assert len(labels) == 6
