"""Synthetic audio with known answers, for the self-test and the unit tests (never anyone's music).

Each maker returns (channels x samples float32, rate): a sine at a known level, a click track at a known
tempo, a chord progression in a known key, noise, silence around a tone. write_wav() saves 16-bit PCM.
"""

import wave

import numpy as np

RATE = 48000


def sine(freq=997.0, seconds=10.0, amp=1.0, rate=RATE, channels=1):
    t = np.arange(int(seconds * rate)) / rate
    x = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.tile(x, (channels, 1)), rate


def clicks(bpm=120.0, seconds=30.0, rate=RATE, seed=1):
    """A drum-like click on every beat (a decaying noise burst and a low thump), quieter off-beat hats."""
    rng = np.random.default_rng(seed)
    n = int(seconds * rate)
    x = np.zeros(n, dtype=np.float32)
    beat = 60.0 / bpm
    burst = int(0.03 * rate)
    env = np.exp(-np.arange(burst) / (0.005 * rate)).astype(np.float32)
    thump = (np.sin(2 * np.pi * 60 * np.arange(burst) / rate) * env).astype(np.float32)
    t = 0.0
    while t < seconds:
        i = int(t * rate)
        seg = min(burst, n - i)
        x[i : i + seg] += 0.2 * (rng.standard_normal(seg).astype(np.float32) * env[:seg]) + 0.4 * thump[:seg]
        j = int((t + beat / 2) * rate)
        if j < n:
            seg = min(burst, n - j)
            x[j : j + seg] += 0.05 * rng.standard_normal(seg).astype(np.float32) * env[:seg]
        t += beat
    return np.clip(x, -0.99, 0.99)[None, :], rate


def _note(midi, seconds, rate, amp):
    t = np.arange(int(seconds * rate)) / rate
    f = 440.0 * 2 ** ((midi - 69) / 12)
    tone = sum(np.sin(2 * np.pi * f * h * t) / h for h in (1, 2, 3))
    fade = np.minimum(1, np.minimum(t / 0.02, (seconds - t) / 0.05))
    return (amp * tone * fade).astype(np.float32)


def chords(progression, seconds_each=1.0, repeats=6, rate=RATE):
    """Each chord's notes (MIDI numbers) sounded together, the progression repeated."""
    parts = []
    for _ in range(repeats):
        for notes in progression:
            parts.append(sum(_note(m, seconds_each, rate, 0.15) for m in notes))
    return np.concatenate(parts)[None, :], rate


C_MAJOR = [(48, 60, 64, 67), (53, 60, 65, 69), (55, 59, 62, 67), (48, 60, 64, 67)]  # C F G C
A_MINOR = [(45, 57, 60, 64), (50, 57, 62, 65), (52, 56, 59, 64), (45, 57, 60, 64)]  # Am Dm E Am


def noise(seconds=10.0, amp=0.5, rate=RATE, seed=2):
    rng = np.random.default_rng(seed)
    return (amp * rng.standard_normal((2, int(seconds * rate)))).astype(np.float32).clip(-1, 1), rate


def padded(x, rate, before=2.0, after=3.0):
    """`x` with digital silence before and after."""
    z = lambda s: np.zeros((x.shape[0], int(s * rate)), dtype=np.float32)  # noqa: E731
    return np.concatenate([z(before), x, z(after)], axis=1), rate


def write_wav(path, x, rate):
    pcm = (np.clip(x, -1, 1 - 1 / 32768) * 32768).astype("<i2").T.copy()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
