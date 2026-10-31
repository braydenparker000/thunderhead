// @ts-check
// Voice memo (HOME.md §6.2): the ask bar becomes a recording strip, a pink dot, the time, the live
// level as bars, × where + was (throw it away) and Stop where send was (keep it). Kept, it is
// attached to the next message as Opus in WebM, and the owner can add words before sending. Ten
// minutes at most: the time turns red at 9:30 and the recording stops itself at 10:00. The
// microphone is open only while the strip shows: leaving the page (another app, the screen off)
// stops it and keeps what was recorded (PRIVACY.md §7).
import { FILE_LIMITS } from '../contract.js';
import { uuidv7 } from '../chat/model.js';
import { toast } from '../ui.js';
import { add, clock, room } from './state.js';

const BARS = 28;
const LATE_S = FILE_LIMITS.memo_seconds - 30;
let busy = false;

/** @param {string} name */
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;

export async function recordMemo() {
  if (busy) return;
  if (room() <= 0) return toast('Up to 4 at a time.');
  busy = true;
  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    busy = false;
    return toast('Allow the microphone to record a memo.');
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : {});
  /** @type {Blob[]} */
  const chunks = [];
  rec.addEventListener('dataavailable', (e) => e.data.size && chunks.push(e.data));

  const ctx = new AudioContext();
  ctx.resume().catch(() => {});
  const meter = ctx.createAnalyser();
  // About 90 ms at 44.1–48 kHz, the time between bars, so each bar hears everything since the last
  // one: a narrower window heard a sliver of each gap and could miss a short sound every time.
  meter.fftSize = 4096;
  ctx.createMediaStreamSource(stream).connect(meter);
  const samples = new Float32Array(meter.fftSize);

  const ask = /** @type {HTMLElement} */ (document.querySelector('#ask'));
  const strip = document.createElement('div');
  strip.className = 'rec';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Recording a voice memo');
  const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'rx' });
  cancel.setAttribute('aria-label', 'Throw the memo away');
  cancel.innerHTML = icon('x');
  const dot = Object.assign(document.createElement('span'), { className: 'rdot' });
  const time = Object.assign(document.createElement('span'), { className: 'rtime', textContent: '0:00' });
  time.setAttribute('role', 'timer');
  const level = Object.assign(document.createElement('span'), { className: 'rlevel' });
  level.setAttribute('aria-hidden', 'true');
  const bars = Array.from({ length: BARS }, () => level.appendChild(document.createElement('i')));
  const stop = Object.assign(document.createElement('button'), { type: 'button', className: 'rstop' });
  stop.setAttribute('aria-label', 'Stop and keep the memo');
  stop.innerHTML = icon('stop');
  strip.append(cancel, dot, time, level, stop);
  ask.append(strip);
  ask.classList.add('recording');
  // The edge brightens while the microphone is open (PRIVACY.md §7.3).
  const edge = document.querySelector('#edge');
  edge?.classList.add('listen');
  stop.focus();

  const started = performance.now();
  const seconds = () => (performance.now() - started) / 1000;
  /** @type {number[]} */
  const history = [];
  let frame = 0;
  let lastBar = 0;
  const tick = (/** @type {number} */ now) => {
    const s = seconds();
    time.textContent = clock(s);
    time.classList.toggle('late', s >= LATE_S);
    if (s >= FILE_LIMITS.memo_seconds) return void end(true);
    if (now - lastBar > 90) {
      lastBar = now;
      meter.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      // Loudness in decibels, -60 dB (silence) to -10 dB (loud), as level meters show it, so soft
      // speech moves the bars too.
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6);
      history.push(Math.min(1, Math.max(0, (db + 60) / 50)));
      if (history.length > BARS) history.shift();
      bars.forEach((b, i) => {
        const v = history[i - (BARS - history.length)] ?? 0;
        b.style.transform = `scaleY(${Math.max(0.12, v).toFixed(2)})`;
      });
    }
    frame = requestAnimationFrame(tick);
  };

  let ended = false;
  /** @param {boolean} keep */
  function end(keep) {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onHide);
    const s = seconds();
    rec.addEventListener(
      'stop',
      () => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        strip.remove();
        ask.classList.remove('recording');
        edge?.classList.remove('listen');
        busy = false;
        if (keep && chunks.length && s >= 1) {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const at = new Date();
          const name = `Voice memo ${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}.webm`;
          add([{ id: uuidv7(), name, type: blob.type.split(';')[0], bytes: blob.size, blob, seconds: Math.round(s) }]);
        } else if (keep) toast('Too short to keep.');
        /** @type {HTMLElement | null} */ (document.querySelector('#q'))?.focus();
      },
      { once: true },
    );
    rec.stop();
  }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    end(false);
  };
  const onHide = () => document.hidden && end(true);
  addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', onHide);
  cancel.addEventListener('click', () => end(false));
  stop.addEventListener('click', () => end(true));
  rec.start(1000);
  frame = requestAnimationFrame(tick);
}
