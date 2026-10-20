"""Small reproducible retrieval sanity check; not a general quality benchmark."""
import sys
from smoke_test import request

SAMPLES = [
    ("Sprint board: track Jira engineering tickets", "Where can I check sprint tasks?"),
    ("Workday portal: submit time off and leave requests", "How do I request a vacation?"),
    ("Kafka retry policy: exponential backoff for failed messages", "上次那个消息重试方案"),
    ("Reply concisely in Chinese using bullet points", "以后请用简短的中文要点回答"),
]
base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
documents = request(base, "/v1/embeddings", {"input": [s[0] for s in SAMPLES], "input_type": "document"})["data"]
queries = request(base, "/v1/embeddings", {"input": [s[1] for s in SAMPLES], "input_type": "query"})["data"]
correct = 0
for i, query in enumerate(queries):
    scores = [sum(a*b for a, b in zip(query["embedding"], doc["embedding"])) for doc in documents]
    best = max(range(len(scores)), key=scores.__getitem__)
    correct += best == i
    print(f"Case {i+1}: {'PASS' if best == i else 'FAIL'}; score={scores[best]:.3f}")
print(f"Top-1 accuracy: {correct}/{len(SAMPLES)}")
raise SystemExit(0 if correct == len(SAMPLES) else 1)
