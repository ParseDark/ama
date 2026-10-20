"""Download official retrieval ONNX assets from ModelScope and verify SHA-256.

No executable model code is downloaded. Model license: CC BY-NC 4.0.
Usage: python download_cpu_model.py ./model-cpu/retrieval
"""
import hashlib
from pathlib import Path
import sys
from urllib.request import urlopen

FILES = {
    "onnx/model.onnx": (1266078, "463fb3fec2adf9c47a946626dc2a0884e43091f95466083fb1754950000a7c1a"),
    "onnx/model.onnx_data": (2384199936, "0ae431b811baf89641ec67b690fb1d625c584d634c629362caf1e42438ca370e"),
    "tokenizer.json": (11422654, "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4"),
}
BASE = "https://modelscope.cn/api/v1/models/jinaai/jina-embeddings-v5-text-small-retrieval/repo?Revision=master&FilePath="


def valid(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest() == digest


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "model-cpu/retrieval")
    print("Jina v5 small retrieval ONNX: ~2.4 GB; CC BY-NC 4.0 (noncommercial).")
    for name, (size, digest) in FILES.items():
        target = root / name
        if valid(target, size, digest):
            print(name, "verified (cached)")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        try:
            with urlopen(BASE + name, timeout=60) as response, partial.open("wb") as output:
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    output.write(block)
            if not valid(partial, size, digest):
                raise ValueError("Model asset size/SHA-256 mismatch: " + name)
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
        print(name, "verified")


if __name__ == "__main__":
    main()
