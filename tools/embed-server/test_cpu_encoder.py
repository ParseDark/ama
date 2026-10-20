"""CPU math tests; skipped in the dependency-free HTTP-contract CI environment."""
import unittest

try:
    import numpy as np
except ImportError:
    np = None
from cpu_encoder import pool_and_normalize


@unittest.skipIf(np is None, "CPU numpy dependency not installed")
class PoolingTests(unittest.TestCase):
    def test_both_padding_sides_and_truncation(self):
        hidden = np.array([[[0., 0., 9.], [3., 4., 9.], [8., 8., 8.]],
                           [[8., 8., 8.], [0., 0., 9.], [4., 3., 9.]]])
        vectors = pool_and_normalize(hidden, np.array([[1, 1, 0], [0, 1, 1]]), 2)
        np.testing.assert_allclose(vectors, [[.6, .8], [.8, .6]])

    def test_invalid_outputs(self):
        for hidden, mask in [(np.zeros((1, 1, 2)), np.ones((1, 1))),
                             (np.ones((1, 1, 2)), np.zeros((1, 1))),
                             (np.full((1, 1, 2), float("nan")), np.ones((1, 1)))]:
            with self.assertRaises(ValueError):
                pool_and_normalize(hidden, mask, 2)
