// Tips per section, like a real teacher (the owner's day-1 request; GUITAR.md §6): the Guitar
// reader's tab, read on the phone, section by section (the tab's own sections, else 8 bars at a
// time), for what makes it hard: fast runs, wide reaches, big shifts, barres, slurs, bends, slides,
// vibrato, palm mutes, harmonics, strummed chords, quick chord changes, a long section. Each is a tip
// in our own words with whose approach it follows ("after …"; no quotations), a hint first and
// "Show me" for the concrete step; at most three a section. A section's label in the reader opens
// them. Nothing leaves the phone. The mind's tips from practice data come later, beside these.

export const FLAG = { dead: 1, palmMute: 2, letRing: 4, ghost: 8, accent: 16, harmonic: 32, legato: 64, vibrato: 128, slide: 256, staccato: 512 };
const CHUNK = 8;

/** @typedef {{ mb: number, start: number, end: number, section: string }} Bar */
/** @typedef {{ s: number, f: number, m: number, d: number, fl: number, b?: unknown[], to?: number }} Note */
/** @typedef {{ t: number, d: number, q: number, st: number, n: Note[], c?: string }} Beat */
/** @typedef {{ ppq: number, tempos: [number, number][], bars: Bar[], events: Beat[], chords?: { t: number, q: number, name: string }[] }} Timeline */
/** @typedef {{ label: string, from: number, to: number }} Section */
/** @typedef {{ id: string, hint: string, show: string, after: string }} Tip */

/** The tab's sections in score order (master bars), a section without a name 8 bars at most. @param {Timeline} tl @returns {Section[]} */
export function sectionsOf(tl) {
  /** @type {Map<number, Bar>} */
  const first = new Map();
  for (const b of tl.bars) if (!first.has(b.mb)) first.set(b.mb, b);
  /** @type {(Section & { named: boolean })[]} */
  const out = [];
  for (const mb of [...first.keys()].sort((a, b) => a - b)) {
    const b = /** @type {Bar} */ (first.get(mb));
    const last = out.at(-1);
    if (b.section || !last || (!last.named && mb - last.from >= CHUNK)) out.push({ label: b.section, named: !!b.section, from: mb, to: mb });
    else last.to = mb;
  }
  return out.map((s) => ({ label: s.label || `Bars ${s.from + 1}–${s.to + 1}`, from: s.from, to: s.to }));
}

/** The tempo at a tick. @param {Timeline} tl @param {number} tick */
const bpmAt = (tl, tick) => (tl.tempos ?? []).reduce((bpm, [t, b]) => (t <= tick ? b : bpm), tl.tempos?.[0]?.[1] ?? 120);

