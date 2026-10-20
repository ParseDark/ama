"""Dependency-free checks for the benchmark's ranking and selection metrics."""
import unittest
from benchmark_accuracy import evaluate, selected


class AccuracyMetricsTests(unittest.TestCase):
    def test_median_margin_and_topk(self):
        self.assertEqual(selected([.6, .5, .4, .2], .28), [0])
        self.assertEqual(selected([.3, .29], .28), [0, 1])
        self.assertEqual(selected([.1, .09, .08], .28), [])

    def test_known_ranking_and_unknowns(self):
        docs = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        queries = [{"text": "a", "group": "test", "expected": ["a"]},
                   {"text": "unknown", "group": "unrelated", "expected": []},
                   {"text": "near", "group": "near_domain_unknown", "expected": []}]
        r = evaluate(docs, queries, [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                     [[1, 0, 0], [-1, -1, -1], [1, 0, 0]], 3, .28)
        self.assertEqual(r["top1"], 1)
        self.assertEqual(r["recall_at_3"], 1)
        self.assertEqual(r["mrr"], 1)
        self.assertEqual(r["injection_precision"], 1)
        self.assertEqual(r["unrelated_false_injection_rate"], 0)
        self.assertEqual(r["near_domain_unknown_selected_rate"], 1)
