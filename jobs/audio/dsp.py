"""One song's signal measures, with numpy and scipy only (BSD): no GPL, LGPL or non-commercial code.

- Loudness (ITU-R BS.1770-4): K-weighting (libebur128's filter design, so any rate works), 400 ms
  blocks every 100 ms, the absolute gate at -70 LUFS and the relative gate 10 LU below.
- Loudness range (EBU Tech 3342): 3 s windows every 100 ms, gates at -70 LUFS and 20 LU below, the
  spread between the 10th and 95th percentiles.
- True peak: each channel oversampled 4x (polyphase FIR), the largest value in dBTP.
- Silence: 10 ms frames of the mono mix under -60 dBFS at the start and at the end.
- Tempo: an onset envelope (spectral flux of a 64-band log-mel spectrogram at 16 kHz, 8 ms hop), its
  autocorrelation weighted by a log-normal prior around 120 BPM (one octave wide), the peak refined by
  a parabola. Confidence: the normalised autocorrelation at that peak.
- Key: a chromagram (16 kHz, 8192-point frames, bins 55 Hz to 2 kHz folded to pitch classes, each bin
  weighted by its distance from the nearest semitone) averaged over the song, correlated with the
  Krumhansl-Kessler major and minor profiles in all 12 keys. Confidence: the winner's lead over the
  runner-up (0.15 or more counts as certain) times its correlation.
- Energy: 0.6 loudness (-36 to -6 LUFS) + 0.2 onset strength (the envelope's mean over 0.1) + 0.2
  brightness (spectral centroid 500 Hz to 4 kHz), each clipped to 0-1. A heuristic, stated here so it
  can be tuned with a new analyzer version once real songs have been looked at.
"""

import math
import subprocess
import wave

import numpy as np
from scipy import signal

FEAT_RATE = 16000
HOP = 128
KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
RATES = (8000, 16000, 24000, 44100, 48000)


class DecodeError(Exception):
    pass


def decode_opus(src, dst):
    """opus-tools' opusdec (BSD) to 16-bit WAV at 48 kHz; its own words never reach the log."""
    r = subprocess.run(
        ["opusdec", "--quiet", "--force-wav", "--rate", "48000", str(src), str(dst)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=300,
    )
    if r.returncode != 0:
        raise DecodeError("decode")


def read_wav(path):
    """(channels x samples float32 in -1..1, rate) from 16-bit PCM; more than 2 channels is refused."""
    try:
        with wave.open(str(path), "rb") as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
    except (wave.Error, EOFError) as e:
        raise DecodeError("decode") from e
    if width != 2 or ch not in (1, 2) or n == 0:
        raise DecodeError("decode")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    return x.reshape(-1, ch).T.copy(), rate


def resample(x, rate, target):
    if rate == target:
        return x
    g = math.gcd(rate, target)
    return signal.resample_poly(x, target // g, rate // g, axis=-1).astype(np.float32)


# --- loudness ----------------------------------------------------------------------------------


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


def _power(x, rate):
    """Per sample, the K-weighted squares summed over the channels (each channel's weight is 1)."""
    (b1, a1), (b2, a2) = k_filter(rate)
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x.astype(np.float64), axis=-1), axis=-1)
    return np.sum(y * y, axis=0)


def _blocks(p, rate, win, hop):
    n, w, h = len(p), int(round(win * rate)), int(round(hop * rate))
    if n == 0:
        return np.zeros(0)
    if n < w:
        return np.array([p.mean()])
    c = np.concatenate([[0.0], np.cumsum(p)])
    s = np.arange(0, n - w + 1, h)
    return (c[s + w] - c[s]) / w


def _lufs(z):
    return -0.691 + 10 * np.log10(np.maximum(z, 1e-20))


def loudness(x, rate):
    """(integrated LUFS, loudness range LU)."""
    p = _power(x, rate)
    z = _blocks(p, rate, 0.4, 0.1)
    l = _lufs(z)
    gated = z[l > -70]
    if not len(gated):
        return -70.0, 0.0
    rel = _lufs(gated.mean()) - 10
    keep = z[(l > -70) & (l > rel)]
    lufs = float(_lufs(keep.mean())) if len(keep) else -70.0
    z3 = _blocks(p, rate, 3.0, 0.1)
    l3 = _lufs(z3)
    g3 = z3[l3 > -70]
    lra = 0.0
    if len(g3) > 1:
        s = l3[(l3 > -70) & (l3 > _lufs(g3.mean()) - 20)]
        if len(s) > 1:
            lra = float(np.percentile(s, 95) - np.percentile(s, 10))
    return lufs, lra


