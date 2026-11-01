"""The job (JOBS.md §3.4), the local run and the self-test.

The job: take the secrets out of the environment (what it starts begins with a clean one; hygiene, not a
wall, see net.py), fetch the spec
with the ci key; for each song, 4 at a time: download it in this process with the read-only key into the
job's temporary folder, checking its SHA-256 on the way, then hand the file to a worker process (a clean
environment, a memory limit, 10 minutes a song) that decodes it with a capped output, analyses it a chunk at
a time and deletes it. A worker that dies costs only the songs it held: the pool is made again and each
of them is tried once more alone, then counted failed. Whatever was analysed is uploaded, 50 results to
a part, the manifest last, then collected. A neighbours job works out each song's 50 nearest from the
spec's embeddings instead. The log carries counts and timings only: never a hash, a key, an address or a
server's words (JOBS.md §2).
"""

import hashlib
import json
import multiprocessing
import os
import re
import resource
import shutil
import signal
import tempfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from concurrent.futures.process import BrokenProcessPool

from . import NAME, VERSION, dsp, neighbours, result, synth
from .net import Bucket, Failed, Worker, take_secrets

HEX = re.compile(r"^[0-9a-f]{64}$")
JOB_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PART = 50
ITEM_SECONDS = 600
MAX_SONGS = 500
# A worker's address space. Measured 2026-11-01 with the model loaded: 2.2 GB of address space and
# 0.9 GB resident at rest; an hour-long WAV (the longest taken) peaks at 3.1 GB and 1.9 GB resident.
# Past it a song fails as `analyze` instead of starving the runner; four workers fit 16 GB.
WORKER_MEMORY = int(os.environ.get("JOBS_WORKER_MEMORY", str(4 * 1024**3)))


def log(line):
    """One line for the public log: counts and timings only."""
    print(line, flush=True)


def now_ms():
    return int(time.time() * 1000)


# --- one song, in a worker process --------------------------------------------------------------

_proc = {}


class SongTimeout(BaseException):
    """The song's 10 minutes are up (raised by the alarm; never caught by an `except OSError`)."""


def _expired(signum, frame):
    raise SongTimeout()


def _init(model_dir, tmp, limit=None):
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
    signal.signal(signal.SIGALRM, _expired)
    if limit:
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    _proc["tmp"] = tmp
    _proc["clap"] = None
    if model_dir:
        from .clap import Clap

        _proc["clap"] = Clap(model_dir, threads=1)


def _result(sig, windows, sha256):
    c = _proc.get("clap")
    r = result.build(sha256, sig, c.scores(windows, sig["energy"]) if c else None)
    if result.problems(r):
        raise Failed("analyze")
    return r


def analyse_audio(x, rate, sha256):
    """An in-memory song's result (the self-test's tones)."""
    return _result(*dsp.analyse(x, rate), sha256)


def analyse_file(path, sha256):
    """A local WAV (16-bit) or Opus file's result, read a chunk at a time."""
    if not str(path).endswith(".opus"):
        return _result(*dsp.analyse_source(dsp.from_wav(path)), sha256)
    wav = os.path.join(_proc["tmp"], f"wav-{os.getpid()}-{threading.get_ident()}.wav")
    try:
        dsp.decode_opus(path, wav)
        return _result(*dsp.analyse_source(dsp.from_wav(wav)), sha256)
    finally:
        if os.path.exists(wav):
            os.remove(wav)


def _song(item):
    """(result bytes or None, failure reason or None) for one downloaded song, in a worker."""
    path, sha256 = item
    # A test's way to kill a worker mid-song (jobs/audio/tests): never set in the workflow.
    if os.environ.get("JOBS_TEST_DIE_ON") and os.environ["JOBS_TEST_DIE_ON"] in str(path):
        os._exit(1)
    signal.alarm(ITEM_SECONDS)
    try:
        return result.encode(analyse_file(path, sha256)), None
    except dsp.TooLong:
        return None, "too_long"
    except dsp.DecodeError:
        return None, "decode"
    except SongTimeout:
        return None, "timeout"
    except Exception:  # noqa: BLE001 - the reason is all the log may say (MemoryError included)
        return None, "analyze"
    finally:
        signal.alarm(0)


# --- the job ------------------------------------------------------------------------------------


def _pool(model_dir, tmp, workers, limit=None):
    ctx = multiprocessing.get_context("spawn")
    return ProcessPoolExecutor(workers, mp_context=ctx, initializer=_init, initargs=(model_dir, tmp, limit))


