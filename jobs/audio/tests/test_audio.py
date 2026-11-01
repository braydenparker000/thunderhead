"""The analyzer on synthetic audio with known answers (no network, no model, nobody's music).

python -m unittest discover -s jobs/audio/tests -t .   (numpy and scipy; tests/jobs-audio.test.mjs runs it
when they are installed)
"""

import hashlib
import http.server
import json
import math
import os
import tempfile
import threading
import unittest

import numpy as np

from jobs.audio import NAME, VERSION, dsp, neighbours, projection, result, run, synth
from jobs.audio.moods import MOODS
from jobs.audio.net import SECRETS, Bucket, Failed, Worker, take_secrets


class Signal(unittest.TestCase):
    def test_every_selftest_case(self):
        for name, ok in run.checks():
            with self.subTest(name):
                self.assertTrue(ok)

    def test_a_local_wav_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            synth.write_wav(os.path.join(d, "tone.wav"), *synth.padded(*synth.chords(synth.A_MINOR), 1.0, 0.5))
            run._init(None, d)
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
        h = Bucket("0" * 32, "AKIDEXAMPLE", "s" * 40)._headers("/jarvis-music/native/audio/" + "c" * 64 + ".opus")
        self.assertTrue(h["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"))
        self.assertIn("/auto/s3/aws4_request", h["Authorization"])
        self.assertNotIn("s" * 40, json.dumps(h))
        self.assertTrue(math.isfinite(len(h["x-amz-date"])))


class Secrets(unittest.TestCase):
    def test_the_job_takes_its_secrets_out_of_the_environment(self):
        keys = {"TH_API": "http://127.0.0.1:9", "TH_CI_TOKEN": "t" * 20, "R2_ACCOUNT_ID": "a", "R2_JOBS_ACCESS_KEY_ID": "k", "R2_JOBS_SECRET": "s"}
        old = {k: os.environ.get(k) for k in keys}
        os.environ.update(keys)
        try:
            got = take_secrets()
            self.assertEqual(got, keys)
            for k in SECRETS:
                self.assertNotIn(k, os.environ, f"{k} would reach opusdec and the workers")
            with self.assertRaises(Failed):
                take_secrets()
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_opusdec_gets_a_bare_environment_and_a_capped_file(self):
        import inspect

        src = inspect.getsource(dsp.decode_opus)
        self.assertIn('env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}', src)
        self.assertIn("preexec_fn=_cap_output", src)


class _Redirect(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):  # noqa: N802
        self.seen.append(self.headers.get("Authorization"))
        self.send_response(302)
        self.send_header("Location", f"http://127.0.0.1:{self.server.server_address[1]}/elsewhere")
        self.end_headers()

    def log_message(self, *a):
        pass


class Redirects(unittest.TestCase):
    def test_a_redirect_is_refused_so_the_token_goes_nowhere_else(self):
        srv = http.server.HTTPServer(("127.0.0.1", 0), _Redirect)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        _Redirect.seen.clear()
        try:
            w = Worker(f"http://127.0.0.1:{srv.server_address[1]}", "token-" + "x" * 20)
            with self.assertRaises(Failed) as e:
                w.spec("0190a0a0-0000-7000-8000-000000000000")
            self.assertEqual(e.exception.reason, "spec_fetch")
            self.assertEqual(len(_Redirect.seen), 1, "the redirect was not followed")
        finally:
            srv.shutdown()
            srv.server_close()


class Stream(unittest.TestCase):
    def test_chunked_reading_measures_what_a_whole_read_does(self):
        x, rate = synth.clicks(126, 34)
        x = np.vstack([x, 0.5 * x])
        whole = dsp.analyse(x, rate)[0]
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.wav")
            synth.write_wav(p, x, rate)
            streamed = dsp.analyse_source(dsp.from_wav(p))[0]
        self.assertAlmostEqual(whole["lufs_i"], streamed["lufs_i"], delta=0.05)
        self.assertAlmostEqual(whole["true_peak_db"], streamed["true_peak_db"], delta=0.05)
        self.assertAlmostEqual(streamed["bpm"], 126, delta=126 * 0.02)
        self.assertEqual(whole["duration_ms"], streamed["duration_ms"])

    def test_a_sine_across_chunk_edges_peaks_at_its_level(self):
        x, rate = synth.sine(1000, 25, 0.5)
        tp = dsp.analyse(x, rate)[0]["true_peak_db"]
        self.assertAlmostEqual(tp, 20 * math.log10(0.5), delta=0.05)

    def test_too_long_is_refused_from_the_header_before_reading(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "long.wav")
            synth.write_wav(p, *synth.sine(440, 5, 0.1))
            old = dsp.MAX_SECONDS
            dsp.MAX_SECONDS = 3
            try:
                with self.assertRaises(dsp.TooLong):
                    dsp.from_wav(p)
                run._init(None, d)
                self.assertEqual(run._song((p, "a" * 64)), (None, "too_long"))
            finally:
                dsp.MAX_SECONDS = old


class DeadWorker(unittest.TestCase):
    def test_a_worker_that_dies_costs_only_its_song_and_the_rest_go_on(self):
        with tempfile.TemporaryDirectory() as d:
            paths = []
            for i, bpm in enumerate((100, 110, 120)):
                p = os.path.join(d, f"song-{i}{'-die' if i == 1 else ''}.wav")
                synth.write_wav(p, *synth.clicks(bpm, 6))
                paths.append(p)
            os.environ["JOBS_TEST_DIE_ON"] = "-die"
            pools = run.Pools(None, d, 2)
            try:
                out = [pools.run((p, "a" * 64)) for p in paths]
            finally:
                pools.close()
                os.environ.pop("JOBS_TEST_DIE_ON")
        self.assertEqual(out[1], (None, "analyze"))
        self.assertIsNotNone(out[0][0])
        self.assertIsNotNone(out[2][0])


class Partial(unittest.TestCase):
    def test_whatever_happens_to_the_songs_the_manifest_still_goes_up(self):
        class Gone:
            def fetch(self, sha256, dest):
                raise Failed("download", 404)

        w = FakeWorker()
        shas = [hashlib.sha256(str(i).encode()).hexdigest() for i in range(3)]
        spec = {"shas": shas, "v": 2, "analyzer": {"name": NAME, "version": VERSION}}
        os.environ["JOBS_CLAP"] = "off"
        try:
            self.assertEqual(run.run_analysis(w, Gone(), "0190a0a0-0000-7000-8000-000000000000", spec, workers=1), 0)
        finally:
            os.environ.pop("JOBS_CLAP")
        m = json.loads(w.files["manifest.json"])
        self.assertEqual([f["reason"] for f in m["failed"]], ["download"] * 3)

    def test_another_analyzer_version_is_refused_before_any_song(self):
        spec = {"shas": ["a" * 64], "v": 2, "analyzer": {"name": NAME, "version": "1.0.0"}}
        with self.assertRaises(Failed) as e:
            run.run_analysis(FakeWorker(), None, "0190a0a0-0000-7000-8000-000000000000", spec)
        self.assertEqual(e.exception.reason, "analyzer_version")


if __name__ == "__main__":
    unittest.main()
