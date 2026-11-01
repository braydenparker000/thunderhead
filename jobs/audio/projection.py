"""The fixed projection from CLAP's 512 dimensions to the 32 every result carries (emb_v 1).

A seeded random orthogonal projection, not one fitted to any audio: no owner song and no outside
collection shapes it, and any run on any machine makes the same matrix bit for bit. Entries are +1 or -1
from a splitmix64 stream seeded with SEED; the 32 columns are then made orthonormal by modified
Gram-Schmidt in float64, using only + - * / and sqrt (all correctly rounded in IEEE 754, so the bits
do not depend on the platform's maths library), and kept as float32. SHA256 is the hash of the matrix's
bytes (512 x 32 float32, little-endian, row by row); load() refuses a matrix that differs, so results
from different runs stay comparable. A better projection (PCA on public, non-owner music) would be
emb_v 2, and every song would be analysed again.
"""

import hashlib
import math
import struct

DIM_IN = 512
DIM_OUT = 32
SEED = 0x7468617564696F31  # "thaudio1"
SHA256 = "b07371da59b415ab539137de11d7356bf63bed668052595c17b8bbe8b6a94cf4"
MASK = (1 << 64) - 1


def _splitmix64(state):
    while True:
        state = (state + 0x9E3779B97F4A7C15) & MASK
        z = state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        yield z ^ (z >> 31)


def generate():
    """The matrix as 32 columns of 512 floats (float64, before the float32 cast)."""
    stream = _splitmix64(SEED)
    cols = [[1.0 if next(stream) >> 63 else -1.0 for _ in range(DIM_IN)] for _ in range(DIM_OUT)]
    for j in range(DIM_OUT):
        v = cols[j]
        for i in range(j):
            u = cols[i]
            dot = 0.0
            for k in range(DIM_IN):
                dot += u[k] * v[k]
            for k in range(DIM_IN):
                v[k] -= dot * u[k]
        norm = 0.0
        for k in range(DIM_IN):
            norm += v[k] * v[k]
        norm = math.sqrt(norm)
        for k in range(DIM_IN):
            v[k] /= norm
    return cols


def matrix_bytes(cols):
    """Row by row (512 rows of 32), float32 little-endian."""
    return b"".join(struct.pack("<32f", *(cols[j][r] for j in range(DIM_OUT))) for r in range(DIM_IN))


def load():
    """The matrix as a numpy float32 array of shape (512, 32), checked against SHA256."""
    import numpy as np

    raw = matrix_bytes(generate())
    if hashlib.sha256(raw).hexdigest() != SHA256:
        raise RuntimeError("projection_mismatch")
    return np.frombuffer(raw, dtype="<f4").reshape(DIM_IN, DIM_OUT).copy()


if __name__ == "__main__":
    print(hashlib.sha256(matrix_bytes(generate())).hexdigest())
