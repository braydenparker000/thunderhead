"""CLAP: the embedding, the moods, valence, arousal and vocals (docs/product/apps/MUSIC.md §9.1).

The model is LAION's `clap-htsat-unfused` (Apache-2.0 on its model card; the code that runs it is
Hugging Face transformers, Apache-2.0, on PyTorch, BSD-3), fetched at a pinned revision and refused
unless its weights' SHA-256 matches WEIGHTS_SHA256. It runs on the CPU in float32. LAION's music
checkpoint (`larger_clap_music`, also Apache-2.0) was tried first and set aside: under transformers
5.22.1 its text tower gives every prompt the same embedding (cosine 0.999 between "calm music" and
"a dog barking", measured 2026-11-01), so no mood could be told from another.

A song is heard as up to three 10-second windows (around 25 %, 50 % and 75 % of it; the whole song when
shorter than 30 s), each embedded and normalised, then averaged and normalised again: one 512-d vector.
Windows are exactly 10 s, so the feature extractor never takes its random crop. The moods and the pairs
are scored as moods.py says; the 32-d embedding is that vector through projection.py's fixed matrix,
normalised, rounded to 4 places.
"""

import hashlib
import math
import os

import numpy as np

from . import moods, projection

MODEL = "laion/clap-htsat-unfused"
REVISION = "8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a"
WEIGHTS = "pytorch_model.bin"
WEIGHTS_SHA256 = "1cd3c601bc4afe0fa87be3de4c13dd2cfadd249fac1e29acf74a9b296c3219bb"
FILES = [
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "special_tokens_map.json",
    WEIGHTS,
]
RATE = 48000


class ClapError(Exception):
    pass


def fetch(cache_dir):
    """The pinned model's folder, downloaded once into `cache_dir` and checked."""
    from huggingface_hub import hf_hub_download

    path = None
    for f in FILES:
        path = hf_hub_download(MODEL, f, revision=REVISION, cache_dir=cache_dir)
    folder = os.path.dirname(path)
    h = hashlib.sha256()
    with open(os.path.join(folder, WEIGHTS), "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != WEIGHTS_SHA256:
        raise ClapError("weights_mismatch")
    return folder


def _unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def _sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, x))))


class Clap:
    """The model, loaded once per process, and the prompts' text embeddings."""

    def __init__(self, folder, threads=1):
        import torch
        from transformers import ClapModel, ClapProcessor

        torch.set_num_threads(threads)
        self.torch = torch
        self.model = ClapModel.from_pretrained(folder).eval()
        self.processor = ClapProcessor.from_pretrained(folder)
        self.scale = float(self.model.logit_scale_a.detach().exp())
        self.proj = projection.load()
        prompts = [*moods.MOODS.values(), *moods.VALENCE, *moods.AROUSAL, *moods.VOCALS]
        t = self._features(self.processor(text=prompts, return_tensors="pt", padding=True), "text")
        self.text = dict(zip(prompts, t))

    def _features(self, inputs, kind):
        with self.torch.no_grad():
            if kind == "text":
                out = self.model.get_text_features(**inputs)
            else:
                out = self.model.get_audio_features(**inputs)
        out = getattr(out, "pooler_output", out)
        return _unit(out.detach().cpu().numpy().astype(np.float64))

    def embed(self, windows):
        """The song's 512-d unit vector, from its 10-second windows (48 kHz mono; dsp.Windows)."""
        wins = [np.asarray(w, dtype=np.float32) for w in windows]
        inputs = self.processor(audio=wins, sampling_rate=RATE, return_tensors="pt")
        return _unit(self._features(inputs, "audio").mean(axis=0))

    def _versus(self, a, first, second):
        return _sigmoid(self.scale * (float(a @ self.text[first]) - float(a @ self.text[second])))

    def scores(self, windows, signal_energy):
        """moods, valence, arousal, vocals, emb and emb_v for a result."""
        a = self.embed(windows)
        sims = {k: float(a @ self.text[p]) for k, p in moods.MOODS.items()}
        mean = sum(sims.values()) / len(sims)
        mood = {k: _sigmoid(self.scale * (s - mean)) for k, s in sims.items()}
        e = _unit(a @ self.proj)
        return {
            "valence": self._versus(a, *moods.VALENCE),
            "arousal": 0.5 * self._versus(a, *moods.AROUSAL) + 0.5 * signal_energy,
            "vocals": self._versus(a, *moods.VOCALS),
            "moods": mood,
            "emb": [round(float(x), 4) for x in e],
            "emb_v": 1,
        }
