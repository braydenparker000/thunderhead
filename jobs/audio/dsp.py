"""One song's signal measures, with numpy and scipy only (BSD): no GPL, LGPL or non-commercial code.

The song is read once, 10 seconds at a time, so a long file never sits whole in memory: a decoded WAV's
header is read first and a song over MAX_SECONDS is refused as `too_long` before any audio is loaded;
what is kept is a mono copy at 16 kHz (about 230 MB at the hour's limit), the loudness sums every
100 ms, and the three 10-second windows CLAP listens to.

- Loudness (ITU-R BS.1770-4): K-weighting (libebur128's filter design, filter state carried across
  chunks), 400 ms blocks every 100 ms, the absolute gate at -70 LUFS and the relative gate 10 LU below.
- Loudness range (EBU Tech 3342): 3 s windows every 100 ms, gates at -70 LUFS and 20 LU below, the
  spread between the 10th and 95th percentiles.
- True peak: each channel oversampled 4x (polyphase FIR), overlapping chunks, the largest value in dBTP.
- Mono 16 kHz: an FIR low-pass (state carried across chunks) and every third sample.
- Silence: 10 ms frames of the mono mix under -60 dBFS at the start and at the end.
- Tempo: an onset envelope (spectral flux of a 64-band log-mel spectrogram at 16 kHz, 8 ms hop), its
  autocorrelation weighted by a log-normal prior around 120 BPM (one octave wide), the peak refined by
  a parabola. Confidence: the normalised autocorrelation at that peak.
- Key: a chromagram (16 kHz, 8192-point frames, bins 55 Hz to 2 kHz folded to pitch classes, each bin
  weighted by its distance from the nearest semitone) summed over the song, correlated with the
  Krumhansl-Kessler major and minor profiles in all 12 keys. Confidence: the winner's lead over the
  runner-up (0.15 or more counts as certain) times its correlation.
- Energy: 0.6 loudness (-36 to -6 LUFS) + 0.2 onset strength (the envelope's mean over 0.1) + 0.2
  brightness (spectral centroid 500 Hz to 4 kHz), each clipped to 0-1. A heuristic, stated here so it
  can be tuned with a new analyzer version once real songs have been looked at.
"""

import math
import os
import resource
import subprocess
import wave

import numpy as np
from scipy import signal

RATE = 48000
FEAT_RATE = 16000
HOP = 128
CHUNK = 10 * RATE
MAX_SECONDS = 60 * 60
CLAP_WINDOW = 10 * RATE
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
RATES = (8000, 16000, 24000, 44100, 48000)
# The decoded WAV may hold MAX_SECONDS of 48 kHz stereo 16-bit and its header; opusdec may write no more.
WAV_LIMIT = MAX_SECONDS * RATE * 2 * 2 + 1024 * 1024


class DecodeError(Exception):
    pass


class TooLong(Exception):
    pass


def _cap_output():
    resource.setrlimit(resource.RLIMIT_FSIZE, (WAV_LIMIT, WAV_LIMIT))


