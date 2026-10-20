"""Usage: python smoke_test.py [http://127.0.0.1:8765]."""
import json
import math
import os
import sys
from urllib.request import Request, urlopen


def request(base, path, data=None):
    headers = {"Content-Type": "application/json"}
    if os.environ.get("AMA_EMBED_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["AMA_EMBED_TOKEN"]
    req = Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    with urlopen(req, timeout=60) as response:
        assert not response.headers.get("Access-Control-Allow-Origin")
        return json.load(response)


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
    assert request(base, "/health")["ok"]
    result = request(base, "/v1/embeddings", {"input": "Where is the sprint board?", "input_type": "query", "dimensions": 1024})
    vector = result["data"][0]["embedding"]
    assert len(vector) == 1024 and abs(math.sqrt(sum(x*x for x in vector)) - 1) < 1e-4
    print("Health, no-CORS and unit-vector checks passed (1024 dimensions)")
