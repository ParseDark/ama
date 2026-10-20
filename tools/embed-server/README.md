# Local embeddings (optional)

Two manually started backends are available: **ONNX CPU** (tested on Intel macOS) and **MLX** (Apple Silicon only). No autostart is installed. The extension also works with embeddings off (default), or any compatible embedding endpoint.

## Intel Mac / CPU: ONNX

```sh
cd tools/embed-server
python3.12 -m venv .venv-cpu
.venv-cpu/bin/python -m pip install -r requirements-cpu.txt
# ~2.4 GB, official Jina retrieval model mirrored on ModelScope.
# Validates file sizes and pinned SHA-256 hashes; downloads no Python model code.
python3.12 download_cpu_model.py ./model-cpu/retrieval
.venv-cpu/bin/python -I embed_server.py ./model-cpu/retrieval \
  --backend cpu --threads 6 --max-length 2048 --port 8765
```

Weights: `jinaai/jina-embeddings-v5-text-small-retrieval`, **CC BY-NC 4.0**. This is the merged retrieval model, not the MLX artifact. Uses ONNX Runtime's CPU provider exclusively (no AMD/Metal acceleration), last-token pooling, `Query: `/`Document: ` prefixes, dimension truncation then L2 normalization. Inference is serialized one input at a time. CPU defaults to **2048 tokens per input** to limit activation memory; use `--max-length` up to 8192 with care. Long inputs are truncated, not chunked.

On the tested i5-13600KF / 64 GB Intel Mac, 6 threads: warm short-query medians **58–60 ms** (5 runs/language), ~1,080-character document **430 ms**, process RSS approximately **1.9 GiB**. Four synthetic English/Chinese retrieval cases passed 4/4; all seven output dimensions passed normalization checks. These are small sanity checks, not general quality or load benchmarks. A long input truncated to 2048 tokens took ~11.6 seconds in an earlier run, so bulk/long requests can exceed AMA's 2.5-second query timeout. Short requests queued behind them may time out too.

Optional background launch (no autostart):

```sh
nohup .venv-cpu/bin/python -I embed_server.py ./model-cpu/retrieval \
  --backend cpu --threads 6 --max-length 2048 --port 8765 \
  > /tmp/ama-embed-cpu-server.log 2>&1 < /dev/null &
echo $! > /tmp/ama-embed-cpu-server.pid
# Stop only the PID created above after checking it is the embedding process:
ps -p "$(< /tmp/ama-embed-cpu-server.pid)" -o pid,command
kill "$(< /tmp/ama-embed-cpu-server.pid)"
```

CPU math + HTTP + benchmark-metric tests: `.venv-cpu/bin/python -m unittest discover -s . -p 'test_*.py'` (10 tests). Without CPU dependencies, the 2 math tests are skipped and 8 other tests still run.

Expanded accuracy check: `python3 benchmark_accuracy.py --output /tmp/ama-accuracy.json`. See [the full synthetic evaluation](../../docs/benchmarks/README.md): 24 references / 68 queries, 1024-d top-1 52/56 (92.9%), recall@3 56/56, and explicit negation failures / selection-threshold tradeoffs. This is not a general model-accuracy claim.

## Apple Silicon: MLX

```sh
cd tools/embed-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
modelscope download --model jinaai/jina-embeddings-v5-text-small-retrieval-mlx --local_dir ./model
# REQUIRED: read and review model/model.py before running it.
python -I embed_server.py ./model --dimensions 1024 --port 8765
```

The model is about 1.2 GB, licensed **CC BY-NC 4.0** (personal/noncommercial use). Check the upstream license before use. The reviewed upstream implementation imports only dataclasses, typing and MLX; review your downloaded version rather than trusting this statement. No weights or upstream executable model code are bundled here.

In AMA → Settings → Memory → Embeddings, enable embeddings and use `http://127.0.0.1:8765/v1`, model `jina-v5-small`, dimensions `1024`, min similarity `0.28`.

Optional authentication: set `AMA_EMBED_TOKEN` in the environment before launching, and enter that token in AMA. Server binds only `127.0.0.1`; it sends **no CORS headers**, suppresses HTTP request logs, and never logs submitted text. Do not put it behind a public proxy. `python -I` ignores Python environment paths but does not suppress this explicit token environment variable.

```sh
python smoke_test.py
python eval_memory.py
python -m unittest discover -s . -p 'test_*.py'
```

### Troubleshooting timeouts

The service handles HTTP connections on separate threads so an idle Chromium preconnect cannot block subsequent requests. Inference remains single-flight to bound model memory: overlapping embedding requests receive **503 busy** immediately instead of queuing behind long jobs. Health checks stay responsive during inference. Client disconnects are handled quietly; they do not cancel an already-running model inference.

AMA's connection test has a **10-second** timeout; interactive query/reference matching generally uses **2.5 seconds** (history search: 5 seconds). A long CPU input or batch can still exceed these limits; the affected semantic paths fall back rather than waiting indefinitely. Retry Test connection once the current inference finishes if it reports busy. No token is needed unless the service was launched with `AMA_EMBED_TOKEN`.

If you are running the older single-threaded service, restart it with the updated script: a browser connection with no request bytes could previously occupy the server for up to its 30-second socket timeout. On this Intel host, the reproduced short-test HTTP latency fell from 8–17 seconds to 54–57 ms after the fix, including an intentionally idle concurrent socket. This is a short-input check, not a guarantee for long texts or concurrent batches.

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/embeddings` (also `/embeddings`). Inputs are strings or batches of up to 256 strings, up to 8 MB. Dimensions: 32, 64, 128, 256, 512, 768, 1024. `input_type` is `query` or `document` (default). Inference is serialized to bound memory. MLX inputs are truncated to 8192 tokens; CPU inputs use `--max-length` (default 2048).