def true_peak_db(x):
    """The largest 4x-oversampled value of any channel, in dBTP, read in chunks with overlap."""
    peak, chunk, pad = 0.0, 1 << 18, 64
    for ch in x:
        n = len(ch)
        for s in range(0, n, chunk):
            a, b = max(0, s - pad), min(n, s + chunk + pad)
            up = signal.resample_poly(ch[a:b].astype(np.float64), 4, 1)
            mid = up[(s - a) * 4 : (s - a + min(chunk, n - s)) * 4]
            if len(mid):
                peak = max(peak, float(np.max(np.abs(mid))))
    return 20 * math.log10(peak) if peak > 0 else -60.0


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


# --- tempo, key, energy ------------------------------------------------------------------------


def _frames(x, n_fft, hop):
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    return np.lib.stride_tricks.sliding_window_view(x, n_fft)[::hop]


def _spectrum(x, n_fft, hop, rows=4096):
    """|STFT| as (frames, bins), computed a block of frames at a time."""
    fr = _frames(x, n_fft, hop)
    w = np.hanning(n_fft).astype(np.float32)
    out = np.empty((len(fr), n_fft // 2 + 1), dtype=np.float32)
    for i in range(0, len(fr), rows):
        out[i : i + rows] = np.abs(np.fft.rfft(fr[i : i + rows] * w, axis=1))
    return out


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
    mag = _spectrum(mono16, 1024, HOP)
    melspec = np.log1p(100 * (mag @ _mel(1024, FEAT_RATE).T))
    flux = np.maximum(0, np.diff(melspec, axis=0)).mean(axis=1)
    win = int(FEAT_RATE / HOP * 0.5) | 1
    env = np.maximum(0, flux - np.convolve(flux, np.ones(win) / win, mode="same"))
    freqs = np.linspace(0, FEAT_RATE / 2, mag.shape[1])
    power = mag.sum(axis=1)
    centroid = float((mag @ freqs).sum() / power.sum()) if power.sum() > 0 else 0.0
    return env, centroid


def tempo(env, fps=FEAT_RATE / HOP, lo_bpm=40.0, hi_bpm=240.0):
    """(bpm or None, confidence 0-1)."""
    e = env - env.mean()
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
    mag = _spectrum(mono16, 8192, 4096, rows=512)
    freqs = np.linspace(0, FEAT_RATE / 2, mag.shape[1])
    sel = (freqs >= 55) & (freqs <= 2000)
    midi = 69 + 12 * np.log2(freqs[sel] / 440.0)
    near = np.round(midi)
    weight = np.exp(-0.5 * ((midi - near) / 0.25) ** 2)
    pc = near.astype(int) % 12
    fold = np.zeros((len(midi), 12), dtype=np.float32)
    fold[np.arange(len(midi)), pc] = weight
    return (mag[:, sel] @ fold).sum(axis=0)


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


def analyse(x, rate):
    """Every signal field of a result (and the mono 48 kHz mix CLAP listens to), from channels x samples."""
    if rate not in RATES:
        x, rate = resample(x, rate, 48000), 48000
    duration_ms = int(round(x.shape[1] * 1000 / rate))
    lufs, lra = loudness(x, rate)
    mono = x.mean(axis=0)
    start, end = silences(mono, rate)
    mono16 = resample(mono, rate, FEAT_RATE)
    env, centroid = onsets(mono16)
    bpm, bpm_conf = tempo(env)
    name, key_conf = key(chroma(mono16))
    return {
        "duration_ms": duration_ms,
        "sample_rate": rate,
        "channels": x.shape[0],
        "lufs_i": lufs,
        "true_peak_db": true_peak_db(x),
        "lra": lra,
        "bpm": bpm,
        "bpm_conf": bpm_conf,
        "key": name,
        "key_conf": key_conf,
        "start_silence_ms": start,
        "end_silence_ms": end,
        "energy": energy(lufs, env, centroid),
    }, resample(mono, rate, 48000)