def decode_opus(src, dst):
    """opus-tools' opusdec (BSD) to 16-bit WAV at 48 kHz, with a bare environment (no key of the job's)
    and its output file capped; its own words never reach the log."""
    r = subprocess.run(
        ["opusdec", "--quiet", "--force-wav", "--rate", "48000", str(src), str(dst)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=300,
        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        preexec_fn=_cap_output,
    )
    if r.returncode != 0:
        if os.path.exists(dst) and os.path.getsize(dst) >= WAV_LIMIT - 1024:
            raise TooLong("too_long")
        raise DecodeError("decode")


# --- reading -------------------------------------------------------------------------------------


class Source:
    """A song as 48 kHz chunks (channels x samples float32), its length known before the first chunk."""

    def __init__(self, rate, channels, frames, chunks):
        self.rate, self.channels, self.frames, self.chunks = rate, channels, frames, chunks


def resample(x, rate, target):
    if rate == target:
        return x
    g = math.gcd(rate, target)
    return signal.resample_poly(x, target // g, rate // g, axis=-1).astype(np.float32)


def from_array(x, rate):
    """An in-memory song (the self-test's tones)."""
    x48 = resample(np.asarray(x, dtype=np.float32), rate, RATE)
    if x48.shape[1] > MAX_SECONDS * RATE:
        raise TooLong("too_long")
    return Source(rate, x48.shape[0], x48.shape[1], (x48[:, s : s + CHUNK] for s in range(0, x48.shape[1], CHUNK)))


def from_wav(path):
    """A 16-bit PCM WAV, its header checked first: more than 2 channels is refused, over MAX_SECONDS is
    `too_long`. A 48 kHz file is read a chunk at a time; another rate (a local file) whole, then resampled."""
    try:
        w = wave.open(str(path), "rb")
    except (wave.Error, EOFError, OSError) as e:
        raise DecodeError("decode") from e
    ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    if width != 2 or ch not in (1, 2) or n == 0 or rate <= 0:
        w.close()
        raise DecodeError("decode")
    if n / rate > MAX_SECONDS:
        w.close()
        raise TooLong("too_long")

    def pcm(raw):
        return (np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0).reshape(-1, ch).T

    if rate != RATE:
        with w:
            return from_array(pcm(w.readframes(n)), rate)

    def chunks():
        with w:
            while True:
                raw = w.readframes(CHUNK)
                if not raw:
                    return
                yield pcm(raw)

    return Source(rate, ch, n, chunks())


def read_wav(path):
    """The whole WAV as (channels x samples float32, rate), for small local files and tests."""
    s = from_wav(path)
    return np.concatenate(list(s.chunks), axis=1) if s.frames else np.zeros((s.channels, 0), np.float32), RATE


# --- loudness and true peak, a chunk at a time ---------------------------------------------------


def k_filter(rate):
    """The two K-weighting biquads for this rate (libebur128's analogue design)."""
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh = 10 ** (gain / 20)
    vb = vh**0.4996667741545416
    a0 = 1 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / rate)
    d = 1 + k / q + k * k
    a2 = [1.0, 2 * (k * k - 1) / d, (1 - k / q + k * k) / d]
    return (b1, a1), ([1.0, -2.0, 1.0], a2)


def _lufs(z):
    return -0.691 + 10 * np.log10(np.maximum(z, 1e-20))


class Loudness:
    """K-weighted power summed every 100 ms across chunks; integrated loudness and LRA at the end."""

    STEP = RATE // 10

    def __init__(self, channels):
        (self.b1, self.a1), (self.b2, self.a2) = k_filter(RATE)
        self.z1 = [signal.lfilter_zi(self.b1, self.a1) * 0 for _ in range(channels)]
        self.z2 = [signal.lfilter_zi(self.b2, self.a2) * 0 for _ in range(channels)]
        self.carry = np.zeros(0)
        self.sums = []
        self.total = 0.0
        self.n = 0

    def add(self, x):
        p = np.zeros(x.shape[1])
        for c in range(x.shape[0]):
            y, self.z1[c] = signal.lfilter(self.b1, self.a1, x[c].astype(np.float64), zi=self.z1[c])
            y, self.z2[c] = signal.lfilter(self.b2, self.a2, y, zi=self.z2[c])
            p += y * y
        self.total += p.sum()
        self.n += len(p)
        p = np.concatenate([self.carry, p])
        full = len(p) // self.STEP
        self.sums.extend(p[: full * self.STEP].reshape(full, self.STEP).sum(axis=1))
        self.carry = p[full * self.STEP :]

    def _blocks(self, steps):
        s = np.asarray(self.sums)
        if len(s) < steps:
            return np.array([self.total / self.n]) if self.n else np.zeros(0)
        c = np.concatenate([[0.0], np.cumsum(s)])
        return (c[steps:] - c[:-steps]) / (steps * self.STEP)

    def result(self):
        """(integrated LUFS, loudness range LU)."""
        z = self._blocks(4)
        l = _lufs(z)
        gated = z[l > -70]
        if not len(gated):
            return -70.0, 0.0
        keep = z[(l > -70) & (l > _lufs(gated.mean()) - 10)]
        lufs = float(_lufs(keep.mean())) if len(keep) else -70.0
        z3 = self._blocks(30)
        l3 = _lufs(z3)
        g3 = z3[l3 > -70]
        lra = 0.0
        if len(g3) > 1:
            s = l3[(l3 > -70) & (l3 > _lufs(g3.mean()) - 20)]
            if len(s) > 1:
                lra = float(np.percentile(s, 95) - np.percentile(s, 10))
        return lufs, lra


class TruePeak:
    """4x oversampled peak across chunks: each chunk read with the end of the one before as context, its
    own last PAD samples left for the next, so no chunk edge is ever measured."""

    PAD = 64

    def __init__(self, channels):
        self.tail = [None] * channels
        self.peak = 0.0

    def _measure(self, seg, start, end):
        if end > start:
            up = signal.resample_poly(seg.astype(np.float64), 4, 1)
            self.peak = max(self.peak, float(np.max(np.abs(up[start * 4 : end * 4]))))

    def add(self, x):
        for c in range(x.shape[0]):
            ctx = self.tail[c]
            seg = x[c] if ctx is None else np.concatenate([ctx[0], x[c]])
            start = 0 if ctx is None else ctx[1]
            end = len(seg) - self.PAD
            self._measure(seg, start, end)
            keep = max(start, end)
            lo = max(0, keep - self.PAD)
            self.tail[c] = (seg[lo:], keep - lo)

    def result(self):
        for ctx in self.tail:
            if ctx is not None:
                self._measure(ctx[0], ctx[1], len(ctx[0]))
        return 20 * math.log10(self.peak) if self.peak > 0 else -60.0


class Downsample:
    """48 kHz mono to 16 kHz: a 97-tap low-pass at 7.6 kHz (state carried), every third sample."""

    def __init__(self):
        self.b = signal.firwin(97, 7600, fs=RATE)
        self.z = np.zeros(len(self.b) - 1)
        self.phase = 0
        self.parts = []

    def add(self, mono):
        y, self.z = signal.lfilter(self.b, [1.0], mono.astype(np.float64), zi=self.z)
        self.parts.append(y[self.phase :: 3].astype(np.float32))
        self.phase = (self.phase - len(y)) % 3

    def result(self):
        return np.concatenate(self.parts) if self.parts else np.zeros(0, np.float32)


class Windows:
    """The 10-second windows CLAP hears, copied as the chunks pass: around 25 %, 50 % and 75 % of the song,
    or its start when it is 30 s or shorter."""

    def __init__(self, frames):
        if frames <= 3 * CLAP_WINDOW:
            spans = [(0, min(frames, CLAP_WINDOW))]
        else:
            spans = [(int(c * frames) - CLAP_WINDOW // 2, int(c * frames) + CLAP_WINDOW // 2) for c in (0.25, 0.5, 0.75)]
        self.spans = spans
        self.bufs = [np.zeros(e - s, np.float32) for s, e in spans]
        self.at = 0

    def add(self, mono):
        a, b = self.at, self.at + len(mono)
        for (s, e), buf in zip(self.spans, self.bufs):
            lo, hi = max(a, s), min(b, e)
            if hi > lo:
                buf[lo - s : hi - s] = mono[lo - a : hi - a]
        self.at = b


# --- the 16 kHz measures -------------------------------------------------------------------------


def silences(mono, rate, floor_db=-60.0):
    """(start, end) silence in ms: 10 ms frames under `floor_db` before the first and after the last loud one."""
    f = max(1, rate // 100)
    n = len(mono) // f
    if n == 0:
        return 0, 0
    rms = np.sqrt(np.mean(mono[: n * f].reshape(n, f).astype(np.float64) ** 2, axis=1))
    loud = np.nonzero(20 * np.log10(np.maximum(rms, 1e-10)) > floor_db)[0]
    if not len(loud):
        return int(n * 10), 0
    return int(loud[0] * 10), int((n - 1 - loud[-1]) * 10)


def _blocks_of_frames(x, n_fft, hop, rows):
    """|STFT| a block of frames at a time (frames, bins), never the whole song's at once."""
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    fr = np.lib.stride_tricks.sliding_window_view(x, n_fft)[::hop]
    w = np.hanning(n_fft).astype(np.float32)
    for i in range(0, len(fr), rows):
        yield np.abs(np.fft.rfft(fr[i : i + rows] * w, axis=1)).astype(np.float32)


def _mel(n_fft, rate, bands=64, lo=30.0, hi=8000.0):
    mel = lambda f: 2595 * np.log10(1 + f / 700)  # noqa: E731
    hz = lambda m: 700 * (10 ** (m / 2595) - 1)  # noqa: E731
    pts = hz(np.linspace(mel(lo), mel(min(hi, rate / 2)), bands + 2))
    freqs = np.linspace(0, rate / 2, n_fft // 2 + 1)
    fb = np.zeros((bands, len(freqs)), dtype=np.float32)
    for b in range(bands):
        l, c, r = pts[b], pts[b + 1], pts[b + 2]
        fb[b] = np.maximum(0, np.minimum((freqs - l) / (c - l), (r - freqs) / (r - c)))
    return fb


def onsets(mono16):
    """The onset envelope (frames per second = FEAT_RATE / HOP) and the mean spectral centroid in Hz."""
    fb = _mel(1024, FEAT_RATE).T
    freqs = np.linspace(0, FEAT_RATE / 2, 513, dtype=np.float32)
    flux, last, num, den = [], None, 0.0, 0.0
    for mag in _blocks_of_frames(mono16, 1024, HOP, 4096):
        melspec = np.log1p(100 * (mag @ fb))
        both = melspec if last is None else np.vstack([last, melspec])
        flux.append(np.maximum(0, np.diff(both, axis=0)).mean(axis=1))
        last = melspec[-1:]
        num += float((mag @ freqs).sum())
        den += float(mag.sum())
    flux = np.concatenate(flux) if flux else np.zeros(0)
    win = int(FEAT_RATE / HOP * 0.5) | 1
    env = np.maximum(0, flux - np.convolve(flux, np.ones(win) / win, mode="same"))
    return env, (num / den if den > 0 else 0.0)


def tempo(env, fps=FEAT_RATE / HOP, lo_bpm=40.0, hi_bpm=240.0):
    """(bpm or None, confidence 0-1)."""
    e = env - env.mean() if len(env) else env
    # A steady tone or near silence has no onsets to count (its envelope is rounding noise).
    if len(e) < 4 or e.std() < 0.003:
        return None, 0.0
    size = 1 << int(math.ceil(math.log2(2 * len(e))))
    f = np.fft.rfft(e, size)
    acf = np.fft.irfft(f * np.conj(f), size)[: len(e)]
    acf /= acf[0]
    lo, hi = int(fps * 60 / hi_bpm), min(len(acf) - 2, int(fps * 60 / lo_bpm))
    if hi <= lo + 1:
        return None, 0.0
    lags = np.arange(lo, hi + 1)
    prior = np.exp(-0.5 * np.log2((60 * fps / lags) / 120.0) ** 2)
    i = int(lo + np.argmax(np.maximum(acf[lo : hi + 1], 0) * prior))
    y0, y1, y2 = acf[i - 1], acf[i], acf[i + 1]
    den = y0 - 2 * y1 + y2
    lag = i + (0.5 * (y0 - y2) / den if den < 0 else 0.0)
    conf = float(min(1.0, max(0.0, y1)))
    if conf < 0.05:
        return None, conf
    return float(60 * fps / lag), conf


def chroma(mono16):
    freqs = np.linspace(0, FEAT_RATE / 2, 4097)
    sel = (freqs >= 55) & (freqs <= 2000)
    midi = 69 + 12 * np.log2(freqs[sel] / 440.0)
    near = np.round(midi)
    weight = np.exp(-0.5 * ((midi - near) / 0.25) ** 2)
    fold = np.zeros((len(midi), 12), dtype=np.float32)
    fold[np.arange(len(midi)), near.astype(int) % 12] = weight
    total = np.zeros(12)
    for mag in _blocks_of_frames(mono16, 8192, 4096, 256):
        total += (mag[:, sel] @ fold).sum(axis=0)
    return total


def key(ch):
    """(name like 'C' or 'Am', or None; confidence 0-1)."""
    if ch.sum() <= 1e-6:
        return None, 0.0
    scores = []
    for tonic in range(12):
        for mode, prof in (("", MAJOR), ("m", MINOR)):
            scores.append((float(np.corrcoef(ch, np.roll(prof, tonic))[0, 1]), KEYS[tonic] + mode))
    scores.sort(key=lambda s: (-s[0], s[1]))
    (best, name), (second, _) = scores[0], scores[1]
    if not best > 0.2:
        return None, 0.0
    return name, float(min(1.0, max(0.0, (best - second) / 0.15)) * best)


def energy(lufs, env, centroid):
    loud = min(1.0, max(0.0, (lufs + 36) / 30))
    onset = min(1.0, max(0.0, float(env.mean()) / 0.1)) if len(env) else 0.0
    bright = min(1.0, max(0.0, (centroid - 500) / 3500))
    return 0.6 * loud + 0.2 * onset + 0.2 * bright


# --- one song ------------------------------------------------------------------------------------


def analyse_source(src):
    """Every signal field of a result, and the windows (48 kHz mono) CLAP hears, read in one pass."""
    loud, peak, down, wins = Loudness(src.channels), TruePeak(src.channels), Downsample(), Windows(src.frames)
    seen = 0
    for x in src.chunks:
        loud.add(x)
        peak.add(x)
        mono = x.mean(axis=0)
        down.add(mono)
        wins.add(mono)
        seen += x.shape[1]
    if seen == 0:
        raise DecodeError("decode")
    lufs, lra = loud.result()
    mono16 = down.result()
    start, end = silences(mono16, FEAT_RATE)
    env, centroid = onsets(mono16)
    bpm, bpm_conf = tempo(env)
    name, key_conf = key(chroma(mono16))
    return {
        "duration_ms": int(round(seen * 1000 / RATE)),
        "sample_rate": src.rate if src.rate in RATES else RATE,
        "channels": src.channels,
        "lufs_i": lufs,
        "true_peak_db": peak.result(),
        "lra": lra,
        "bpm": bpm,
        "bpm_conf": bpm_conf,
        "key": name,
        "key_conf": key_conf,
        "start_silence_ms": start,
        "end_silence_ms": end,
        "energy": energy(lufs, env, centroid),
    }, wins.bufs


def analyse(x, rate):
    """An in-memory song (channels x samples) at any rate."""
    return analyse_source(from_array(x, rate))
