# Glossary

The project's words, used the same way in every document, in code and in conversation.

| Term | Meaning |
|---|---|
| **Owner** | The one person the Thunderhead serves. |
| **The Thunderhead** | The whole system; in conversation, the mind's own name. |
| **The mind** | The reasoning part: Claude Code sessions on the owner's plan. See [mind/RUNTIME.md](../mind/RUNTIME.md). |
| **Session** | One running Claude Code conversation. Types: **chat** (answers the owner), **night** (consolidates memory and arranges tomorrow), **reflex** (later: handles a watchdog alarm). |
| **Wake** | The Worker starting a session through a scheduled-task API fire. The fire text is always the constant `wake`. |
| **Briefing (mind)** | The context a session loads at start: rules, waiting messages, open threads, today so far, yesterday, profile. Injected by a hook. |
| **Briefing (page)** | The swipe-right page on the phone: today at a glance. Distinct from the mind's briefing; say "the Briefing page" when it could be ambiguous. |
| **Home** | The single main screen: voice line, conversation, ask bar. |
| **Voice line** | The large italic line on Home in the Thunderhead's voice ("Nothing needs you."). |
| **Ring** | The circle of six app bubbles that opens when the owner holds still on an empty spot. Earlier documents call it the Compass. |
| **Ask bar** | The glass pill at the bottom of Home: `+`, text field, mic/send. |
| **`+` sheet** | The options sheet that folds up from the ask bar (Camera, Photos, Files, Voice memo, Remind me). |
| **Edge light** | The Thunderhead's presence: light along the screen edges. Calm, gold (decision waiting), pulse (thinking), bright (listening). |
| **Decision** | Something only the owner can decide, shown as a card on Home with a gold edge. Backed by a **proposal**. |
| **Proposal** | A Worker record of an ask-first action waiting for the owner's approval (a device tap or the owner's own words): classes `delete`, `money`, `access`, `reach_people`. |
| **Ask-first classes** | Deleting data or anything irreversible; spending money; security or access changes; reaching other people. Everything else runs under the autonomy rule. |
| **Autonomy rule** | Once the owner agrees on what to build, the agent builds, tests, merges, deploys and reports without further approval. |
| **Ledger** | The append-only record of everything the mind and the system did, each with a "why" and, where possible, an undo. |
| **Undo** | The inverse action stored with a ledger entry; one tap reverses it. |
| **Sense / event** | A small fact an app reports (`music.skip`, `guitar.practice`). Shape: `{id, at, type, ref, data, sensitivity}`. |
| **Verb** | An action the mind can trigger on the phone (`music.queue`). Every verb returns its own undo. |
| **Surface** | Content the mind prepared for an app slot (a margin note, an arranged list, a home line), shown instantly. |
| **Ref** | A string pointer to a thing: `music:<id>`, `music:playlist/<id>`, `podcast:<show>/<episode>`, `book:<id>#p212`, `verse:<book>/<chapter>/<verse>`, `thread:<id>`. |
| **Thread** | One conversation. A new one starts automatically each day ("daily thread"); older ones are **filed** and titled. |
| **Day roll** | The moment the daily thread is filed: 04:00 local, but only after 60 minutes with no messages. |
| **Day note** | The night shift's short summary of one day. |
| **Fact** | One remembered thing about the owner or the world, with kind, source (`user`/`observed`/`inferred`), confidence, evidence and validity dates. Earlier documents call these beliefs. |
| **Open thread** | A commitment or loose end the mind tracks across days ("finish the alzapúa exercise"). Not the same as a conversation thread. |
| **Profile** | A deterministic rendering of the strongest current facts, loaded every session. |
| **Taint** | The rule that text from outside the owner (web pages, song tags, other agents) can never become a fact or a rule. |
| **Night shift** | The nightly session: day note, titles, facts, open threads, tomorrow's arrangement. |
| **Muse** | A separate AI agent the owner already has. It uploads the owner's music and can take routine **work orders**; it writes no memory and no code. |
| **Daily Board / the Board** | Cut (owner, 2026-10-31). It was a daily news edition Muse wrote to the owner's brief, shown on the Briefing page. |
| **As-is port** | The first move for each existing app (Music, Guitar, Podcasts, Astra, My Media): copied unchanged, adjusted only so it runs on the new site. Later changes need the owner's yes. |
| **Work order** | A job for Muse or an edge model with a spec and a result schema the Worker validates. |
| **Worker** | The Cloudflare Worker `thunderhead-api`: the backend. |
| **Core / Auth** | The two Durable Objects in v1: Core holds conversation, ledger, memory; Auth holds sign-in. |
| **Presigned URL** | A short-lived R2 link for private media (audio, PDFs) so bytes never pass through the Worker. |
| **Stage** | `scripts/stage.mjs`: builds the release folder and enforces size budgets before a deploy. |
| **Galaxy A15** | The owner's phone of record; every budget and gesture test assumes it. |
| **[proposal]** | Marks an idea in these docs that is not decided yet. |
