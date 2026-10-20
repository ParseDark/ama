"""Reproducible synthetic retrieval evaluation against the running HTTP service.

No private data. Not a standardized benchmark, held-out set, or production accuracy.
Usage: python benchmark_accuracy.py --output /tmp/ama-accuracy.json
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import time
from smoke_test import request


def normalize(vector, dimensions):
    vector = vector[:dimensions]
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector]


def selected(scores, minimum):
    median = statistics.median(scores)
    return [i for i in sorted(range(len(scores)), key=lambda i: -scores[i])
            if scores[i] >= minimum and (len(scores) < 3 or scores[i] - median >= .08)][:3]


def evaluate(documents, queries, doc_vectors, query_vectors, dimensions, minimum):
    docs = [normalize(v, dimensions) for v in doc_vectors]
    qs = [normalize(v, dimensions) for v in query_vectors]
    rows = []
    for case, vector in zip(queries, qs):
        scores = [sum(a * b for a, b in zip(vector, doc)) for doc in docs]
        ranked = sorted(range(len(scores)), key=lambda i: -scores[i])
        expected = set(case["expected"])
        rank = next((r + 1 for r, i in enumerate(ranked) if documents[i]["id"] in expected), None)
        picks = selected(scores, minimum)
        rows.append({**case, "rank": rank,
                     "top3": [{"id": documents[i]["id"], "score": round(scores[i], 4)} for i in ranked[:3]],
                     "selected": [documents[i]["id"] for i in picks],
                     "selected_relevant": sum(documents[i]["id"] in expected for i in picks)})
    positives = [r for r in rows if r["expected"]]
    negatives = [r for r in rows if r["group"] == "unrelated"]
    near = [r for r in rows if r["group"] == "near_domain_unknown"]
    groups = {}
    for group in dict.fromkeys(r["group"] for r in positives):
        rs = [r for r in positives if r["group"] == group]
        groups[group] = {"n": len(rs), "top1": sum(r["rank"] == 1 for r in rs) / len(rs),
                         "recall_at_3": sum(r["rank"] <= 3 for r in rs) / len(rs)}
    total_picks = sum(len(r["selected"]) for r in positives)
    return {
        "dimensions": dimensions, "minimum": minimum, "positive_queries": len(positives),
        "top1": sum(r["rank"] == 1 for r in positives) / len(positives),
        "recall_at_3": sum(r["rank"] <= 3 for r in positives) / len(positives),
        "mrr": statistics.mean(1 / r["rank"] for r in positives),
        "injection_recall": sum(r["selected_relevant"] > 0 for r in positives) / len(positives),
        "injection_precision": sum(r["selected_relevant"] for r in positives) / total_picks if total_picks else 0,
        "selected_per_positive": total_picks / len(positives),
        "unrelated_queries": len(negatives),
        "unrelated_false_injection_rate": sum(bool(r["selected"]) for r in negatives) / len(negatives),
        "near_domain_unknown_selected_rate": sum(bool(r["selected"]) for r in near) / len(near),
        "groups": groups, "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8765")
    parser.add_argument("--output", default="/tmp/ama-accuracy.json")
    args = parser.parse_args()
    source = Path(__file__).with_name("accuracy_cases.json")
    cases = json.loads(source.read_text())
    timings = []

    def embed(items, kind):
        vectors = []
        for start in range(0, len(items), 8):
            batch = items[start:start + 8]
            begin = time.perf_counter()
            result = request(args.base, "/v1/embeddings", {
                "input": [r["text"] for r in batch], "input_type": kind, "dimensions": 1024})
            timings.append({"kind": kind, "count": len(batch), "seconds": round(time.perf_counter() - begin, 3)})
            data = sorted(result["data"], key=lambda r: r["index"])
            assert len(data) == len(batch)
            for row in data:
                v = row["embedding"]
                assert len(v) == 1024 and abs(sum(x*x for x in v) - 1) < 1e-4
                vectors.append(v)
        return vectors

    docs = embed(cases["documents"], "document")
    queries = embed(cases["queries"], "query")
    results = [evaluate(cases["documents"], cases["queries"], docs, queries, dim, .28)
               for dim in [1024, 512, 256, 128]]
    sweep = [{k: v for k, v in evaluate(cases["documents"], cases["queries"], docs, queries, 1024, threshold).items()
              if k not in {"rows", "groups"}}
             for threshold in [.28, .35, .4, .45, .5, .55, .6]]
    report = {"description": cases["description"], "corpus_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "documents": len(docs), "queries": len(queries), "timings": timings,
              "near_domain_note": "Unknown facts with a related topic are reported separately: a relevant reference is not proof that it answers the question. Do not interpret selection as a factual answer.",
              "dimensions_note": "Reduced dimensions are obtained by truncating the 1024-d vector then renormalizing, matching the server's Matryoshka path.",
              "sweep_note": "Descriptive same-set threshold sweep, not held-out tuning; application defaults unchanged.",
              "results": results, "threshold_sweep": sweep}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps([{k: v for k, v in r.items() if k not in {"rows", "groups"}} for r in results], indent=2))
    print("Detailed results:", args.output)


if __name__ == "__main__":
    main()