/** What a section asks of the hands. @param {Timeline} tl @param {Section} sec */
export function featuresOf(tl, sec) {
  // Each master bar once (repeats play it again, but it is the same music).
  /** @type {Map<number, number>} */
  const seen = new Map();
  tl.bars.forEach((b, q) => {
    if (!seen.has(b.mb)) seen.set(b.mb, q);
  });
  const inSection = (/** @type {number} */ q) => {
    const mb = tl.bars[q]?.mb;
    return mb !== undefined && mb >= sec.from && mb <= sec.to && seen.get(mb) === q;
  };
  const beats = (tl.events ?? []).filter((x) => inSection(x.q));
  const named = (tl.chords ?? []).filter((c) => inSection(c.q)).map((c) => c.name);
  const ppq = tl.ppq || 960;
  const bpm = Math.round(bpmAt(tl, beats[0]?.t ?? tl.bars.find((b) => b.mb === sec.from)?.start ?? 0));
  const sec1 = 60 / (bpm * ppq);
  const notes = beats.flatMap((x) => x.n);
  const has = (/** @type {number} */ f) => notes.filter((n) => n.fl & f).length;
  let fastest = 0;
  const singles = beats.filter((x) => x.n.length === 1);
  for (let i = 1; i < singles.length; i++) {
    const gap = (singles[i].t - singles[i - 1].t) * sec1;
    if (gap > 0.02) fastest = Math.max(fastest, 1 / gap);
  }
  let span = 0;
  let spanBar = sec.from;
  let shifts = 0;
  let shift = 0;
  let barres = 0;
  let barreFret = 0;
  let prevLow = 0;
  let strums = 0;
  let changes = 0;
  let prevChord = '';
  for (const x of beats) {
    const fretted = x.n.filter((n) => n.f > 0).map((n) => n.f);
    if (fretted.length) {
      const lo = Math.min(...fretted);
      const w = Math.max(...fretted) - lo;
      if (w > span) [span, spanBar] = [w, tl.bars[x.q].mb];
      if (prevLow && Math.abs(lo - prevLow) >= 5) {
        shifts++;
        shift = Math.max(shift, Math.abs(lo - prevLow));
      }
      prevLow = lo;
      if (x.n.length >= 4 && fretted.filter((f) => f === lo).length >= 2 && fretted.length === x.n.length) {
        barres++;
        barreFret ||= lo;
      }
    }
    if (x.n.length >= 3 && x.st !== 0) strums++;
    if (!named.length) {
      const chord = x.c || (x.n.length >= 3 ? x.n.map((n) => `${n.s}:${n.f}`).join(',') : '');
      if (chord && prevChord && chord !== prevChord) changes++;
      if (chord) prevChord = chord;
    }
  }
  for (let i = 1; i < named.length; i++) if (named[i] !== named[i - 1]) changes++;
  const bars = sec.to - sec.from + 1;
  const seconds = bars * (beats.length ? (tl.bars[seen.get(sec.from) ?? 0].end - tl.bars[seen.get(sec.from) ?? 0].start) * sec1 : 0);
  return {
    bars,
    bpm,
    fastest: Math.round(fastest * 10) / 10,
    span,
    spanBar,
    shifts,
    shift,
    barres,
    barreFret,
    legato: has(FLAG.legato),
    slides: notes.filter((n) => n.fl & FLAG.slide || n.to).length,
    bends: notes.filter((n) => n.b?.length).length,
    vibrato: has(FLAG.vibrato),
    palmMute: has(FLAG.palmMute),
    harmonics: has(FLAG.harmonic),
    strums,
    changesPerSecond: seconds ? Math.round((changes / seconds) * 10) / 10 : 0,
    notes: notes.length,
  };
}

/** @typedef {ReturnType<typeof featuresOf>} Features */

/** A slow, sure tempo to start from (60 % of the written one, at least 40). @param {number} bpm */
const slow = (bpm) => Math.max(40, Math.round((bpm * 0.6) / 2) * 2);

