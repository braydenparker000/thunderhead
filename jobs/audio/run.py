"""The job (JOBS.md §3.4), the local run and the self-test.

The job: fetch the spec with the ci key; for each song, with JOBS_WORKERS processes (4) and 10 minutes
each at most, download it with the read-only key into the job's temporary folder, check its SHA-256,
decode, analyse, delete it; then upload the results 50 to a part, the manifest last, and collect. A
neighbours job works out each song's 50 nearest from the spec's embeddings instead. The log carries
counts and timings only: never a hash, a key, an address or a server's words (JOBS.md §2).
"""

import hashlib
import json
import multiprocessing
import os
import re
import shutil
import signal
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor

from . import NAME, VERSION, dsp, neighbours, result, synth
from .net import Bucket, Failed, Worker

HEX = re.compile(r"^[0-9a-f]{64}$")
JOB_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PART = 50
ITEM_SECONDS = 600
MAX_SONGS = 500


def log(line):
    """One line for the public log: counts and timings only."""
    print(line, flush=True)


def now_ms():
    return int(time.time() * 1000)


# --- one song, in a worker process --------------------------------------------------------------

_proc = {}


def _expired(signum, frame):
    raise TimeoutError()


def _init(model_dir, tmp, ci):
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
    signal.signal(signal.SIGALRM, _expired)
    _proc["tmp"] = tmp
    _proc["bucket"] = Bucket() if ci else None
    _proc["clap"] = None
    if model_dir:
        from .clap import Clap

        _proc["clap"] = Clap(model_dir, threads=1)


def analyse_audio(x, rate, sha256):
    sig, mono48 = dsp.analyse(x, rate)
    c = _proc.get("clap")
    r = result.build(sha256, sig, c.scores(mono48, sig["energy"]) if c else None)
    if result.problems(r):
        raise Failed("analyze")
    return r


def analyse_file(path, sha256):
    """A local WAV (16-bit) or Opus file's result."""
    if str(path).endswith(".opus"):
        wav = os.path.join(_proc["tmp"], f"local-{os.getpid()}.wav")
        try:
            dsp.decode_opus(path, wav)
            x, rate = dsp.read_wav(wav)
        finally:
            if os.path.exists(wav):
                os.remove(wav)
    else:
        x, rate = dsp.read_wav(path)
    return analyse_audio(x, rate, sha256)


def _song(item):
    """(index, result bytes or None, failure reason or None): one song of the job, start to end."""
    i, sha256 = item
    audio = os.path.join(_proc["tmp"], f"{os.getpid()}-{i}.opus")
    wav = audio[:-5] + ".wav"
    signal.alarm(ITEM_SECONDS)
    try:
        _proc["bucket"].fetch(sha256, audio)
        dsp.decode_opus(audio, wav)
        os.remove(audio)
        x, rate = dsp.read_wav(wav)
        os.remove(wav)
        return i, result.encode(analyse_audio(x, rate, sha256)), None
    except Failed as e:
        return i, None, e.reason if e.reason in ("download", "hash_mismatch") else "analyze"
    except dsp.DecodeError:
        return i, None, "decode"
    except TimeoutError:
        return i, None, "timeout"
    except Exception:  # noqa: BLE001 - the reason is all the log may say
        return i, None, "analyze"
    finally:
        signal.alarm(0)
        for f in (audio, wav):
            if os.path.exists(f):
                os.remove(f)


# --- the job ------------------------------------------------------------------------------------


def _pool(model_dir, tmp, ci, workers):
    ctx = multiprocessing.get_context("spawn")
    return ProcessPoolExecutor(workers, mp_context=ctx, initializer=_init, initargs=(model_dir, tmp, ci))


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


def run_analysis(w, job_id, spec):
    shas = spec.get("shas")
    if not (isinstance(shas, list) and 1 <= len(shas) <= MAX_SONGS and all(isinstance(s, str) and HEX.match(s) for s in shas)):
        raise Failed("bad_spec")
    if len(set(shas)) != len(shas) or spec.get("v") != 2:
        raise Failed("bad_spec")
    log(f"spec: {len(shas)} songs")
    started = now_ms()
    tmp = tempfile.mkdtemp(prefix="jobs-audio-", dir=os.environ.get("RUNNER_TEMP"))
    try:
        model_dir = None
        if os.environ.get("JOBS_CLAP", "on") != "off":
            t = time.time()
            from .clap import ClapError, fetch

            try:
                model_dir = fetch(os.environ.get("JOBS_MODEL_CACHE") or os.path.join(tmp, "model"))
            except (ClapError, Exception):  # noqa: BLE001
                raise Failed("model") from None
            log(f"model: ready in {time.time() - t:.0f} s")
        done = {}
        workers = int(os.environ.get("JOBS_WORKERS", "4"))
        with _pool(model_dir, tmp, True, workers) as ex:
            for n, (i, data, reason) in enumerate(ex.map(_song, list(enumerate(shas))), 1):
                done[i] = (data, reason)
                if n % 50 == 0 or n == len(shas):
                    log(f"analysed: {n} of {len(shas)}, {(now_ms() - started) / 1000:.0f} s")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
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
    w = Worker()
    spec = w.spec(job_id)
    if not isinstance(spec, dict) or spec.get("job_id") != job_id:
        raise Failed("bad_spec")
    if spec.get("kind") == "audio.analysis":
        run_analysis(w, job_id, spec)
    elif spec.get("kind") == "audio.neighbours":
        run_neighbours(w, job_id, spec)
    else:
        raise Failed("bad_spec")
    state = (w.collect(job_id) or {}).get("state")
    log(f"collect: {state if state in ('validating', 'applied') else 'unknown'}")


# --- local run and self-test --------------------------------------------------------------------


def run_local(folder, with_clap):
    """Each WAV or Opus file in `folder` analysed on this machine, one JSON result a line on stdout."""
    _init(_model() if with_clap else None, tempfile.gettempdir(), False)
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
    _init(_model() if with_clap else None, tempfile.gettempdir(), False)
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
