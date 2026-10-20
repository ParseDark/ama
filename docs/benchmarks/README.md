# Jina ONNX CPU: synthetic AMA retrieval evaluation

This is a **locally authored synthetic sanity benchmark**, not MTEB, a held-out test, a production-data evaluation, or evidence of general model accuracy. Labels were authored before inference. No private memories or credentials are included. Corpus: [`../../tools/embed-server/accuracy_cases.json`](../../tools/embed-server/accuracy_cases.json). Full measured scores, ranks, selected references, timings and corpus SHA-256: [`jina-cpu-synthetic.json`](jina-cpu-synthetic.json).

## Setup and reproduction

Start the real CPU server as documented in `tools/embed-server/README.md` (Jina v5 small retrieval ONNX, CPUExecutionProvider, six threads, max length 2048). No mocked embeddings:

```sh
python3 tools/embed-server/benchmark_accuracy.py --output /tmp/ama-accuracy.json
python3 -m unittest discover -s tools/embed-server -p 'test_*.py'
```

24 synthetic saved references; 68 queries: 56 with an expected reference, 8 unrelated topics, 4 related-topic questions for facts absent from the corpus. Documents use `Document: ` and queries use `Query: `. Cosine similarity of normalized vectors. The evaluator reproduces AMA `pickRelevant`: score ≥ 0.28, ≥ median + 0.08 for pools with at least three entries, at most three references. It measures retrieval/selection, **not the eventual LLM answer**, memory scope/status/budget filters, or end-to-end extension injection. Real application filtering may select fewer references.

## Results

| Dimensions | Top-1, 56 positive queries | Recall@3 | MRR |
|---|---:|---:|---:|
| 1024 | 52/56 (92.9%) | 56/56 (100%) | 0.964 |
| 512 | 52/56 (92.9%) | 56/56 (100%) | 0.964 |
| 256 | 52/56 (92.9%) | 56/56 (100%) | 0.955 |
| 128 | 50/56 (89.3%) | 56/56 (100%) | 0.938 |

Reduced dimensions are truncation plus renormalization of the same 1024-dimensional embeddings, matching the server path. This small corpus does not establish equivalence at scale.

1024-dimensional breakdown:

- English: **19/19** top-1.
- Chinese: **5/5** top-1.
- English query → Chinese reference: **5/5** top-1.
- Chinese query → English reference: **17/17** top-1.
- Hard paraphrases/negation: **6/10** top-1, **10/10** recall@3.
- Unrelated topics: **0/8** selected any reference at default threshold.
- Related-topic but absent facts: **4/4** selected some reference. Topic similarity does not establish answerability: e.g. a VPN guide cannot supply VPN credentials. Do not infer missing facts from a retrieved reference.

### Failure cases (1024 dimensions)

| Query | Wrong top-1 | Expected rank-2 |
|---|---|---|
| I need a few days away from work, **not a travel reimbursement**. | expense (0.5271) | leave (0.4383) |
| The consumer needs to reread old records, **not change retry backoff**. | kafka-retry (0.5700) | kafka-offset (0.4029) |
| 别改聊天模型，我要测试向量服务是否连通。 | llm (0.4390) | embedding (0.4186) |
| 我要查任务负责人，不是生产故障值班人。 | oncall (0.5494) | jira (0.3108) |

Negated topics can dominate semantic similarity. Embeddings alone are not a reliable negation/intent classifier.

### Selection policy versus ranking quality

Each positive query has exactly one labeled target; other references are counted as non-targets even when broadly related. At default minScore 0.28, the picker retains the target for **56/56 queries**, but selects **138 total references**: target-label precision **56/138 = 40.6%** and average **2.46** references/query. This is stricter than judging general topical relevance and is not answer accuracy. It reveals over-selection rather than poor top-1 ranking.

Descriptive threshold sweep on this **same dataset** (not independent validation or an optimal threshold recommendation):

| minScore | Target retained | Target-label precision | References/positive query |
|---|---:|---:|---:|
| 0.28 (current) | 100% | 40.6% | 2.46 |
| 0.35 | 98.2% | 55.6% | 1.77 |
| 0.40 | 94.6% | 70.7% | 1.34 |
| 0.45 | 89.3% | 87.7% | 1.02 |
| 0.50 | 82.1% | 86.8% | 0.95 |

Raising the threshold reduces extraneous context but loses relevant references, and cannot fix negation ranking or guarantee abstention for absent facts. **Application defaults have not been changed.** A larger independently labeled representative corpus and, if necessary, a reranker/answerability check should precede a production policy change.
