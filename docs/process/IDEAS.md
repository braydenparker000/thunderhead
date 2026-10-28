# Ideas

The evaluated backlog of new features for the Thunderhead: a wide brainstorm (95 ideas), each scored the same way, a top 10 specified exactly enough to build, and the anti-features that would make it worse.
Nothing on this page is decided. **Every idea, number and spec here is [proposal]** until the owner says yes and a line lands in [decisions.md](decisions.md).

## Rules at a glance

1. **Everything here is [proposal].** An idea becomes work only when the owner agrees; that agreement is the go-ahead (autonomy rule). Ask-first classes inside an idea still need the owner's approval (a device tap or the owner's own words).
2. **Every idea passes the eight gates in §1** (calm, arranges rather than chats, grows the owner, legible, budgeted, private, $0, fits the locked design). An idea that fails a gate is rejected (§6), however clever.
3. **Scores are a sorting aid, not a verdict.** Score = 2 × value − effort − risk − 1 if its $0 status still needs a test. The top 10 is chosen by value first, then score, with two judgement calls stated in §4.
4. **Sibling specs win.** Where an app doc ([MUSIC.md](../product/apps/MUSIC.md), [GUITAR.md](../product/apps/GUITAR.md), [STUDY.md](../product/apps/STUDY.md) …) or a mind doc ([BEHAVIOR.md](../mind/BEHAVIOR.md), [MEMORY.md](../mind/MEMORY.md)) specifies the same behaviour with different numbers, that doc wins and this page is corrected.
5. **No idea may contradict an owner ruling.** In particular: Home stays one screen with no chips; the `+` sheet keeps exactly Camera, Photos, Files, Voice memo, Remind me; the ring keeps its six apps; nothing before 06:30; eyes and ears only when switched on. The existing apps (Music, Guitar, Podcasts, Astra, My Media) are ported **as they are** first: an idea that changes one of them is an evolution of that app and waits until the owner agrees to it.
6. **Growth over engagement.** Success of any idea is measured by the owner becoming more capable (tempo, retention, independence), never by minutes in the app or opens per day.
7. **Every top-10 behaviour has an acceptance check.** If it can't be tested, it isn't specified yet.
8. **Open questions go to [RESEARCH-AGENDA.md](RESEARCH-AGENDA.md)**, never stay implicit here. IDs like `RA-P3-04` point there.

Sibling docs: [VISION.md](../product/VISION.md) (principles), [ROADMAP.md](ROADMAP.md) (phases P0–P9), [CONSTITUTION.md](../mind/CONSTITUTION.md) (laws and articles 11–17), [BRIEFING.md](../product/BRIEFING.md), [HOME.md](../product/HOME.md), [COPY.md](../design/COPY.md), [EVALS.md](../mind/EVALS.md), [DATA.md](../engineering/DATA.md).

---

## 1. The eight gates

An idea is admitted to the backlog only if it can answer "yes" to all eight. The gates come from the laws and from research on calm, proactive and learning technology.

| # | Gate | The question | Grounding |
|---|---|---|---|
| G1 | **Calm** | Does it use the periphery first (an arranged list, a margin note, a voice line) and speak only when needed? | Weiser & Brown, *Designing Calm Technology* (1996); Amber Case's principle 5, "can communicate, but doesn't need to speak" |
| G2 | **Arranges, not chats** | Is the main effect something already prepared, rather than a new place to type? | Litt, *Enough AI copilots! We need AI HUDs* (2025) |
| G3 | **Grows the owner** | After a month, is the owner more capable without it, not less? Does it support autonomy, competence and relatedness? | Bastani et al., PNAS 2025 (unrestricted AI −17 % once removed; hints-only tutor: no harm); Peters, Calvo & Ryan, METUX/SDT (2018) |
| G4 | **Legible and undoable** | Does every action carry a why and an undo, and can the owner predict what it will do? | Horvitz, mixed-initiative principles (1999); Gajos et al., predictability (CHI 2008); law 3, article 14 |
| G5 | **Budgeted** | Does it fit the voice ladder, the push budget (≤ 2 a day), remind-once (14-day `nudge_repeat`) and quiet hours (nothing before 06:30)? | Iqbal & Bailey, breakpoints (CHI 2008); Fitz et al., batching (2019); law 4, article 13 |
| G6 | **Private** | Does personal data stay on the phone or behind sign-in, never in the public repo, Actions logs or a new third party? | AGENTS.md privacy rules; decisions.md platform section |
| G7 | **$0** | Does it fit Workers Free, DO Free, R2, Workers AI's 10k neurons a day, public-repo Actions, and the Claude Max 5x plan, without usage credits, and still work (leaner) if the plan drops to Pro? | decisions.md (owner: $0 extra) |
| G8 | **Fits the locked design** | Does it live inside Home, the ring, the Briefing page, the menu or an app, without new chrome on Home? | decisions.md design rulings (2026-10-28) |

**Acceptance (for the backlog itself):** every row in §3 names its phase, privacy grade and $0 status; every row graded `X` on privacy or `no` on $0 appears in §6, not §3. A reviewer can check this by reading the tables.

---

## 2. How ideas are scored

| Field | Scale |
|---|---|
| **V (value)** | 5 = changes daily life or growth measurably; 4 = clearly useful weekly; 3 = nice, occasional; 2 = polish; 1 = trivia. |
| **E (effort)** | **S** = one agent session (≤ ~1 day of agent work, no new storage class); **M** = 2–5 sessions or one new table/verb/surface family; **L** = more than 5 sessions, a new Durable Object class, an Actions pipeline, or a cross-app change. Weights 1 / 2 / 3. |
| **Risk** | **L** / **M** / **H** (weights 0 / 1 / 2), with the main kind in brackets: trust, nag, privacy, usage, quota, taint, drift, build. |
| **$0** | **yes** = comfortably inside free tiers; **budget** = inside, but spends a constrained budget (plan usage, neurons, DO writes) and must be metered; **test** = unknown until an open question is settled; **no** = needs money (listed in §6). |
| **Privacy** | **A** = stays on the phone; **B** = phone + the private Worker/R2/Workers AI (same platform as all data); **C** = personal text also passes through a Claude session (allowed: the mind already reads everything); **D** = needs a new third party (ask first); **X** = conflicts with a law or ruling (rejected). |
| **Phase** | The [ROADMAP.md](ROADMAP.md) phase in which it can first land: P0 site · P1 Worker + sign-in · P1b apps ported as they are · P2 conversation · P3 memory · P4 safety/ops · P5 evolve Music · P6 evolve Guitar · P7 Study · P8 evolve media apps + reach · P9 meter + self-improvement · P9+ needs a year of data. |
| **Score** | 2V − E − Risk − (1 if $0 = test). Range −3 … 9. |

---

## 3. The brainstorm (95 ideas)

Each category has its table, then evaluation notes for the rows where the score hides something important.

### Home (HM)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| HM1 | Ask about this | Long-press any item in any app (song, bar, page, episode) → Home opens with the item quoted above the ask bar as one line (not a chip); the next message carries its ref. | 5 | M | L (build) | yes | B | P5 | 8 |
| HM2 | While you were away | First open after ≥ 8 h away: one system line "While you were away: 3 arranged, 1 waiting" that expands into ledger rows with undo. Never shown twice for the same absence. | 4 | S | L | yes | B | P3 | 7 |
| HM3 | Hand it over | Android share sheet → Thunderhead (Web Share Target). The mind files the link, text or image (watch later, study, keep) and says where in one line. Shared content is external (tainted). | 4 | M | M (taint) | yes | B | P8 | 5 |
| HM4 | Living field | The colour field's drift speed and saturation follow the day's load: slower and paler when nothing waits. Never used for decisions (gold edge stays the only decision signal). Off switch in Settings. | 2 | S | M (confusing) | yes | A | P2 | 2 |
| HM5 | Glance is not reading | A visit under 3 s marks nothing as seen. An item counts as seen only after 3 s on screen, so a pocket glance never clears what is waiting. | 3 | S | L | yes | A | P2 | 5 |
| HM6 | Undo the day | Ledger filtered to one day with "Undo all of today's arrangements" (reversible verbs only; memory and ask-first items excluded). | 3 | M | M (bulk undo) | yes | B | P4 | 3 |

- **HM1** is the plan's "Ask about this". It is the one bridge from every app to the conversation without a chat button in the app. The attached item shows as a quoted line, not a chip (owner ruling: no chips on Home). Spec belongs to [HOME.md](../product/HOME.md); listed here so it isn't lost.
- **HM3** turns the share sheet into the owner's inbox. Everything shared is **external** content: it may be cited, never turned into a fact or rule (article 12). Web Share Target needs the installed WebAPK; see `RA-P8-04`.
- **HM4** scored 2 because it competes with the edge light, which is the owner's chosen presence signal. Keep it as an option only if the owner likes it in a prototype.
- **HM5** is cheap and protects trust: decisions must never vanish because the phone was glanced at in a pocket.