class Pools:
    """The shared pool, made again when a worker dies; a pool of one for a song tried again alone."""

    def __init__(self, model_dir, tmp, workers):
        self.args = (model_dir, tmp)
        self.workers = workers
        self.lock = threading.Lock()
        self.pool = _pool(model_dir, tmp, workers, WORKER_MEMORY)

    def run(self, item):
        pool = self.pool
        try:
            return pool.submit(_song, item).result(timeout=ITEM_SECONDS + 120)
        except BrokenProcessPool:
            with self.lock:
                if self.pool is pool:
                    self.pool = _pool(*self.args, self.workers, WORKER_MEMORY)
            # Which song killed it is unknown: each one the dead pool held is tried once more alone.
            with _pool(*self.args, 1, WORKER_MEMORY) as alone:
                try:
                    return alone.submit(_song, item).result(timeout=ITEM_SECONDS + 120)
                except (BrokenProcessPool, FutureTimeout):
                    return None, "analyze"
        except FutureTimeout:
            return None, "timeout"

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)


def _one(bucket, pools, tmp, i, sha256):
    """One song: downloaded here (the workers are given no key), analysed in a worker, its file deleted."""
    audio = os.path.join(tmp, f"{i}.opus")
    try:
        bucket.fetch(sha256, audio)
        return pools.run((audio, sha256))
    except Failed as e:
        return None, e.reason if e.reason in ("download", "hash_mismatch") else "analyze"
    except Exception:  # noqa: BLE001
        return None, "analyze"
    finally:
        if os.path.exists(audio):
            os.remove(audio)


def _upload_analysis(w, job_id, shas, done, started):
    files, lines, failed = [], [], []
    for i, sha256 in enumerate(shas):
        data, reason = done[i]
        if data is None:
            failed.append({"sha256": sha256, "reason": reason})
            continue
        files.append({"sha256": sha256, "bytes": len(data), "result_sha256": hashlib.sha256(data).hexdigest()})
        lines.append(data)
    for p in range(0, len(lines), PART):
        w.put(job_id, f"part-{p // PART + 1:03d}.jsonl", b"".join(x + b"\n" for x in lines[p : p + PART]))
    manifest = {
        "v": 1,
        "job_id": job_id,
        "kind": "audio.analysis",
        "analyzer": {"name": NAME, "version": VERSION},
        "started_at": started,
        "finished_at": now_ms(),
        "files": files,
        "failed": failed,
    }
    w.put(job_id, "manifest.json", json.dumps(manifest, separators=(",", ":")).encode())
    return len(files), len(failed), (len(lines) + PART - 1) // PART


def run_analysis(w, bucket, job_id, spec, workers=None):
    shas = spec.get("shas")
    if not (isinstance(shas, list) and 1 <= len(shas) <= MAX_SONGS and all(isinstance(s, str) and HEX.match(s) for s in shas)):
        raise Failed("bad_spec")
    if len(set(shas)) != len(shas) or spec.get("v") != 2:
        raise Failed("bad_spec")
    # The Worker refuses results from any other analyzer version: say so before analysing anything.
    if spec.get("analyzer") != {"name": NAME, "version": VERSION}:
        raise Failed("analyzer_version")
    log(f"spec: {len(shas)} songs")
    started = now_ms()
    tmp = tempfile.mkdtemp(prefix="jobs-audio-", dir=os.environ.get("RUNNER_TEMP"))
    done = {}
    try:
        model_dir = None
        if os.environ.get("JOBS_CLAP", "on") != "off":
            t = time.time()
            from .clap import fetch

            try:
                model_dir = fetch(os.environ.get("JOBS_MODEL_CACHE") or os.path.join(tmp, "model"))
            except Exception:  # noqa: BLE001
                raise Failed("model") from None
            log(f"model: ready in {time.time() - t:.0f} s")
        workers = workers or int(os.environ.get("JOBS_WORKERS", "4"))
        pools = Pools(model_dir, tmp, workers)
        try:
            with ThreadPoolExecutor(workers) as threads:
                futures = [threads.submit(_one, bucket, pools, tmp, i, s) for i, s in enumerate(shas)]
                for i, f in enumerate(futures):
                    try:
                        done[i] = f.result()
                    except Exception:  # noqa: BLE001 - counted failed; the rest still go up
                        done[i] = (None, "analyze")
                    if (i + 1) % 50 == 0 or i + 1 == len(shas):
                        log(f"analysed: {i + 1} of {len(shas)}, {(now_ms() - started) / 1000:.0f} s")
        except Exception:  # noqa: BLE001 - whatever was analysed is still uploaded
            log("fail: pool")
        finally:
            pools.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for i in range(len(shas)):
        done.setdefault(i, (None, "analyze"))
    ok, bad, parts = _upload_analysis(w, job_id, shas, done, started)
    log(f"done: {ok} ok, {bad} failed, {(now_ms() - started) / 1000:.0f} s; uploaded {parts} parts and the manifest")
    return ok