/** The teacher's tips, with when each applies and how much it matters. @type {{ id: string, weight: (f: Features) => number, tip: (f: Features, s: Section) => Omit<Tip, 'id'> }[]} */
export const TEMPLATES = [
  {
    id: 'slow-first',
    weight: (f) => (f.fastest >= 6 ? f.fastest : 0),
    tip: (f, s) => ({
      hint: `${s.label} runs fast: up to ${f.fastest} notes a second at ${f.bpm} BPM.`,
      show: `Loop bars ${s.from + 1}–${s.to + 1} at ${slow(f.bpm)} BPM until three passes in a row are even, then raise it 4 BPM at a time.`,
      after: "after Segovia's habit of slow, deliberate scale practice",
    }),
  },
  {
    id: 'alternate',
    weight: (f) => (f.fastest >= 8 ? f.fastest - 2 : 0),
    tip: () => ({
      hint: 'Fast single notes want a strict right hand.',
      show: 'Alternate strictly (i–m, or down–up with a pick), even across string changes; never two strokes in a row with one finger.',
      after: "after the flamenco picado drill Paco de Lucía made famous",
    }),
  },
  {
    id: 'reach',
    weight: (f) => (f.span >= 5 ? 4 + f.span : 0),
    tip: (f) => ({
      hint: `A wide reach: ${f.span} frets in one shape (bar ${f.spanBar + 1}).`,
      show: 'Keep the thumb low behind the neck and let the wrist come forward; put the stretching finger down first, then the others.',
      after: "classical left-hand position, as in Parkening's method",
    }),
  },
  {
    id: 'guide-finger',
    weight: (f) => (f.shifts ? 3 + f.shifts : 0),
    tip: (f) => ({
      hint: f.shifts === 1 ? `A big position shift (${f.shift} frets).` : `${f.shifts} position shifts, up to ${f.shift} frets.`,
      show: 'Find a finger that stays on its string through the shift and glide on it lightly; look at the target fret before you move.',
      after: 'the classical guide-finger habit',
    }),
  },
  {
    id: 'barre',
    weight: (f) => (f.barres ? 5 : 0),
    tip: (f) => ({
      hint: `Barre chords here, the first at fret ${f.barreFret}.`,
      show: 'Press with the weight of the arm, not a squeeze of the thumb; roll the index a little onto its bony side, and press hardest only where notes sound.',
      after: 'common classical teaching',
    }),
  },
  {
    id: 'slurs',
    weight: (f) => (f.legato >= 2 ? 3 + f.legato / 4 : 0),
    tip: (f) => ({
      hint: `Slurs carry this section: ${f.legato} hammer-ons, pull-offs and slides.`,
      show: 'Hammer from the knuckle, close to the fret; pull off slightly sideways so the finger plucks the string. The slurred note should be as loud as the picked one.',
      after: 'common classical teaching',
    }),
  },
  {
    id: 'bends',
    weight: (f) => (f.bends ? 5 : 0),
    tip: (f) => ({
      hint: f.bends === 1 ? 'A bend here.' : `${f.bends} bends here.`,
      show: 'Bend with two or three fingers together and turn from the wrist; check the bent pitch against the target note played normally.',
      after: 'electric guitar practice',
    }),
  },
  {
    id: 'slides',
    weight: (f) => (f.slides >= 2 ? 3 : 0),
    tip: () => ({
      hint: 'Slides between positions.',
      show: 'Keep just enough pressure to stay in tune, and look at the arriving fret, not the leaving one; land on time, not early.',
      after: 'the classical guide-finger habit',
    }),
  },
  {
    id: 'vibrato',
    weight: (f) => (f.vibrato ? 2 : 0),
    tip: () => ({
      hint: 'Vibrato on held notes.',
      show: 'Start slowly and evenly, moving from the wrist; keep the vibrato in time with the beat, then let it widen.',
      after: 'common guitar teaching',
    }),
  },
  {
    id: 'palm-mute',
    weight: (f) => (f.palmMute >= 4 ? 3 : 0),
    tip: () => ({
      hint: 'Palm-muted notes.',
      show: 'Rest the edge of the picking hand right where the strings leave the bridge; slide it in for a darker sound, out for more note.',
      after: 'electric guitar practice',
    }),
  },
  {
    id: 'harmonics',
    weight: (f) => (f.harmonics ? 3 : 0),
    tip: () => ({
      hint: 'Harmonics.',
      show: 'Touch the string lightly straight above the fret wire, pick firmly near the bridge, then lift the finger at once.',
      after: 'common guitar teaching',
    }),
  },
  {
    id: 'rhythm-first',
    weight: (f) => (f.strums >= 4 ? 4 : 0),
    tip: (f) => ({
      hint: 'Strummed chords drive this section.',
      show: 'Count the beat aloud while you strum, and keep the hand moving down and up even where it misses the strings: rhythm first, chords second.',
      after: 'after the compás-first approach of flamenco players like Paco de Lucía',
    }),
  },
  {
    id: 'changes',
    weight: (f) => (f.changesPerSecond >= 0.75 ? 4 + f.changesPerSecond : 0),
    tip: (f) => ({
      hint: `Quick chord changes (about ${f.changesPerSecond} a second).`,
      show: 'Practise only the change: two shapes back and forth, slowly, lifting the fingers together; keep any finger that stays in both shapes down.',
      after: 'practice research: isolate the hard transition',
    }),
  },
  {
    id: 'chunks',
    weight: (f) => (f.bars >= 12 ? 2 : 0),
    tip: (f) => ({
      hint: `A long section (${f.bars} bars).`,
      show: 'Learn it two bars at a time, then join pairs, then play it whole; finish each session with one slow run-through.',
      after: 'practice research: chunking',
    }),
  },
];

