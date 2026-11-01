"""The analyzer on synthetic audio with known answers (no network, no model, nobody's music).

python -m unittest discover -s jobs/audio/tests -t .   (numpy and scipy; tests/jobs-audio.test.mjs runs it
when they are installed)
"""

import hashlib
import json
import math
import os
import tempfile
import unittest

import numpy as np

from jobs.audio import neighbours, projection, result, run, synth
from jobs.audio.moods import MOODS
from jobs.audio.net import Bucket


class Signal(unittest.TestCase):
    def test_every_selftest_case(self):
        for name, ok in run.checks():
            with self.subTest(name):
                self.assertTrue(ok)

    def test_a_local_wav_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            synth.write_wav(os.path.join(d, "tone.wav"), *synth.padded(*synth.chords(synth.A_MINOR), 1.0, 0.5))
            run._init(None, d, False)
            r = run.analyse_file(os.path.join(d, "tone.wav"), "a" * 64)
        self.assertEqual(r["key"], "Am")
        self.assertAlmostEqual(r["start_silence_ms"], 1000, delta=20)
        self.assertEqual(result.problems(r), [])
        self.assertIsNone(r["moods"])  # no model: the CLAP fields wait


class Result(unittest.TestCase):
    def sig(self, **over):
        s = {
            "duration_ms": 200_000, "sample_rate": 48000, "channels": 2, "lufs_i": -9.123, "true_peak_db": 4.0,
            "lra": 7.5, "bpm": 123.456, "bpm_conf": 0.8, "key": "F#m", "key_conf": 0.5, "start_silence_ms": 10,
            "end_silence_ms": 300, "energy": 0.7,
        }  # fmt: skip
        s.update(over)
        return s

    def test_fields_in_order_clamped_and_rounded(self):
        clap = {"valence": 0.2, "arousal": 0.9, "vocals": 0.1, "moods": {k: 0.5 for k in MOODS}, "emb": [0.1] * 32}
        r = result.build("b" * 64, self.sig(), clap)
        self.assertEqual(list(r), result.FIELDS)
        self.assertEqual(r["true_peak_db"], 3)
        self.assertEqual(r["bpm"], 123.46)
        self.assertEqual(r["emb_v"], 1)
        self.assertEqual(result.problems(r), [])
        self.assertLess(len(result.encode(r)), 2000)

    def test_bad_values_are_named_and_never_nan(self):
        r = result.build("b" * 64, self.sig(bpm=float("nan"), lufs_i=float("-inf")))
        self.assertIsNone(r["bpm"])
        json.loads(result.encode(r))
        bad = dict(r, key="H", sha256="B" * 64, start_silence_ms=199_000, end_silence_ms=2_000)
        self.assertEqual(set(result.problems(bad)), {"key", "sha256", "silence"})
        self.assertIn("fields", result.problems({**r, "note": "words"}))


class Projection(unittest.TestCase):
    def test_fixed_bit_for_bit_and_orthonormal(self):
        raw = projection.matrix_bytes(projection.generate())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), projection.SHA256)
        m = projection.load()
        self.assertLess(np.abs(m.T @ m - np.eye(32)).max(), 1e-5)


class Neighbours(unittest.TestCase):
    def test_nearest_stay_in_their_cluster_never_themselves(self):
        rng = np.random.default_rng(3)
        centres = np.eye(32)[:4] * 100
        emb = np.clip(np.vstack([centres[i % 4] + rng.normal(0, 8, 32) for i in range(40)]), -127, 127).astype(np.int8)
        nb = neighbours.nearest(emb, 50)
        self.assertEqual(nb.shape, (40, 50))
        for i in range(40):
            row = nb[i]
            self.assertNotIn(i, row[:39])
            self.assertEqual(len(set(row[:39])), 39)
            self.assertTrue(all(x == 0xFFFF for x in row[39:]))
            self.assertTrue(all(j % 4 == i % 4 for j in row[:9]))

    def test_the_spec_is_checked(self):
        with self.assertRaises(ValueError):
            neighbours.decode_spec({"n": 3, "dim": 32, "emb": "AAAA"})


class FakeWorker:
    def __init__(self):
        self.files = {}

    def put(self, job_id, name, data):
        self.files[name] = data


class Upload(unittest.TestCase):
    def test_parts_of_fifty_then_the_manifest(self):
        shas = [hashlib.sha256(str(i).encode()).hexdigest() for i in range(120)]
        done = {i: (b'{"x":%d}' % i, None) if i % 40 else (None, "decode") for i in range(120)}
        w = FakeWorker()
        ok, bad, parts = run._upload_analysis(w, "0190a0a0-0000-7000-8000-000000000000", shas, done, 1)
        self.assertEqual((ok, bad, parts), (117, 3, 3))
        self.assertEqual(list(w.files)[-1], "manifest.json")
        m = json.loads(w.files["manifest.json"])
        self.assertEqual([f["reason"] for f in m["failed"]], ["decode"] * 3)
        lines = w.files["part-001.jsonl"].split(b"\n")[:-1]
        self.assertEqual(len(lines), 50)
        self.assertEqual(hashlib.sha256(lines[0]).hexdigest(), m["files"][0]["result_sha256"])
        self.assertEqual(m["files"][0]["sha256"], shas[1])


class Signing(unittest.TestCase):
    def test_a_get_signed_for_the_bucket_and_nothing_secret_in_the_url(self):
        env = {"R2_ACCOUNT_ID": "0" * 32, "R2_JOBS_ACCESS_KEY_ID": "AKIDEXAMPLE", "R2_JOBS_SECRET": "s" * 40}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            h = Bucket()._headers("/jarvis-music/native/audio/" + "c" * 64 + ".opus")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k)
                else:
                    os.environ[k] = v
        self.assertTrue(h["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"))
        self.assertIn("/auto/s3/aws4_request", h["Authorization"])
        self.assertNotIn("s" * 40, json.dumps(h))
        self.assertTrue(math.isfinite(len(h["x-amz-date"])))


if __name__ == "__main__":
    unittest.main()