def run_neighbours(w, job_id, spec):
    started = now_ms()
    try:
        emb = neighbours.decode_spec(spec)
    except (ValueError, KeyError, TypeError):
        raise Failed("bad_spec") from None
    if spec.get("v") != 1 or spec.get("k") != 50:
        raise Failed("bad_spec")
    log(f"spec: {len(emb)} songs")
    data = neighbours.nearest(emb, spec["k"]).tobytes()
    w.put(job_id, "neighbours.bin", data)
    manifest = {
        "v": 1,
        "job_id": job_id,
        "kind": "audio.neighbours",
        "analyzer": {"name": NAME, "version": VERSION},
        "started_at": started,
        "finished_at": now_ms(),
        "n": len(emb),
        "k": spec["k"],
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    w.put(job_id, "manifest.json", json.dumps(manifest, separators=(",", ":")).encode())
    log(f"done: {len(emb)} songs, {(now_ms() - started) / 1000:.1f} s")


def run_job(job_id):
    if not JOB_ID.match(job_id or ""):
        raise Failed("bad_job_id")
    keys = take_secrets()
    w = Worker(keys["TH_API"], keys["TH_CI_TOKEN"])
    spec = w.spec(job_id)
    if not isinstance(spec, dict) or spec.get("job_id") != job_id:
        raise Failed("bad_spec")
    if spec.get("kind") == "audio.analysis":
        bucket = Bucket(keys["R2_ACCOUNT_ID"], keys["R2_JOBS_ACCESS_KEY_ID"], keys["R2_JOBS_SECRET"])
        run_analysis(w, bucket, job_id, spec)
    elif spec.get("kind") == "audio.neighbours":
        run_neighbours(w, job_id, spec)
    else:
        raise Failed("bad_spec")
    state = (w.collect(job_id) or {}).get("state")
    log(f"collect: {state if state in ('validating', 'applied') else 'unknown'}")


# --- local run and self-test --------------------------------------------------------------------


def run_local(folder, with_clap):
    """Each WAV or Opus file in `folder` analysed on this machine, one JSON result a line on stdout."""
    _init(_model() if with_clap else None, tempfile.gettempdir())
    names = sorted(f for f in os.listdir(folder) if f.endswith((".wav", ".opus")))
    for f in names:
        path = os.path.join(folder, f)
        with open(path, "rb") as fh:
            sha256 = hashlib.sha256(fh.read()).hexdigest()
        print(result.encode(analyse_file(path, sha256)).decode(), flush=True)
    return len(names)


def _model():
    from .clap import fetch

    return fetch(os.environ.get("JOBS_MODEL_CACHE", os.path.join(tempfile.gettempdir(), "th-clap")))


def checks(with_clap=False):
    """The self-test's cases on synthetic audio with known answers: [(name, passed)]."""
    _init(_model() if with_clap else None, tempfile.gettempdir())
    out = []

    def run(x, rate):
        return analyse_audio(x, rate, "0" * 64)

    r = run(*synth.sine())
    out.append(("loudness of a full-scale 997 Hz sine is -3.01 LUFS", abs(r["lufs_i"] + 3.01) <= 0.1))
    out.append(("its true peak is 0 dBTP", abs(r["true_peak_db"]) <= 0.2))
    r = run(*synth.sine(amp=0.1, channels=2))
    out.append(("a -20 dBFS stereo sine is -20 LUFS", abs(r["lufs_i"] + 20) <= 0.1))
    for bpm in (90, 120, 128, 174):
        r = run(*synth.clicks(bpm))
        out.append((f"a click track at {bpm} BPM", r["bpm"] is not None and abs(r["bpm"] - bpm) <= bpm * 0.02))
    out.append(("chords in C major", run(*synth.chords(synth.C_MAJOR))["key"] == "C"))
    out.append(("chords in A minor", run(*synth.chords(synth.A_MINOR))["key"] == "Am"))
    r = run(*synth.padded(*synth.sine(440, 5, 0.5)))
    out.append(("2 s of silence before, 3 s after", abs(r["start_silence_ms"] - 2000) <= 20 and abs(r["end_silence_ms"] - 3000) <= 20))
    quiet = run(*synth.sine(440, 10, 0.01))["energy"]
    out.append(("loud noise has more energy than a quiet tone", run(*synth.noise())["energy"] > quiet + 0.3))
    if with_clap:
        r = run(*synth.chords(synth.C_MAJOR))
        out.append(("CLAP gives 16 moods and a 32-d unit embedding", r["moods"] is not None and len(r["emb"]) == 32 and abs(sum(x * x for x in r["emb"]) - 1) < 0.01))
    return out


def selftest(with_clap=False):
    results = checks(with_clap)
    passed = sum(1 for _, ok in results if ok)
    log(f"selftest: {passed} of {len(results)} passed")
    return passed == len(results)