/** At most three tips for a section, the most needed first; a plain one when nothing stands out.
 * @param {Timeline} tl @param {Section} sec @returns {Tip[]} */
export function tipsFor(tl, sec) {
  const f = featuresOf(tl, sec);
  const ranked = TEMPLATES.map((t) => ({ t, w: t.weight(f) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map(({ t }) => ({ id: t.id, ...t.tip(f, sec) }));
  if (ranked.length) return ranked;
  return [
    {
      id: 'steady',
      hint: `Nothing tricky stands out in ${sec.label}: make it steady.`,
      show: `Play it through at ${slow(f.bpm)} BPM with the metronome, then at ${f.bpm}; speed comes from evenness.`,
      after: "after Segovia's habit of slow, deliberate practice",
    },
  ];
}

/**
 * Makes a section label in the reader open its tips (the label is drawn by the ported reader).
 * @param {HTMLElement} label @param {number} mb the section's first master bar @param {() => Timeline | null} timeline
 * @param {(o: { title: string, subtitle?: string, content?: Node[] }) => unknown} openSheet the reader's sheet
 */
export function attachTips(label, mb, timeline, openSheet) {
  label.style.pointerEvents = 'auto';
  label.style.cursor = 'pointer';
  label.setAttribute('role', 'button');
  label.setAttribute('tabindex', '0');
  const name = label.textContent ?? '';
  label.setAttribute('aria-label', `Tips for ${name}`);
  label.append(' · tips');
  const open = (/** @type {Event} */ e) => {
    e.stopPropagation();
    e.preventDefault();
    const tl = timeline();
    const sec = tl && sectionsOf(tl).find((s) => s.from === mb);
    if (!tl || !sec) return;
    const f = featuresOf(tl, sec);
    openSheet({
      title: `${sec.label}: tips`,
      subtitle: `Bars ${sec.from + 1}–${sec.to + 1} · ${f.bpm} BPM`,
      content: tipsFor(tl, sec).map((t) => {
        const box = document.createElement('div');
        box.className = 'th-tip';
        box.style.cssText = 'padding:10px 16px 12px;border-top:1px solid rgba(255,255,255,.08)';
        const hint = document.createElement('p');
        hint.textContent = t.hint;
        hint.style.cssText = 'margin:0;font-style:italic;font-size:15px;line-height:1.45';
        const after = document.createElement('small');
        after.textContent = t.after;
        after.style.cssText = 'display:block;margin-top:4px;opacity:.6;font-size:12px';
        const more = document.createElement('button');
        more.type = 'button';
        more.textContent = 'Show me';
        more.style.cssText = 'margin-top:8px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:none;color:inherit;font:inherit;font-size:13px';
        more.addEventListener('click', () => {
          const p = document.createElement('p');
          p.textContent = t.show;
          p.style.cssText = 'margin:8px 0 0;font-size:14px;line-height:1.45';
          more.replaceWith(p);
        });
        box.append(hint, after, more);
        return box;
      }),
    });
  };
  label.addEventListener('click', open);
  label.addEventListener('pointerdown', (e) => e.stopPropagation());
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') open(e);
  });
}
