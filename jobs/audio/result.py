"""One song's result, schema v2 (shared/contract/listen.ts ANALYSIS_SCHEMA), as the job uploads it.

Numbers and keys from fixed lists only, never words: the run is public and its output untrusted, so the
Worker checks every field again. Here the values are clamped into their ranges and rounded, the fields
put in the schema's order, and the line kept under 8 KB; problems() is a local copy of the Worker's
checks, so a broken analyzer fails before upload instead of at collect.
"""

import json
import math

from . import NAME, VERSION
from .moods import MOODS

KEYS = [k + m for m in ("", "m") for k in ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")]
RATES = (8000, 16000, 24000, 44100, 48000)
FIELDS = [
    "v", "sha256", "analyzer", "duration_ms", "sample_rate", "channels", "lufs_i", "true_peak_db", "lra",
    "bpm", "bpm_conf", "key", "key_conf", "start_silence_ms", "end_silence_ms", "energy", "valence",
    "arousal", "vocals", "moods", "emb", "emb_v",
]  # fmt: skip
MAX_BYTES = 8192


def _num(x, lo, hi, places):
    if x is None or not math.isfinite(x):
        return None
    return round(min(hi, max(lo, float(x))), places)


def build(sha256, sig, clap=None):
    """The result from the signal fields (dsp.analyse) and, when the model ran, CLAP's (clap.scores)."""
    dur = int(min(14_400_000, max(1000, sig["duration_ms"])))
    start = int(min(dur, max(0, sig["start_silence_ms"])))
    end = int(min(dur - start, max(0, sig["end_silence_ms"])))
    c = clap or {}
    moods = c.get("moods")
    r = {
        "v": 2,
        "sha256": sha256,
        "analyzer": {"name": NAME, "version": VERSION},
        "duration_ms": dur,
        "sample_rate": int(sig["sample_rate"]),
        "channels": int(sig["channels"]),
        "lufs_i": _num(sig["lufs_i"], -70, 0, 2),
        "true_peak_db": _num(sig["true_peak_db"], -60, 3, 2),
        "lra": _num(sig["lra"], 0, 40, 2),
        "bpm": _num(sig["bpm"], 30, 300, 2),
        "bpm_conf": _num(sig["bpm_conf"], 0, 1, 3) or 0.0,
        "key": sig["key"] if sig["key"] in KEYS else None,
        "key_conf": _num(sig["key_conf"], 0, 1, 3) or 0.0,
        "start_silence_ms": start,
        "end_silence_ms": end,
        "energy": _num(sig["energy"], 0, 1, 3) or 0.0,
        "valence": _num(c.get("valence"), 0, 1, 3),
        "arousal": _num(c.get("arousal"), 0, 1, 3),
        "vocals": _num(c.get("vocals"), 0, 1, 3),
        "moods": {k: _num(moods[k], 0, 1, 3) for k in MOODS} if moods else None,
        "emb": [_num(x, -1, 1, 4) for x in c["emb"]] if c.get("emb") else None,
        "emb_v": 1 if c.get("emb") else None,
    }
    # Silence measures as the floor of each range, never as a missing value.
    for k, floor in (("lufs_i", -70.0), ("true_peak_db", -60.0), ("lra", 0.0)):
        if r[k] is None:
            r[k] = floor
    return r


def encode(r):
    """The exact bytes uploaded: compact JSON, ASCII, no NaN."""
    return json.dumps(r, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _unit(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= 1


def problems(r):
    """What the Worker would refuse in this result (an empty list when none)."""
    out = []
    if list(r) != FIELDS:
        out.append("fields")
    if r.get("v") != 2 or r.get("analyzer") != {"name": NAME, "version": VERSION}:
        out.append("version")
    s = r.get("sha256")
    if not (isinstance(s, str) and len(s) == 64 and all(ch in "0123456789abcdef" for ch in s)):
        out.append("sha256")
    if not (isinstance(r.get("duration_ms"), int) and 1000 <= r["duration_ms"] <= 14_400_000):
        out.append("duration_ms")
    if r.get("sample_rate") not in RATES or r.get("channels") not in (1, 2):
        out.append("format")
    for k, lo, hi in (("lufs_i", -70, 0), ("true_peak_db", -60, 3), ("lra", 0, 40)):
        if not (isinstance(r.get(k), (int, float)) and lo <= r[k] <= hi):
            out.append(k)
    if r.get("bpm") is not None and not 30 <= r["bpm"] <= 300:
        out.append("bpm")
    if r.get("key") is not None and r["key"] not in KEYS:
        out.append("key")
    for k in ("bpm_conf", "key_conf", "energy"):
        if not _unit(r.get(k)):
            out.append(k)
    for k in ("valence", "arousal", "vocals"):
        if r.get(k) is not None and not _unit(r[k]):
            out.append(k)
    st, en = r.get("start_silence_ms"), r.get("end_silence_ms")
    if not (isinstance(st, int) and isinstance(en, int) and st >= 0 and en >= 0 and st + en <= r.get("duration_ms", 0)):
        out.append("silence")
    m = r.get("moods")
    if m is not None and (list(m) != list(MOODS) or not all(_unit(x) for x in m.values())):
        out.append("moods")
    e = r.get("emb")
    if e is not None and (len(e) != 32 or not all(isinstance(x, (int, float)) and -1 <= x <= 1 for x in e)):
        out.append("emb")
    if (e is None) != (r.get("emb_v") is None):
        out.append("emb_v")
    if len(encode(r)) > MAX_BYTES:
        out.append("size")
    return out
