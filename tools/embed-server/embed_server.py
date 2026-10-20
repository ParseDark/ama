#!/usr/bin/env python3
"""Loopback-only OpenAI-compatible Jina embedding service (MLX or ONNX CPU).

Review the downloaded model.py before use: it is executable Python. No request
text or authorization headers are logged. Run with python -I (isolated mode).
"""
import argparse
import hmac
import importlib.util
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

MODEL = "jina-v5-small"
DIMENSIONS = {32, 64, 128, 256, 512, 768, 1024}
MAX_BODY = 8 * 1024 * 1024


def load_encoder(path):
    import mlx.core as mx
    from tokenizers import Tokenizer

    path = Path(path).resolve()
    spec = importlib.util.spec_from_file_location("reviewed_jina_model", path / "model.py")
    if spec is None or spec.loader is None:
        raise ValueError("A reviewed model.py is required")
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves its module through sys.modules.
    import sys
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    config = json.loads((path / "config.json").read_text())
    model = module.JinaEmbeddingModel(config)
    weights = {}
    for shard in sorted(path.glob("*.safetensors")):
        weights.update(mx.load(str(shard)))
    if not weights:
        raise ValueError("No .safetensors weights found in model directory")
    model.load_weights(list(weights.items()), strict=True)
    mx.eval(model.parameters())
    model.eval()
    tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
    tokenizer.no_padding()
    tokenizer.enable_truncation(max_length=8192)

    def encode(texts, input_type, dimensions):
        # Bound peak memory: encode in small batches rather than all 256 at once.
        vectors = []
        for start in range(0, len(texts), 8):
            result = model.encode(texts[start:start + 8], tokenizer,
                                  max_length=8192, truncate_dim=dimensions,
                                  task_type="retrieval.query" if input_type == "query" else "retrieval.passage")
            mx.eval(result)
            vectors.extend(result.tolist())
        return vectors
    return encode


def handler_for(encode, default_dimensions=1024, token=""):
    # Accept idle browser/preconnect sockets independently, but never run the
    # encoder concurrently or build a queue of already-timed-out inference jobs.
    inference_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "AMAEmbeddings/1"

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *_args):
            pass

        def reply(self, status, payload):
            body = json.dumps(payload, allow_nan=False).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                # Deliberately no CORS headers. Extensions use host permissions.
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # A caller's timeout/disconnect is not an inference failure.
                self.close_connection = True

        def error(self, status, message):
            self.reply(status, {"error": {"message": message}})

        def authenticated(self):
            if token and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.error(401, "Invalid bearer token")
                return False
            return True

        def do_GET(self):
            if not self.authenticated():
                return
            if self.path == "/health":
                self.reply(200, {"ok": True, "model": MODEL})
            elif self.path == "/v1/models":
                self.reply(200, {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "local"}]})
            else:
                self.error(404, "Not found")

        def do_POST(self):
            if not self.authenticated():
                return
            if self.path not in {"/embeddings", "/v1/embeddings"}:
                self.error(404, "Not found")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if not 0 < length <= MAX_BODY:
                self.error(413, "Body is required and must be at most 8 MB")
                return
            try:
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Expected a JSON object")
                texts = payload.get("input")
                if isinstance(texts, str):
                    texts = [texts]
                if not isinstance(texts, list) or not 1 <= len(texts) <= 256 or not all(isinstance(t, str) and t.strip() for t in texts):
                    raise ValueError("input must be a string or 1–256 non-empty strings")
                dimensions = payload.get("dimensions", default_dimensions)
                if type(dimensions) is not int or dimensions not in DIMENSIONS:
                    raise ValueError("Unsupported Matryoshka dimensions")
                input_type = payload.get("input_type", "document")
                if input_type not in {"query", "document"}:
                    raise ValueError("input_type must be query or document")
            except (ValueError, TypeError, UnicodeError):
                self.error(400, "Invalid input, input_type or dimensions")
                return
            if not inference_lock.acquire(blocking=False):
                self.error(503, "Embedding server is busy; retry after the current inference finishes")
                return
            try:
                try:
                    vectors = encode(texts, input_type, dimensions)
                except Exception:
                    # Never include exception text: a model exception may echo input.
                    self.error(500, "Embedding inference failed")
                    return
            finally:
                inference_lock.release()
            self.reply(200, {"object": "list", "model": MODEL,
                             "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)],
                             "usage": {"prompt_tokens": 0, "total_tokens": 0}})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_dir", type=Path)
    parser.add_argument("--dimensions", type=int, choices=sorted(DIMENSIONS), default=1024)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--backend", choices=["mlx", "cpu"], default="mlx")
    parser.add_argument("--threads", type=int, default=6, help="CPU inference threads")
    parser.add_argument("--max-length", type=int, default=2048, help="CPU token limit (up to 8192)")
    args = parser.parse_args()
    if args.threads < 1 or not 1 <= args.max_length <= 8192:
        parser.error("threads must be positive and max-length must be 1–8192")
    if args.backend == "cpu":
        # Explicit local module path also works with python -I (no sys.path injection).
        spec = importlib.util.spec_from_file_location("ama_cpu_encoder", Path(__file__).with_name("cpu_encoder.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        encoder = module.load_cpu_encoder(args.model_dir, args.threads, args.max_length)
    else:
        encoder = load_encoder(args.model_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(encoder, args.dimensions, os.environ.get("AMA_EMBED_TOKEN", "")))
    server.timeout = 30
    print(f"AMA embeddings: http://127.0.0.1:{args.port}/v1 ({MODEL}; {args.backend})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