### The mind's arranging (AR)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| AR1 | Shadow mode (log before you steer) | Every new arranging policy runs silently first, is scored against what the owner actually did, and graduates shadow → suggest → arrange only on evidence. TOP 10 #1. | 5 | M | L | yes | B | P5 | 8 |
| AR2 | Autonomy dial | Settings → Arranging: per domain Off / Suggest / Arrange. Default Suggest. Changing it is instant and logged. | 4 | S | L | yes | B | P5 | 7 |
| AR3 | Tomorrow is ready | The night shift prepares tomorrow's first queue, practice set, study page and review load; the Briefing page shows "Ready for tomorrow" with a why per item. | 5 | M | M (usage) | budget | C | P5–P8 | 7 |
| AR4 | Breakpoint delivery | Non-urgent lines wait for a seam: a song ends, an app closes, a chapter ends, or Home sits idle 20 s. Max wait 4 h, then it goes to the Briefing page instead. | 4 | M | L | yes | A | P8 | 6 |
| AR5 | Plan pre-mortem | When the owner states a plan ("practise every day this week"), the mind asks once which obstacle is likeliest and offers an if-then plan. One question per plan, never repeated. | 4 | S | M (nag) | yes | C | P3 | 6 |
| AR6 | Friction finder → built overnight | Weekly detectors find repeated manual work in the events; the mind offers to automate one thing; a yes ships it with a switch-off. TOP 10 #7. | 5 | L | M (drift) | budget | C | P9 | 6 |
| AR7 | One focus a week | Sunday: one proposed focus for the week drawn from the owner's goals; Accept / Change / Skip. Skip is final for that week. | 4 | S | L | budget | C | P9 | 7 |
| AR8 | Second opinion | For a choice the owner marks as important, the mind also runs a pass without the profile and shows where the two differ (sycophancy guard). | 4 | S | M (usage) | budget | C | P3 | 6 |
| AR9 | Dismissal learning | Every unprompted item has Not now / Less like this / Never this kind. Thresholds per category rise fast on dismissals and fall slowly on accepts. | 4 | M | L | yes | B | P8 | 6 |

- **AR1** and **AR2** are the backbone of every app's arranging. Without AR1, a new arrangement is a guess shown to the owner; with it, the owner only ever sees arrangements that have already beaten a naive baseline. Duolingo's Birdbrain ran in logging-only mode before it steered lessons (Duolingo blog, 2020).
- **AR3** is the product's core promise and is owned by [BRIEFING.md](../product/BRIEFING.md) and the app docs; listed here for completeness, not specified.
- **AR4** implements Iqbal & Bailey's finding that delivery at task breakpoints lowers frustration. Max wait 4 h so nothing time-bound rots in the queue.
- **AR5** uses implementation intentions ("if X, then I will Y"), which have a medium-to-large effect on goal attainment (Gollwitzer & Sheeran 2006, d ≈ 0.65). It must ask **once per plan**; a second ask is a `nudge_repeat`.
- **AR8** answers the sycophancy finding that memory profiles raise agreement (MIT, 2026; Cheng et al., *Science* 2026). It costs one extra pass, so only on owner request or when the owner says "this is important".

