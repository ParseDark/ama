"""Jina retrieval ONNX CPU backend. Does not import downloaded Python code."""
from pathlib import Path


def pool_and_normalize(hidden, mask, dimensions):
    import numpy as np
    # Last non-padding position works for either left or right padding.
    positions = np.where(mask != 0, np.arange(mask.shape[1]), -1).max(axis=1)
    if (positions < 0).any():
        raise ValueError("Empty token sequence")
    pooled = hidden[np.arange(hidden.shape[0]), positions, :dimensions]
    norms = np.linalg.norm(pooled, axis=1, keepdims=True)
    if not np.isfinite(pooled).all() or (norms <= 0).any():
        raise ValueError("Invalid model output")
    return (pooled / norms).tolist()


def load_cpu_encoder(path, threads=6, max_length=2048):
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer

    path = Path(path).resolve()
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    options.log_severity_level = 3
    session = ort.InferenceSession(str(path / "onnx" / "model.onnx"),
                                   sess_options=options, providers=["CPUExecutionProvider"])
    tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
    tokenizer.no_padding()
    tokenizer.enable_truncation(max_length=max_length)

    def encode(texts, input_type, dimensions):
        prefix = "Query: " if input_type == "query" else "Document: "
        vectors = []
        # Serialize individual inputs: no padding, bounded peak activation RAM.
        for text in texts:
            tokens = tokenizer.encode(prefix + text)
            ids = np.asarray([tokens.ids], dtype=np.int64)
            mask = np.ones_like(ids)
            hidden = session.run(["last_hidden_state"], {
                "input_ids": ids, "attention_mask": mask,
            })[0]
            vectors.extend(pool_and_normalize(hidden, mask, dimensions))
        return vectors
    return encode
