"""The neighbours step: each song's k nearest by cosine on the 32-d int8 embeddings of the spec.

The answer is n x k little-endian uint16: row i holds the indexes of song i's nearest songs, nearest
first (ties by the lower index), never i itself, then 0xFFFF where fewer than k other songs exist. The
spec carries only indexes and numbers, no hash, and so does the answer. 12,000 songs take a few seconds.
"""

import numpy as np

NONE = 0xFFFF


def nearest(emb, k=50, block=1024):
    """emb: (n, d) int8. Returns (n, k) uint16."""
    x = emb.astype(np.float32)
    x /= np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)
    n = len(x)
    real = min(k, n - 1)
    out = np.full((n, k), NONE, dtype="<u2")
    if real < 1:
        return out
    for s in range(0, n, block):
        sims = x[s : s + block] @ x.T
        rows = np.arange(len(sims))
        sims[rows, s + rows] = -np.inf
        top = np.argpartition(-sims, real - 1, axis=1)[:, :real]
        for r in rows:
            cand = top[r]
            out[s + r, :real] = cand[np.lexsort((cand, -sims[r, cand]))]
    return out


def decode_spec(spec):
    """(n x 32 int8 array) from a neighbours spec, checked."""
    import base64

    n, dim = spec["n"], spec["dim"]
    raw = base64.b64decode(spec["emb"], validate=True)
    if not (2 <= n <= 20000) or dim != 32 or len(raw) != n * dim:
        raise ValueError("bad_spec")
    return np.frombuffer(raw, dtype=np.int8).reshape(n, dim)