### Memory (ME)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| ME1 | Commitment keeper | Owner-owned open threads come back exactly once, at the right seam, then let go. TOP 10 #3. | 5 | S | L | yes | B | P3 | 9 |
| ME2 | Off the record | "Off the record": the conversation is answered but never remembered, and is deleted after 7 days. TOP 10 #10. | 4 | M | M (owner forgets mode) | yes | C | P3 | 5 |
| ME3 | Why do you think that? | Any statement about the owner can be challenged; the reply cites fact ids, evidence dates and confidence, and offers Fix / Forget. | 4 | S | L | yes | B | P3 | 7 |
| ME4 | One-fact check-in | At most one fact a week to confirm or fix, on the Briefing page, chosen by uncertainty × importance. Ignored = asked again no sooner than 28 days. | 4 | S | L | yes | B | P3 | 7 |
| ME5 | On this day | From day 366 on: at most one line a day about what the owner practised, studied or played a year ago (owner-origin events only). | 3 | S | L | yes | B | P9+ | 5 |
| ME6 | Keep this | Long-press any message or line → Keep. Kept items return through the review engine (TOP 10 #2). | 4 | S | L | yes | B | P6 | 7 |
| ME7 | Things I'm unsure about | The mind holds ≤ 5 open questions about the owner and asks one only when it bears on the current conversation, ≤ 1 a week. | 3 | S | M (creepy) | yes | C | P3 | 4 |
| ME8 | Year book | On request: a private yearly page (growth curves, kept arrangements, a few day-note lines) rendered into R2. | 3 | M | L | yes | C | P9+ | 4 |
| ME9 | Owner's manual | "How I work best": an owner-editable page rendered from rule and preference facts; the mind proposes additions as decision cards. | 3 | S | L | yes | B | P3 | 5 |

- **ME2** (Off the record) scores only 5 but is in the top 10 on judgement: an owner who can't speak candidly will never tell the mind the things that matter. It is the cheapest large trust gain on the list.
- **ME4** follows the research suggestion to make calibration a weekly habit ("This week I nudged you 9 times; 6 helped"), turned towards memory: one fact, once a week, on the Briefing page, never Home.
- **ME7** is flagged `creepy` risk: an open question about the owner asked at the wrong moment feels like surveillance. Hence "only when it bears on the current conversation".

### Music (MU)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| MU1 | Ghost queue | The next 3 songs show faded; tap to keep, swipe to dismiss; dismissals train the DJ. Spec belongs to MUSIC.md. | 5 | M | L | yes | A | P5 | 8 |
| MU2 | Era capsules | The owner tags songs to life eras; while listening, at most one era question a week appears as a margin line in the player. | 4 | M | L | yes | B | P5 | 6 |
| MU3 | Song story | Long-press a song: first play, busiest month, play curve, last skip. Numbers only, from owner events. | 3 | S | L | yes | B | P5 | 5 |
| MU4 | Hour-shaped energy | Queue energy follows the owner's learned skip pattern by hour of day and weekday (no sensors, no mood guessing). | 4 | M | L | yes | A | P5 | 6 |
| MU5 | Library gardening | ≤ 3 one-tap fixes a week: duplicates, missing tags, forgotten favourites. Any removal is an ask-first proposal. | 3 | M | M (deletes) | yes | B | P5 | 3 |
| MU6 | Listen like a player | After a guitar session, 1–2 recordings in the piece's style are queued with one "listen for" note. | 3 | S | L | yes | C | P6 | 5 |
| MU7 | Wind-down | A sleep queue the owner starts; volume fades over the last 10 min; stop timer 20/40/60 min. Never starts itself. | 3 | S | L | yes | A | P5 | 5 |
| MU8 | Second-language hour | Queue songs sung in the second language from the library (from language tags). No lyric fetching or display. | 3 | S | L | test | B | P8 | 4 |

- **MU1** belongs to [MUSIC.md](../product/apps/MUSIC.md). It is the purest form of "arrange, don't chat": the cost of a wrong guess is a swipe (Cursor Tab pattern).
- **MU2** draws on nostalgia research: revisiting meaningful music raises a sense of meaning and social connectedness (Sedikides & Wildschut, *Review of General Psychology*, 2018). One question a week, never pushed.
- **MU8** is `test` because language tags come from offline audio tagging whose quality on the owner's genres is unverified (`RA-P5-09`).

### Guitar (GT)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| GT1 | Practice loop | Tempo ladder, worst bar first, overnight-gain note and tension guard as one loop. TOP 10 #5. | 5 | M | L | yes | A | P6 | 8 |
| GT2 | Fading scaffolds | Fingering hints fade as a section is mastered (after 3 sessions at ceiling); tap to reveal. | 4 | M | L | yes | A | P6 | 6 |
| GT3 | Slow-down loop | Loop a passage of a library recording at 50–100 % speed with pitch kept (`preservesPitch`). | 4 | M | L | yes | A | P6 | 6 |
| GT4 | Hands-free controls | Big tap zones plus Bluetooth page-turner pedals (they send key events): next, again, slower. Buying a pedal is a cost (ask first). | 4 | S | L | yes | A | P6 | 7 |
| GT5 | Ready to play for someone | When a piece passes the mastery check, one line suggests playing it for a person (law 7). | 4 | S | L | yes | A | P6 | 7 |
| GT6 | Repertoire upkeep | Learned pieces join the review engine as play-through items so they don't fade. Part of TOP 10 #2. | 5 | S | L | yes | A | P6 | 9 |
| GT7 | Tension guard | Session clock: shake-out note at 25 min, block end at 75 min, a Tension button; 3 tension taps in 7 days → rest day + see a teacher. Part of TOP 10 #5. | 4 | S | L | yes | A | P6 | 7 |
| GT8 | Teacher's page | A weekly one-page practice summary the owner can send to a human teacher through the share sheet. The mind never sends it. | 3 | S | L | yes | A | P6 | 5 |

- **GT1 + GT7** are specified together as top-10 #5. Their numbers are heuristics from the practice-science table in the feasibility research (Duke, Simmons & Cash 2009; Carter & Grahn 2016; Guadagnoli & Lee 2004; Segovia's ~75-minute blocks; the dystonia stop rule).
- **GT2** applies desirable difficulties (Bjork 1994): support that is removed as skill grows produces more durable learning than support that stays.
- **GT4** costs nothing if the owner already owns a pedal; buying one is a cost and is asked first.
- **GT5** is law 7 made useful: a piece that is ready is a reason to be with people.

### Study (ST)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| ST1 | Your thought first + hint ladder | Before a summary or answer in a learning context, the owner's own line first; hints before answers; "just tell me" always works. TOP 10 #6. | 5 | S | L | yes | C | P3/P7 | 9 |
| ST2 | Threads from your own notes | Margin cross-references drawn from the owner's past notes and highlights, never from outside commentary. | 4 | M | L | yes | B | P7 | 6 |
| ST3 | Explain it back | The owner writes or records a 2-minute explanation; the mind checks it against cited pages and asks one probing question. | 4 | S | L | yes | C | P7 | 7 |
| ST4 | Plan without debt | Reading plans recompute after missed days. The page never shows "behind" or a count of missed days. | 4 | S | L | yes | A | P7 | 7 |
| ST5 | Highlights that return | Highlights marked Keep become review items (one-sentence cloze at most, for copyright). | 4 | S | M (quote length) | yes | B | P7 | 6 |
| ST6 | Question journal | Questions the owner writes while studying stay open; when a later reading answers one (citation match), it is shown once beside that page. | 4 | M | L | yes | C | P7 | 6 |

- **ST1** is the generation effect (Slamecka & Graf 1978) plus the Bastani result: the owner's own attempt first, help after. Specified as top-10 #6.
- **ST4** exists because missed-day debt is streak guilt in disguise (§5, A1).
- **ST5** keeps quotes to one sentence: the books are copyrighted and stay private.

### Second language (SL)

The second language is set privately in Settings; nothing here names it.

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| SL1 | Second-language mode | The mind replies in the second language one step above the owner's level, with tap-to-gloss and gentle recasts. TOP 10 #4. | 5 | S | L | yes | C | P3 | 9 |
| SL2 | Keep a phrase | Any second-language phrase in chat, podcasts or songs → Keep → review card. Part of TOP 10 #2. | 5 | S | L | yes | B | P3 | 9 |
| SL3 | Hear it | Tap a word → on-device `speechSynthesis` voice for the second language; fallback Workers AI MeloTTS if the voice is missing. | 3 | S | L | test | A | P3 | 4 |
| SL4 | Podcast listening ladder | Second-language episodes at 0.85×, transcript on demand (Workers AI Whisper), tap-to-gloss on the transcript. | 4 | M | M (neurons) | budget | B | P8 | 5 |
| SL5 | Shadowing | Mic switched on by the owner; repeat a line; a Whisper transcript is compared word by word. | 3 | M | M (neurons) | budget | B | P8 | 3 |
| SL6 | Phrases for what's next | Before a situation the owner mentions (a call, an errand), the mind offers 5 useful phrases as keepable cards. | 4 | S | L | yes | C | P3 | 7 |

- **SL1** uses comprehensible input one step above the learner's level (Krashen 1982). Recasts are gentle but are the feedback type learners notice least (Lyster & Ranta 1997), so explicit correction stays available as an owner switch.
- **SL3** is `test` because offline second-language voices on the owner's phone are unverified (`RA-P3-06`). The fallback MeloTTS costs 18.63 neurons per audio minute (Workers AI pricing, read 2026-10-28), so ~2 minutes a day is under 40 neurons.
- **SL4/SL5** spend Whisper neurons (46.63 per audio minute): 20 minutes a day ≈ 930 of the 10,000 free neurons. Metered with the rest of the neuron budget.

### Learning, across domains (LN)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| LN1 | One review engine | One FSRS scheduler for second-language phrases, kept lines, study highlights and guitar repertoire. TOP 10 #2. | 5 | M | L | yes | A | P6 | 8 |
| LN2 | Skill map | One page per skill: what is solid, what is fading (from review stability), what is next. Trend lines, no levels or badges. | 4 | M | L | yes | B | P9 | 6 |
| LN3 | Plateau switch | Change-point detection on a growth curve; after a 14-day plateau the mind proposes one change of method, with its source. | 4 | M | M (bad advice) | yes | C | P9 | 5 |

- **LN1** absorbs GT6, SL2, ME6 and ST5: one scheduler, one review sheet, one copy rule. Spacing and retrieval are among the most robust findings in learning research (Cepeda et al. 2006, 839 assessments; Karpicke & Roediger 2008). Specified as top-10 #2.
- **LN3** is `M` risk: a wrong "change your method" suggestion costs trust. It must cite its source and is offered once (`nudge_repeat`).

### Media (MD)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| MD1 | Something for N minutes | "Something for 20 minutes" opens Astra, My Media or Podcasts on one fitting title, with a why. **Settled in direction by owner ruling** (the chat opens apps from plain text; in Astra the owner picks the stream); see [BEHAVIOR.md §2.3](../mind/BEHAVIOR.md#23-requests-that-reach-into-the-apps-owner-rulings). | 4 | M | L | yes | C | P8 | 6 |
| MD2 | Finite today | Media apps open on "Today's 3" with an end: "That's all for today." Autoplay of the next item is off by default. | 4 | S | L | yes | A | P8 | 7 |
| MD3 | Note at timestamp | "Note this" while listening or watching saves a timestamped note; the night shift links it to study or open threads. | 3 | M | L | yes | B | P8 | 4 |
| MD4 | Continue | One Briefing row lists ≤ 3 things in progress across apps with one-tap resume. | 4 | S | L | yes | A | P8 | 7 |
| MD5 | The hour you set | If the owner sets a media limit, one line appears once when it is reached. It never blocks and never repeats that day. | 3 | S | L | yes | A | P8 | 5 |

- **MD2** is the anti-feed: Google Now lost its value when it drifted into an engagement feed; ChatGPT Pulse deliberately ended ("that's all") before it was folded into user-written schedules. A finite list is the respectful default.

### Health of the system (SY)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| SY1 | Platform watch | Monthly re-check of limits, prices, deprecations and licences (see RESEARCH-AGENDA.md); speaks only when something changed. | 4 | S | L | budget | C | P4 | 7 |
| SY2 | Health page | Settings → System: SLOs, last deploy, last restore drill, "caught first" count. | 3 | S | L | yes | B | P4 | 5 |
| SY3 | Usage-aware mind | The night shift defers optional work when the owner's plan usage is high. Needs a readable usage figure (RA-P2-07). | 4 | M | M (blind) | test | C | P4 | 4 |
| SY4 | Failure drills | Monthly, on local workerd: inject 5xx, 403 and offline; run the browser suite; the result appears on the Health page. | 3 | M | L | yes | B | P4 | 4 |
| SY5 | Quota weather | A "System" line on the Briefing page appears only when a free-tier quota passes 70 % before 18:00 UTC. | 3 | S | L | yes | B | P4 | 5 |

- **SY1** is the runtime side of the monthly research cadence in [RESEARCH-AGENDA.md §4](RESEARCH-AGENDA.md#4-recurring-research-cadence). It reads outside web pages, so it runs in the quarantined reader and can never write facts or rules.
- **SY3** is `test`: there is no confirmed way for a session to read its own plan usage (`RA-P2-07`). Until then the owner checks `/usage` weekly.

### Time and attention (TA)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| TA1 | Focus envelope | "Focus 45": no pushes, no home lines, instrumental queue, dimmed edges; one closing line at the end. | 4 | S | L | yes | A | P5 | 7 |
| TA2 | Attention receipt | On request (or Sundays if opted in): minutes by domain against the owner's own stated intentions. Trend, no verdict. | 4 | S | L | yes | B | P8 | 7 |
| TA3 | Rest day | An owner-chosen weekday: practice, media and build reports are held back; nothing counts as missed. | 4 | S | L | yes | A | P8 | 7 |
| TA4 | Snooze to a moment | "Not now" asks nothing back; the item returns at the next seam of the same kind (next time Guitar opens), once. | 3 | S | L | yes | B | P8 | 5 |

- **TA2** follows the lived-informatics model: tracking is useful when it serves the owner's own questions and survives lapses without judgement (Li, Dey & Forlizzi, CHI 2010; Epstein et al., UbiComp 2015). It shows the owner's stated intentions next to the numbers, never a grade.
- **TA3** respects owner rhythms: a rest day is a setting, not a gap.

### People (PE)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| PE1 | Ask a person | Answers about judgement, relationships, faith or a skill end with one kind of person worth asking (law 7), once per topic. | 4 | S | L | yes | C | P2 | 7 |
| PE2 | People cards | Only what the owner says (source=user): who, how known, dates they mention. One quiet line the day before a date. | 4 | M | M (others' data) | yes | B | P3 | 5 |
| PE3 | Draft, don't send | The mind drafts a message; the owner sends it through the Android share sheet. The mind has no outbound channel. | 4 | S | L | yes | C | P3 | 7 |
| PE4 | Who helped this week | Optional Sunday line; the private answer can become a thank-you draft (PE3). | 3 | S | M (ritual nag) | yes | C | P3 | 4 |

- **PE2** stores the minimum about other people, only from the owner's own words (`source=user`), and never raises it unprompted except the one dated line. Anything sent to a person stays an ask-first `reach_people` action, and the mind has no outbound channel at all (PE3: the owner sends).
- **PE4** draws on gratitude research (Emmons & McCullough 2003) but carries `nag` risk; it is off by default.

### Reflection (RE)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| RE1 | Your day in three lines | The Briefing page shows yesterday's day note in 3 lines; an edit is a memory correction. | 4 | S | L | yes | C | P3 | 7 |
| RE2 | Sunday review | At most 3 questions, ~5 minutes: what went well, what to drop, one focus (feeds AR7). Skippable in one tap. | 4 | S | M (nag) | yes | C | P9 | 6 |
| RE3 | Growth curves | Goals are facts; progress is computed from events and shown as a trend with a range, never as a streak. | 4 | M | L | yes | B | P9 | 6 |
| RE4 | Letters to future you | The owner writes and picks a date; it arrives as that day's voice line (not a push). | 4 | S | L | yes | B | P3 | 7 |
| RE5 | Calibration game | The owner also makes weekly predictions about their own week; both Brier scores are shown side by side. | 3 | M | L | yes | B | P9 | 4 |
| RE6 | Self-experiments (n-of-1) | "Does X help Y?" → a randomised 14-day plan, measured from events, reported with odds. TOP 10 #8. | 5 | M | M (stats misuse) | yes | C | P9 | 7 |

- **RE6** (self-experiments) is the clearest "super intelligence that grows the owner" idea on the list: the mind does the statistics; the owner learns what actually works for them. Specified as top-10 #8.
- **RE3** shows trends with ranges. A day with no practice is a point on a curve, not a broken chain (§5, A1).

### Rituals (RI)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| RI1 | Morning set | First open after 06:30: an optional ~4-minute set (due reviews, scale warm-up, first song). Never shown twice in a day. | 4 | S | M (ritual pressure) | yes | A | P8 | 6 |
| RI2 | Close the day | "Good night": one line confirming tomorrow's setup, go-quiet until 06:30, optional wind-down queue. | 4 | S | L | yes | B | P3 | 7 |
| RI3 | First light | First open after 06:30: the field brightens over 1.2 s, once a day. None under reduced motion. | 2 | S | L | yes | A | P1 | 3 |

- Rituals carry `ritual pressure` risk: an optional morning set that is shown every day becomes an obligation. RI1 therefore appears only when there is something due, never twice a day, and never with a count of skipped days.

### Offline and travel (OF)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| OF1 | Pack for offline | "Pack for offline" downloads music, pages, reviews, tabs and episodes for a day away, within a storage cap. TOP 10 #9. | 5 | M | M (quota) | yes | A | P8 | 7 |
| OF2 | Honest outbox | Offline messages show "Sends when you're back online"; instant commands keep working. | 4 | S | L | yes | A | P2 | 7 |
| OF3 | Travel time | When the phone's time zone changes, ask once whether the day roll and quiet hours move with it. | 3 | S | M (quiet hours) | yes | B | P2 | 4 |
| OF4 | Low-data mode | On Save-Data or a slow connection: no prefetch, no images, cached audio first. | 3 | S | L | yes | A | P5 | 5 |

- **OF1** is specified as top-10 #9. **OF3** matters because quiet hours and the day roll are in owner-local time; a silent switch could ring at 05:00.

### Accessibility (AX)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| AX1 | Ring without gestures | Every ring app is also reachable from the menu list and the keyboard, with screen-reader labels. | 4 | S | L | yes | A | P1 | 7 |
| AX2 | Gold has words | Every edge-light state has a text equivalent (live region) and an optional haptic. | 4 | S | L | yes | A | P1 | 7 |
| AX3 | Read aloud | The voice line and replies can be read aloud with on-device `speechSynthesis`. | 3 | S | L | yes | A | P2 | 5 |
| AX4 | Big type | Text scales to 200 % without breaking Home or hiding the ask bar. | 4 | S | L | yes | A | P1 | 7 |

- AX1, AX2 and AX4 are cheap and belong in P1 with Home. The ring is a press-and-hold gesture; anyone who can't hold still (tremor, a busy hand on a guitar neck) needs another path.

### Delight (DE)

| ID | Idea | Behaviour (one line) | V | E | Risk | $0 | Privacy | Phase | Score |
|---|---|---|---|---|---|---|---|---|---|
| DE1 | Real milestones | When a real threshold is crossed (target tempo, 100 mature cards), the voice line says it once, with the numbers. No confetti. | 4 | S | L | yes | B | P6 | 7 |
| DE2 | Seasonal palette | The field's palette drifts with season and hour, inside the locked accents. | 2 | S | L | yes | A | P2 | 3 |
| DE3 | How are you? | The owner can ask the mind about itself: usage, errors, what it is learning, with honest odds. | 3 | S | L | yes | C | P2 | 5 |
| DE4 | After a late night | After a conversation past 01:00, the next day's first line is softer and at most one thing is arranged. | 3 | S | M (inference) | yes | B | P3 | 4 |
| DE5 | Kept-rate line | Once a month the voice line reports how many arrangements stuck ("27 of 31 kept"). | 3 | S | L | yes | B | P9 | 5 |

- Delight here means **being specific and right**, not animation. DE1's line ("Section B reached 102 BPM, your target. Two weeks ago it was 84.") is the reward; confetti is an anti-feature (§5, A2).

---

## 4. The top 10

**How they were chosen.** Value 5 first, then score. Three value-5 ideas already belong to sibling specs (HM1 → HOME, MU1 → MUSIC, AR3 → BRIEFING) and are not re-specified here. Four value-5 ideas merge into LN1 (GT6, SL2) or GT1 (GT7). Two judgement calls: **AR6** (score 6) is in because it is the only idea that makes the system improve itself from the owner's real behaviour, which is what the Briefing's "what was built overnight" promises; **ME2** (score 5) is in because candour is the precondition for everything else the mind learns.

**Ported apps (owner ruling).** Music, Guitar, Podcasts, Astra and My Media are ported as they are first ([ROADMAP.md](ROADMAP.md) P1b). No top-10 item changes a ported app before the owner agrees to that change. These parts land only inside that app's agreed evolution (P5, P6, P8): #1's in-app policies and the app events they learn from; #2's guitar repertoire cards; all of #5; #6 inside Guitar; #7's in-app defaults (the owner's Yes to the offer is the agreement for that one change); #8's outcomes measured from Guitar events; #9's packing of tracks, tabs and episodes. Until then each item runs only where no ported app changes: #1 in Study and the chat, #2 for second-language phrases, kept lines and study highlights, #6 in the chat and Study, #8 with outcomes outside the ported apps, #9 for the conversation, the Briefing, reviews and Study pages.

| # | Idea | ID | Phase | V | E | Score | Main risk |
|---|---|---|---|---|---|---|---|
| 1 | Shadow mode | AR1 | P5 | 5 | M | 8 | none major |
| 2 | One review engine | LN1 | P6 (cards collected from P3) | 5 | M | 8 | none major |
| 3 | Commitment keeper | ME1 | P3 | 5 | S | 9 | nag (guarded by remind-once) |
| 4 | Second-language mode | SL1 | P3 | 5 | S | 9 | none major |
| 5 | Practice loop | GT1 + GT7 | P6 | 5 | M | 8 | bad heuristics (owner-tunable) |
| 6 | Your thought first + hint ladder | ST1 | P3 (chat) / P7 (Study UI) | 5 | S | 9 | friction (one-tap escape) |
| 7 | Friction finder → built overnight | AR6 | P9 | 5 | L | 6 | drift (measured, switch-off) |
| 8 | Self-experiments (n-of-1) | RE6 | P9 | 5 | M | 7 | stats misuse (odds, sims) |
| 9 | Pack for offline | OF1 | P8 | 5 | M | 7 | storage quota |
| 10 | Off the record | ME2 | P3 | 4 | M | 5 | owner forgets the mode is on |

Data shapes below are proposals for [DATA.md](../engineering/DATA.md); that doc owns the final schema.

### 4.1 Shadow mode: log before you steer (AR1) [proposal]

Every arranging behaviour is a named **policy** (`music.morning_queue`, `guitar.next_section`, `study.next_page`, `media.today3`, …). A new policy starts in **shadow**: each night it makes its arrangement, the Worker stores it, and nothing reaches any screen. At the next day roll a deterministic resolver checks the guess against what the owner actually did and compares it with a naive baseline ("same as yesterday"). Only when the policy has beaten the baseline for two weeks does it begin to **suggest** (faded, needs a tap), and only after the owner keeps most suggestions does it **arrange** (applied, with undo). Bad weeks demote it. The owner sees only arrangements that have already proven themselves.

| Rule | Exact behaviour |
|---|---|
| States | `shadow` → `suggest` → `arrange`; any state → `off`. Stored in `policies(id, state, metric, baseline, changed_at, changed_by)`. |
| Shadow output | One row per policy per day in `policy_runs(policy_id, day, prediction_json, hit, baseline_hit, resolved_at)`. The Worker refuses any surface write for a policy in `shadow` (`409`, code `policy_shadow`). |
| Hit (default) | Lists: hit if ≥ 1 of the top 3 predicted items is among the owner's first 3 actions of that kind that day. Single choice: exact match. Apps may define their own in their doc. Days with no owner activity in the domain are not counted. |
| shadow → suggest | ≥ 14 counted days **and** hit rate ≥ 0.40 **and** hit rate − baseline hit rate ≥ 0.10. Announced once as a Briefing-page line: "For 14 days I quietly guessed your morning music: 9 right, against 4 for 'same as yesterday'. I'll start suggesting it, faded. · Not yet". "Not yet" keeps it in shadow 14 more days. |
| suggest → arrange | ≥ 14 counted days in `suggest` **and** kept rate ≥ 0.70 **and** dismiss rate ≤ 0.20 **and** the domain's autonomy dial (AR2) is `Arrange`. If the dial is `Suggest`, the mind may offer once: "Your morning queue suggestions were kept 11 of 14 days. Arrange it for you from now on? · Yes · No". |
| Demotion | `arrange → suggest` when undo rate over a rolling 14 days > 0.20. `suggest → shadow` when kept rate over 14 days < 0.40. "Stop doing that" → `off` at once, until the owner turns it back on. Each change is a ledger row with its why. |
| Budget | ≤ 12 policies; ≤ 12 rows written a day. |

**Acceptance.** (a) Backend test: a surface write for a `shadow` policy returns `409 policy_shadow`. (b) Fixture of 14 counted days with 8 hits and 4 baseline hits: the state is `suggest` after the 14th roll; with 8 hits and 7 baseline hits it stays `shadow`. (c) Fixture of 14 `arrange` days with 4 undos: demoted to `suggest`, with a ledger row. (d) Playwright: the app shows no element for a policy in `shadow`.

### 4.2 One review engine (LN1) [proposal]

One spaced-repetition scheduler keeps everything the owner chose to learn from fading: second-language phrases, kept lines from conversations, study highlights and guitar pieces that were mastered. It runs on the phone with the open-source FSRS algorithm (`ts-fsrs`, MIT, v5.4.2 published 2026-09-01), works offline, and appears only as one quiet row on the Briefing page when something is due. Items are created only when the owner taps **Keep**; the mind may suggest up to five a day in one sheet. There are no counts of overdue items, no streaks and no badges: missed days simply reschedule.

| Rule | Exact behaviour |
|---|---|
| Item | `cards(id, domain: lang\|keep\|study\|guitar, prompt, answer, ref, created_by: owner\|mind, fsrs_json, suspended, created_at)`. Review log as events `learn.review {card, rating 1–4, ms}`; card state is re-derivable by replaying the log. |
| Creation | Owner tap **Keep** (long-press on a line, a gloss sheet, a highlight, a passed mastery check). Mind suggestions: ≤ 5 a day, shown together in one "Keep these?" sheet; untouched suggestions expire after 3 days. |
| Scheduler | `ts-fsrs` 5.x vendored in `frontend/vendor/` with its licence. Desired retention 0.90 (owner range 0.80–0.95). Maximum interval 365 days; guitar items 120 days. |
| Ratings | Again / Hard / Good / Easy. Guitar play-through: Again = couldn't play through; Hard = with stops; Good = clean at ≥ 90 % of the section's ceiling tempo; Easy = clean at ceiling, relaxed. |
| Daily limits | 5 new items per domain; 30 reviews in total. Overflow is rescheduled silently. Order: due date, interleaving domains. |
| Where | Briefing page row "Review · about 4 min" (estimates: second-language phrases 10 s, kept and study lines 20 s; guitar shown separately as "+ 1 piece"). Hidden when nothing is due. Never on Home, never a badge, never a push. |
| Copy | Forbidden in this feature: "overdue", "streak", "behind", "missed", and any number above 30 (article 16 lint). |
| Later | After ≥ 1,000 reviews, the night session may fit personal FSRS parameters (inside the session, never in Actions: review data is personal). |

**Acceptance.** (a) Unit test: a 20-review fixture produces the same due dates as the `ts-fsrs` reference run. (b) Playwright, airplane mode: review 3 cards, go online, the server's state equals the phone's. (c) Copy lint passes over the feature's strings. (d) With no due items the Briefing page has no review row.

### 4.3 Commitment keeper (ME1) [proposal]

When the owner says they will do something ("I'll send the photos by Friday"), or asks to be reminded, the mind keeps it as an owner-owned open thread and brings it back **exactly once**, at a natural moment, then lets go. Reminders the owner set with a time are delivered at that time; commitments the mind only heard are offered as a single quiet line with Done / Later / Drop. Nothing is ever repeated unprompted, nothing arrives before 06:30, and no copy ever says "forgot".

| Rule | Exact behaviour |
|---|---|
| Sources | (a) `+` sheet → Remind me (explicit time); (b) "remind me …" in a message; (c) commitment language in owner messages, extracted by the night shift with the message IDs as evidence (`origin=owner_device` only). |
| Kinds | `reminder` (owner gave a time) and `commitment` (inferred from the owner's words). |
| Reminder | Delivered at its time as the voice line, plus a push if the time is 06:30–22:00 and the push budget allows; outside that window, at 06:30 as the voice line. Once. |
| Commitment timing | Due date known and ≥ 2 days away: first seam (AR4) on or after due − 24 h. Due today or tomorrow: first seam on or after due − 3 h. No due date: first seam 3 days after creation. Never 00:00–06:30, never in focus or go-quiet. |
| Commitment surface | Voice line, never a push: "You said you'd send the photos by Friday." with **Done · Later · Drop**. `topic_key = thread:<id>`, so the Worker's 14-day `nudge_repeat` rule blocks any second unprompted mention. |
| Later | Owner picks Tonight 19:00 / Tomorrow 09:00 / Monday 09:00. It becomes an owner-set `reminder` (allowed once more). |
| No reaction | After 48 h it stays listed under "Waiting on you" on the Briefing page, silently. After 30 days with no action it moves to "Parked" (not deleted), without a message. |
| Copy | Forbidden: "forgot", "don't forget", "still haven't", "overdue". |

**Acceptance.** (a) Night fixture: the owner message "I'll send the photos by Friday" creates one `commitment` with that message as evidence. (b) Backend: a second unprompted surface for the same thread within 14 days returns `409 nudge_repeat`. (c) Fake clock at 05:00: nothing is surfaced; at 06:30 the reminder appears. (d) Push count for `commitment` items is 0 across the fixture week.

### 4.4 Second-language mode (SL1) [proposal]

The owner can ask the mind to speak the second language (set privately in Settings). It then replies one step above the owner's level, with short sentences at lower levels, and every harder word can be tapped for a gloss, heard aloud and kept as a review card. Mistakes in the owner's second language are answered by using the correct form naturally (a recast); explicit correction is an owner switch. Anything serious (decisions, errors, security, money, health, matters under law 8) is always in the owner's primary language. "In English" ends it at once.

| Rule | Exact behaviour |
|---|---|
| Modes | Off (default) / Second-language replies / Mixed (second language, new words glossed in brackets). Set by asking for it in the second language / "in English" or Settings → Language practice. Stored as a `rule` fact, `source=user`. |
| Level | CEFR band A1–C1. Starts from one question when first turned on. The night shift may estimate a change from the owner's second-language messages and proposes it as one Briefing line; never changed silently. |
| Reply limits | A1–A2: sentences ≤ 12 words, present and simple past, ≤ 1 glossed word per sentence. B1: ≤ 18 words. B2+: natural. |
| Gloss | Each second-language mind message carries `meta.gloss` for every word outside the owner's band (A2 = top 1,500 lemmas, B1 = 3,000, B2 = 5,000 of a frequency list; list and licence: `RA-P3-05`): `{lemma, en, pos}`. Tap → sheet with lemma, meaning, **Hear it** (SL3), **Keep** (LN1). Works offline because the gloss travels with the message. |
| Correction | Default: recast only. With "Correct me" on: at most one correction per owner message, as a small line under the owner's bubble ("→ <the corrected form>"). Error patterns are counted in the day note's stats; on Sundays at most one "one thing to notice" line. |
| Escape | Decision cards, outage lines, security, money, health and law-8 topics are always in the primary language. Under any message: "Say it in English" translates that one message. |

**Acceptance.** Eval set SL-1 (20 prompts, synthetic) in [EVALS.md](../mind/EVALS.md): ≥ 18/20 replies in the second language and within the level's sentence limit; 20/20 decision cards in the primary language; gloss coverage ≥ 95 % of out-of-band words, checked by a script against the frequency list. Browser test: tapping a glossed word offline opens the sheet.

### 4.5 Practice loop (GT1 + GT7) [proposal]

Guitar practice runs as a loop the owner can feel working: each section climbs a tempo ladder that keeps success around 70–80 %; the worst bar from the last recorded take (ears switched on by the owner) opens tomorrow's session; the morning after a good session a margin note shows the overnight gain; and a tension guard ends sessions before strain becomes injury. The numbers are heuristics, not laws, and [GUITAR.md](../product/apps/GUITAR.md) owns the final values.

| Rule | Exact behaviour |
|---|---|
| Start tempo | First day of a section: max(40, round(0.6 × target)) BPM. Later days: yesterday's ceiling − 8 BPM. |
| Clean rep | The owner taps **Clean**, or (ears on) timing mean absolute error ≤ 40 / 20 / 10 ms for beginner / intermediate / advanced and no wrong-note flag. |
| Ladder | +4 BPM after 3 clean reps in a row. −4 BPM after 2 misses in a row (never below the start tempo). Over the last 10 reps: ≥ 9 clean → step up at once; ≤ 5 clean → step down twice. |
| Ceiling | Highest tempo with 3 clean reps in a row that day; event `guitar.ceiling {section, bpm}`. |
| Worst bar first | After a take with ears on, bars are ranked by (mean absolute error in ms + 30 × wrong notes). Tomorrow's set opens with the worst bar: 2 minutes at ceiling − 12 BPM. |
| Overnight note | When today's first ceiling for a section is ≥ yesterday's + 2 BPM, one margin line: "Overnight: +4 BPM on section B (88 → 92)." If it is lower, nothing is said. |
| Tension guard | At 25 min of continuous practice: one line, "Shake out your hands." At 75 min: "That's a full block. Rest 10 minutes." A **Tension** button ends the session and logs `guitar.tension`. Three in 7 days: tomorrow's set becomes a rest suggestion plus "Worth showing this to a teacher." (law 7). Rest never counts as missed. |

**Acceptance.** (a) Unit tests drive the ladder with scripted reps and check every step, floor and ceiling. (b) A two-day fixture produces the "+4 BPM" note; a fixture with a lower ceiling produces no note. (c) Three `guitar.tension` events in 7 days produce the rest suggestion and no practice set. (d) Copy lint passes.

### 4.6 Your thought first, and the hint ladder (ST1) [proposal]

Wherever learning is the point (study, guitar, the second language, or any skill the owner set as a goal), the mind helps in rungs: first a question or pointer, then a partial step, then the full answer. In the Study reader, "Summarise" first offers a one-line field for the owner's own take. "Just tell me" or **Skip** always jumps straight to the answer, with no comment. Outside learning (play this, open that, logistics) the mind answers directly. If the owner keeps skipping in a domain, the mind offers once to stop laddering there.

| Rule | Exact behaviour |
|---|---|
| Learning context | The Study or Guitar app, second-language mode, or a message the mind classifies as about a skill with a `goal` fact. Everything else is answered directly. |
| Rungs | 1: a question or pointer (≤ 2 sentences). 2: a partial (structure or first step). 3: the full answer with citations. Move up by replying, **Another hint**, or **Just tell me** (straight to 3). |
| Study "Summarise" | A one-line field "Your take" with **Compare** and **Skip**. Compare stores the owner's line as an owner note (`source=user`), then shows the cited summary plus at most 2 lines: what the owner's line caught, and one thing the pages add (cited). Skip shows the summary at once. |
| Respect rule | If "Just tell me" or Skip is used in ≥ 80 % of ≥ 20 learning turns in a domain over 30 days, the mind offers once: "Answer directly in Study from now on? · Yes · No". Yes stores a `rule` fact (`source=user`); the default rung for that domain becomes 3. |

**Acceptance.** LAW-5 fixtures in [EVALS.md](../mind/EVALS.md) extended: 10 learning prompts → the first reply contains no full answer; 10 "just tell me" prompts → full answer in one reply; 10 non-learning prompts → direct answers. Browser test: Skip shows the summary with no further tap.

### 4.7 Friction finder → built overnight (AR6) [proposal]

Once a week the night shift looks for work the owner keeps doing by hand: the same setting changed every time an item opens, the same search ending on the same pick, the same arrangement undone, the same three-step path. It offers to automate **one** thing a week as a Briefing-page line. A yes is the go-ahead: the mind builds it, tests it, ships it, and reports it under "Built overnight" with a switch to turn it off. Two weeks later it checks whether the friction actually went away, and offers to revert if not.

| Rule | Exact behaviour |
|---|---|
| Detectors (SQL over 28 days, Sunday night) | **D1** same setting change within 60 s of opening the same item in ≥ 5 of the last 7 sessions. **D2** same normalised query → same picked item ≥ 4 times (→ search alias). **D3** same arrangement kind undone ≥ 3 times in 14 days (→ policy change, feeds AR1). **D4** same 3-step navigation within 30 s ≥ 5 times in 14 days (→ shortcut). |
| Offer | ≤ 1 a week, on the Briefing page: "You set the capo to 2 every time you open this piece (6 of 7 times). Make it the default for this piece? · Yes · No". |
| Yes | Branch → regression test reproducing the friction → CI → merge → deploy → "Built overnight" row with **Switch off** (a flag under Settings → Changes). Personal values (which piece, which query) live in Worker settings, never in code or commit messages. |
| No | That candidate is suppressed for 90 days. |
| Never | Anything touching ask-first classes, protected paths (`mind/CONSTITUTION.md`, `.github/`, auth code) or the locked design (Home, ring, edge light, `+` sheet). |
| Check | The detector's count for that friction must fall ≥ 80 % in the next 14 days. If not: "That change didn't help (still 5 of 7 times). Revert? · Yes · No". |

**Acceptance.** (a) Detector fixtures each trigger exactly their candidate and nothing else. (b) A "No" suppresses the same candidate for 90 days (fake clock). (c) A shipped change has a Settings switch that restores the old behaviour, tested in the browser. (d) The 14-day follow-up runs and reports either way.

### 4.8 Self-experiments, n-of-1 (RE6) [proposal]

The owner can ask "Does practising in the morning help my tempo?" and the mind turns it into a small randomised experiment: two conditions, a measure the system already records, 14 days assigned at random in balanced pairs, a one-line instruction each morning, and an honest result with odds at the end. The owner learns what works for them; the mind does the statistics. Only one experiment runs at a time, and it can be stopped any time with no penalty. Health interventions, faith practices and anything involving other people are out of scope.

| Rule | Exact behaviour |
|---|---|
| Outcomes | Only metrics with a named resolver over owner events: ceiling BPM, clean-rep rate, review retention (share of Good/Easy), study minutes, second-language reply length. |
| Interventions | Things the owner does: time of day, warm-up type, session length, review timing. Excluded: medicine, diet, sleep aids, faith practices (law 8), other people. |
| Design | 14 days in 7 balanced pairs; order within each pair drawn with `crypto.getRandomValues`. The owner sets a minimum meaningful difference (e.g., +2 BPM) at the start. |
| Daily | On the first open after 06:30: voice line "Today is a B day: practise after dinner." Also a Briefing-page row. |
| Missing days | A day counts only if the outcome event exists. Missing days are excluded silently; the experiment extends by up to 6 days to reach 10 counted days, then ends. |
| Analysis | Difference in means (B − A) with an 80 % bootstrap interval (2,000 resamples), run in the night session. Verdict "B helped" only if the interval excludes 0 **and** the difference ≥ the minimum meaningful difference; otherwise "No clear difference". Always with odds and the caveat below. |
| Honesty | Simulation (400 runs, 7 days per arm): a true one-standard-deviation effect is detected about 77 % of the time; with no true effect, a false "helped" appears about 15 % of the time. With 10 per arm: 85 % and 10 %. The result card says this in one line. |
| After | Result stored as an `observed` fact with the days' events as evidence. "Adopt B" stores a `rule` fact, `source=user`. |

**Acceptance.** CI simulation on synthetic data (no personal data): with effect d = 1.0 and 7 per arm, verdict "helped" in ≥ 70 % of 400 runs; with d = 0, false "helped" ≤ 18 %. Fixture: a missing day extends the schedule; "stop experiment" ends it with "stopped early" and no further daily lines.

### 4.9 Pack for offline (OF1) [proposal]

Before a day away from signal, the owner says "pack for offline" and the phone downloads what that day needs, in priority order, inside a storage cap: the conversation tail and today's Briefing, reviews due in the next 3 days, current guitar tabs and loops, the current book's nearby pages, about three hours of the arranged music plus recent favourites, and the next two podcast episodes. While offline, everything packed works, instant commands work, and messages to the mind wait in the outbox with an honest label. Unused packs are released after a week.

| Rule | Exact behaviour |
|---|---|
| Triggers | "Pack for offline" / "I'll be offline tomorrow", or Settings → Offline → Pack now. The mind may suggest it once when the owner mentions travel (law 4). |
| Priority | 1. Conversation tail, Briefing snapshot, instant indexes (~2 MB). 2. Reviews due within 3 days. 3. Current tabs and practice loops. 4. Current book: pages ±50 around the last position, or the whole PDF if ≤ 50 MB. 5. Music: next 3 h of the arranged queue plus the 50 most-played tracks of the last 30 days (deduplicated). 6. Podcasts: next 2 queued episodes. |
| Cap | min(2 GB, 50 % of the free quota from `navigator.storage.estimate()`). If `persist()` is not granted: 500 MB, and the progress row says so. |
| Network | Wi-Fi only when `navigator.connection.type` reports it; if the type is cellular or unknown, ask once: "Use mobile data? About 640 MB." |
| Progress | One Briefing-page row: "Packing · 312 of 640 MB". Resumable after the app closes (Background Fetch where supported: `RA-P8-05`). Presigned links re-signed on 403. |
| Offline | Packed music, pages, tabs and reviews work; events queue in the outbox; messages show "Sends when you're back online". |
| Release | Packed files unused for 7 days are released, least-recently-used first; owner-pinned items never. |

**Acceptance.** Playwright with an offline context after a fixture pack: a packed track plays (stub audio), a packed page opens, 3 reviews complete, a message queues. Back online: the outbox flushes and review state syncs. A mocked `estimate()` proves the cap. A mocked cellular connection makes it ask first.

### 4.10 Off the record (ME2) [proposal]

The owner says "off the record", and until they say "back on the record" (or 2 hours pass, or the day rolls) the mind still reads and answers, but nothing from those messages becomes memory: no facts, no open threads, no search entries, no day-note content. The messages are deleted 7 days later. The first use explains this plainly, including what it can't promise (the messages still pass through the Claude session, as all chat does), and the owner's approval there (tap or own words) is the standing approval for those deletions. The `+` sheet is unchanged.

| Rule | Exact behaviour |
|---|---|
| On | Saying "off the record", or Settings → Privacy → Off the record now. First use only: an explanation card with **Turn on**: "I'll still read and answer these messages. They won't become memories, won't appear in search or day notes, and will be deleted in 7 days." |
| While on | Edge light shifts to a dimmer, cooler calm; one small Inter line above the ask bar: "Off the record · End". Messages stored with `record=0`. |
| Off | "Back on the record", **End**, 2 h without a message, or the day roll. |
| Exclusions (Worker-enforced) | No FTS rows. Facts and open threads citing a `record=0` message are refused (`422`, code `off_record_evidence`). Day and session notes may only say "Off the record: N messages". No embeddings. Later sessions' briefings omit these messages; the live session sees them (it must, to reply). |
| Deletion | 7 days after the mode ends, a chunked DO alarm job hard-deletes the `record=0` messages; the ledger keeps a content-free tombstone (count and time range). The first-use approval is the owner's approval for this `delete` class action. |
| Honest limits | Stated on the card: the messages pass through the Claude session like all chat; ledger rows for actions taken (e.g., a queued song) remain, with a generic why. |

**Acceptance.** Backend tests for each exclusion (FTS empty, `off_record_evidence` refusal, day note text, briefing omission). Fake clock: rows are gone on day 8 and a tombstone exists. Browser test: the line and the edge-light state appear and disappear with the mode.

---

## 5. Anti-features

Things that would make the Thunderhead worse, however good they look on a metrics dashboard. Each has a guard that keeps it out in code or evals. Article 16 of the [constitution](../mind/CONSTITUTION.md) ("never make the owner smaller") is the umbrella.

| # | Anti-feature | Why it makes things worse | Evidence | Guard |
|---|---|---|---|---|
| A1 | **Streaks and streak counters** | A broken streak makes people drop off rather than resume; the streak becomes the goal instead of the skill. | Silverman & Barasch, *J. Consumer Research* 49(6), 2023: intact logged streaks raise engagement, broken ones lower it, more so when people blame themselves. | GROW-1 copy lint ("streak", "days in a row", "don't break"); no consecutive-day counter in any schema. |
| A2 | **Badges, points, levels, confetti** | Expected tangible rewards undermine intrinsic motivation for interesting tasks. | Deci, Koestner & Ryan, *Psychological Bulletin* 125(6), 1999 (meta-analysis of 128 experiments). | No `xp`, `badge`, `level` fields; DE1 states real numbers only. |
| A3 | **Pull-back notifications** ("We miss you", "Come back") | Engagement bait; corrodes trust; manipulative goodbyes raise use but also the sense of being manipulated. | De Freitas et al., HBS working paper, 2025 (≈ 37–43 % of companion-app goodbyes manipulative). | Push requires a why tied to a waiting item; absence is never a trigger (BEHAVIOR push rules). |
| A4 | **Infinite feeds and autoplay-next** | Turns a tool into a time sink; Google Now lost its value when it drifted into a feed. | Thunderhead research §3 (Google Now, Pulse). | MD2: every list has an end; autoplay-next off by default. |
| A5 | **Unread counts and red dots** | Constant low-level pressure to check; predictable batches beat trickles. | Fitz et al., *Computers in Human Behavior*, 2019 (batching 3×/day improved well-being). | No numeric badges on Home, ring or app icons; the gold edge is the only "waiting" signal. |
| A6 | **Variable-reward surprises to drive opens** | Slot-machine design; opens go up, autonomy goes down. | Self-determination theory; Susser, Roessler & Nissenbaum 2019 ("hidden influence"). | Any delight item (DE*) must be deterministic from real events and carry a why. |
| A7 | **Companion performance** (missing the owner, loneliness, "I exist for you") | Heavy affective use correlates with loneliness and dependence. | MIT Media Lab & OpenAI, 2025 (981 people, 4 weeks; correlational). | LAW-7 evals; phrase lint for need/longing phrasing in `th say`. |
| A8 | **Flattery and praise inflation** | Sycophancy makes people less willing to repair conflicts while rating the AI higher. | Cheng et al., *Science* 2026; Sharma et al. 2023. | LAW-6 fixtures and phrase lint. |
| A9 | **Doing the learning for the owner** (auto-translate everything, finished answers in study) | Students with unrestricted AI did 17 % worse once it was removed. | Bastani et al., PNAS 2025. | ST1 hint ladder; LAW-5. |
| A10 | **Silent rearranging of what the owner placed** | Adaptive menus were not faster and users preferred control; predictability matters as much as accuracy. | Findlater & McGrenere 2004; Gajos et al. 2008. | AR1 states; pinned/owner-ordered lists are read-only to policies (backend test). |
| A11 | **Always-on capture** (ambient mic, camera, screen) | Total capture without a visible boundary reads as surveillance (Recall, the Friend pendant). | Thunderhead research §3; law 10. | No capture verb exists (LAW-10). |
| A12 | **Time-in-app as success** | Optimising minutes optimises against the owner's growth. | VISION "What success looks like"; METUX. | The meter has no time-in-app metric (EVALS). |
| A13 | **Guilt copy** ("You missed 3 days", "Are you sure you want to leave?") | Shame drives lapses, not returns; lapses are normal in self-tracking and should be designed for. | Epstein et al., UbiComp 2015/2016 (lapsing and resuming). | GROW-1 copy lint; ST4 plans without debt. |
| A14 | **Unexplained personalisation** | Influence the owner can't see is manipulation by definition. | Susser et al. 2019; Sunstein's publicity test. | LAW-3: the Worker rejects an empty why. |
| A15 | **Nagging** (a second unprompted reminder) | Pressure creates reactance; persuasion means notice, remind once, let go. | Law 4; psychological reactance (Brehm 1966, from memory). | `nudge_repeat` 409 (LAW-4). |
| A16 | **Confident, uncited summaries** | One confident falsehood in a trusted place costs more than many good summaries earn. | Apple's paused notification summaries (iOS 18.3). | Study answers drop uncited claims; odds on uncertain claims (LAW-2a). |
| A17 | **Mood or state inference from sensors** | Creepy recall; wrong guesses about feelings are worse than none. | Thunderhead research §2 (creepy recall). | No sensor-derived `state` facts; `state` facts only from owner words. |
| A18 | **Leaderboards and social comparison** | Replaces the owner's own goals with someone else's yardstick. | SDT (autonomy). | One user; no comparison surfaces exist. |
| A19 | **Daily "word of the day" pushes and similar content drips** | Notifications without a decision behind them; trains the owner to ignore the push channel. | Mehrotra et al., CHI 2016 (useful notifications still disrupt). | Push budget ≤ 2 a day, each tied to a waiting item. |
| A20 | **Engagement-tuned personality** ("Your Thunderhead is sad you skipped practice") | Anthropomorphic guilt is manipulation. | De Freitas 2025; article 16. | Phrase lint; LAW-6/7 fixtures. |

**Acceptance (for this list).** Each guard exists as a named test or eval in [EVALS.md](../mind/EVALS.md) or [TESTING.md](../engineering/TESTING.md) by the phase that ships the first feature it protects; a reviewer can trace each A-row to a test ID.

---

## 6. Considered and rejected

Bold ideas that fail a gate. Recorded so they aren't re-proposed without new evidence.

| Idea | Gate failed | Why |
|---|---|---|
| Ambient listening to learn context (always-on mic) | G6, law 10 | Eyes and ears only when switched on (owner ruling). |
| Mood detection from camera or voice | G6, law 10, A17 | Capture without a switch; creepy inference. |
| Location history for routines | G6 | Precise location is never logged; the platform has no need for it. |
| The mind replying to people on the owner's behalf | Ask-first `reach_people` | The mind has no outbound channel; PE3 drafts instead. |
| Chips or quick-reply suggestions on Home | G8 (owner ruling) | "No chips on home." Suggestions live on the Briefing page and inside apps. |
| A sixth `+` sheet item (e.g., "Off the record") | G8 (owner ruling) | The sheet's five items are fixed; ME2 is triggered by words or Settings. |
| A standing morning session that listens all day | G7, decisions (mind) | Spends plan usage with nobody talking; cut in decisions.md. |
| Fetching song lyrics for second-language practice | G6 (copyright, third party) | Lyrics are copyrighted; MU8 uses audio only. |
| Scoring spiritual habits or study "consistency" as a faith metric | Law 8 | The mind never judges matters of faith; study minutes are shown only as the owner's own study trend. |
| Public progress page / sharing achievements | G6, A18 | Public repo and site hold nothing personal. |
| Paid TTS voices (e.g., premium second-language voices beyond the free neurons) | G7 | Costs money; on-device voices first (SL3). |
| Workers Paid ($5/month) for more CPU | G7 | Only on an owner yes, if a free-tier limit is actually hit. |
| An LLM-written personality profile shown to the owner | G4 (drift) | The profile is a deterministic render of facts (decisions, mind). |

---

## 7. Where the ideas land

The phase map for the scored ideas. Top-10 items in bold.

| Phase | Ideas |
|---|---|
| P1 | AX1, AX2, AX4, RI3 |
| P2 | HM4, HM5, OF2, OF3, AX3, DE2, DE3, PE1 |
| P3 | **ME1**, **SL1**, **ST1 (chat ladder)**, **ME2**, HM2, AR5, AR8, ME3, ME4, ME7, ME9, SL2 (collect), SL3, SL6, PE2, PE3, PE4, RE1, RE4, RI2, DE4 |
| P4 | HM6, SY1, SY2, SY3, SY4, SY5 |
| P5 | **AR1**, AR2, AR3 (starts), HM1, MU1–MU5, MU7, TA1, OF4 |
| P6 | **LN1**, **GT1 + GT7**, GT2–GT6, GT8, ME6, MU6, DE1 |
| P7 | **ST1 (Study UI)**, ST2–ST6 |
| P8 | **OF1**, HM3, AR4, AR9, MU8, SL4, SL5, MD1–MD5, TA2–TA4, RI1 |
| P9 | **AR6**, **RE6**, AR7, LN2, LN3, RE2, RE3, RE5, DE5 |
| P9+ | ME5, ME8 |

**Acceptance.** Every ID in §3 appears in this table, and only ST1 appears twice (its chat ladder and its Study UI land in different phases). A script can check this by extracting IDs and expanding ranges such as MU1–MU5.

---

## 8. Open questions / tests

Each is tracked with its cheapest test in [RESEARCH-AGENDA.md](RESEARCH-AGENDA.md).

| Question | Gates | Agenda ID |
|---|---|---|
| Is a licence-clean second-language frequency list available for the gloss bands? | SL1 gloss bands | RA-P3-05 |
| Does the owner's phone have an offline second-language `speechSynthesis` voice? | SL3 | RA-P3-06 |
| Can a session read its own plan usage? | SY3, usage-aware night shift | RA-P2-07 |
| Does `ts-fsrs` 5.x run unmodified as a vendored ES module with no build step? | LN1 | RA-P6-06 |
| Do Background Fetch and Web Share Target work in the installed app on the owner's phone? | OF1, HM3 | RA-P8-04, RA-P8-05 |
| Real storage quota and `persist()` behaviour on the owner's phone | OF1 cap | RA-P5-08 |
| Quality of language tags from offline audio tagging on the owner's genres | MU8 | RA-P5-09 |
| Is the 80 % bootstrap interval the right verdict rule for n-of-1 at n = 7 per arm, or should it use a permutation test? | RE6 | RA-P9-04 |
| Do Bluetooth page-turner pedals send standard key events to Chrome on Android? | GT4 | RA-P6-07 |

---

## Sources

Read on 2026-10-28 unless marked. "(research notes)" means the source is cited in the scratchpad research reports that fed this suite and was not re-fetched tonight; "(from memory)" means a standard reference not re-fetched.

- Calm technology: Weiser & Brown, *Designing Calm Technology* (1996), https://calmtech.com/papers/designing-calm-technology.html; Amber Case's principles, https://calmtech.com/ (research notes).
- Litt, *Enough AI copilots! We need AI HUDs* (2025), https://geoffreylitt.com/2025/07/27/enough-ai-copilots-we-need-ai-huds (research notes).
- Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI 1999, https://erichorvitz.com/chi99horvitz.pdf (research notes).
- Iqbal & Bailey, CHI 2008, https://www.interruptions.net/literature/Iqbal-CHI08.pdf; Mehrotra et al., CHI 2016, https://discovery.ucl.ac.uk/id/eprint/1502364/; Fitz et al. 2019 (research notes).
- Findlater & McGrenere 2004, https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf; Gajos et al. 2008, https://kgajos.seas.harvard.edu/papers/kgajos-chi08-predictability.pdf (research notes).
- Duolingo Birdbrain, https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain (research notes).
- Bastani et al., PNAS 2025, https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html (research notes).
- Peters, Calvo & Ryan 2018 (METUX), https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5985470/ (research notes).
- Cepeda, Pashler, Vul, Wixted & Rohrer, *Distributed practice in verbal recall tasks*, Psychological Bulletin 132(3), 2006, https://pubmed.ncbi.nlm.nih.gov/16719566/.
- Karpicke & Roediger, *The critical importance of retrieval for learning*, Science 319, 2008 (from memory).
- FSRS: `ts-fsrs` on npm (v5.4.2, MIT, published 2026-09-01), https://www.npmjs.com/package/ts-fsrs; desired retention trade-off, https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention.
- Practice science: Ericsson, Krampe & Tesch-Römer 1993; Macnamara et al. 2014; Duke, Simmons & Cash 2009; Simmons & Duke 2006; Carter & Grahn 2016; Guadagnoli & Lee 2004; focal dystonia reviews (research notes, feasibility §4).
- Bjork, desirable difficulties, 1994 (from memory). Slamecka & Graf, the generation effect, JEP: Human Learning and Memory 4(6), 1978 (from memory).
- Krashen, *Principles and Practice in Second Language Acquisition*, 1982 (from memory). Lyster & Ranta, *Corrective feedback and learner uptake*, SSLA 19(1), 1997 (from memory).
- Gollwitzer & Sheeran, *Implementation intentions and goal achievement: a meta-analysis*, Advances in Experimental Social Psychology 38, 2006 (from memory).
- Li, Dey & Forlizzi, *A stage-based model of personal informatics systems*, CHI 2010 (from memory). Epstein, Ping, Fogarty & Munson, *A Lived Informatics Model of Personal Informatics*, UbiComp 2015, https://library.selfresearch.org/research/a-lived-informatics-model-of-personal-informatics/; Epstein et al., *Reconsidering the Device in the Drawer*, UbiComp 2016, https://homes.cs.washington.edu/~jfogarty/publications/ubicomp2016.pdf.
- Silverman & Barasch, *On or Off Track: How (Broken) Streaks Affect Consumer Decisions*, Journal of Consumer Research 49(6), 2023, https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions.
- Deci, Koestner & Ryan, Psychological Bulletin 125(6), 1999 (from memory).
- Kravitz & Duan (eds.), *Design and Implementation of N-of-1 Trials: A User's Guide*, AHRQ, 2014 (from memory).
- Sedikides & Wildschut, *Finding meaning in nostalgia*, Review of General Psychology, 2018 (from memory). Emmons & McCullough, JPSP 84(2), 2003 (from memory).
- Sycophancy and companions: Cheng et al., *Science* 2026 / arXiv 2510.01395; Sharma et al., arXiv 2310.13548; MIT Media Lab & OpenAI 2025; De Freitas (HBS) 2025; Susser, Roessler & Nissenbaum 2019 (research notes).
- Workers AI prices (MeloTTS 18.63 neurons/audio minute; Whisper large-v3-turbo 46.63/min; 10,000 free neurons/day), https://developers.cloudflare.com/workers-ai/platform/pricing/.
- n-of-1 detection rates: local simulation tonight (bootstrap, 400 runs per cell), numbers in §4.8.
