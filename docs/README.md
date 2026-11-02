# Thunderhead documentation

The map of what the docs hold. [AGENTS.md](../AGENTS.md) is the one page of rules and wins over
everything here; the plan is [process/PLAN.md](process/PLAN.md) and where things stand is
[process/STATUS.md](process/STATUS.md). Everything else is reference: specs describe exact behaviour,
anything marked **[proposal]** is not decided yet, and a "Not built" heading at the end of a page
lists what was specified but not made. Fixed decisions live in [process/decisions.md](process/decisions.md)
and win over any other page here. Historical pages are in [archive/](archive/README.md).

## Start here

| If you are… | Read |
|---|---|
| New to the project | [product/VISION.md](product/VISION.md) → [product/GLOSSARY.md](product/GLOSSARY.md) → [process/decisions.md](process/decisions.md) |
| An agent picking up work | [AGENTS.md](../AGENTS.md) → [process/STATUS.md](process/STATUS.md) → [process/PLAN.md](process/PLAN.md) → the spec for your task |
| The owner setting things up | [process/SETUP.md](process/SETUP.md) |

## Product

- [VISION.md](product/VISION.md): the idea, the laws, what success looks like.
- [GLOSSARY.md](product/GLOSSARY.md): the project's words.
- [HOME.md](product/HOME.md): the home screen, exactly.
- [BRIEFING.md](product/BRIEFING.md): the swipe-right page.
- [MENU-AND-SETTINGS.md](product/MENU-AND-SETTINGS.md): the swipe-left menu and every setting.
- [SIGN-IN.md](product/SIGN-IN.md): setup, sign-in, devices, recovery.
- [apps/MUSIC.md](product/apps/MUSIC.md): the Music app.
- [apps/GUITAR.md](product/apps/GUITAR.md): the Guitar app.
- [apps/PODCASTS.md](product/apps/PODCASTS.md): the Podcasts app.
- [apps/STUDY.md](product/apps/STUDY.md): the Study app.
- [apps/ASTRA.md](product/apps/ASTRA.md): the Astra app.
- [apps/MY-MEDIA.md](product/apps/MY-MEDIA.md): the My Media app.

## Design

- [DESIGN-SYSTEM.md](design/DESIGN-SYSTEM.md): tokens, type, motion, components.
- [GESTURES.md](design/GESTURES.md): hold, swipe, ring, back.
- [COPY.md](design/COPY.md): how the Thunderhead speaks, and every fixed string.

## The mind

- [CONSTITUTION.md](mind/CONSTITUTION.md): the laws, loaded every session, and how each is enforced.
- [BEHAVIOR.md](mind/BEHAVIOR.md): when and how it speaks and acts.
- [RUNTIME.md](mind/RUNTIME.md): sessions, the wake loop, the `th` CLI, hooks, shipping code.
- [MEMORY.md](mind/MEMORY.md): what it remembers and how.
- [EVALS.md](mind/EVALS.md): the injection fixtures, `th eval`, and the meter.

## Engineering

- [ARCHITECTURE.md](engineering/ARCHITECTURE.md): the parts, their boundaries, the repository layout.
- [DATA.md](engineering/DATA.md): every table and stored shape.
- [API.md](engineering/API.md): the Worker's routes, exactly.
- [CONTRACT.md](engineering/CONTRACT.md): the generated contract appendix (do not edit by hand).
- [EXTENDING.md](engineering/EXTENDING.md): how to add a route, table, verb, surface kind, search source or app.
- [SECURITY.md](engineering/SECURITY.md): keys, sign-in, threats and their answers.
- [PRIVACY.md](engineering/PRIVACY.md): what is stored where, and what never leaves.
- [OPERATIONS.md](engineering/OPERATIONS.md): deploys, watchdogs, backups, running it.
- [TESTING.md](engineering/TESTING.md): the test layers and CI.
- [PERFORMANCE.md](engineering/PERFORMANCE.md): budgets for the site and the Worker.
- [JOBS.md](engineering/JOBS.md): heavy work in Actions and chunked jobs.
- [MIGRATION.md](engineering/MIGRATION.md): retiring the old Worker.

## Process

- [PLAN.md](process/PLAN.md): what the owner wants and how to get there.
- [STATUS.md](process/STATUS.md): where things stand now.
- [decisions.md](process/decisions.md): fixed decisions, newest last.
- [SETUP.md](process/SETUP.md): the owner's one-time setup steps.

## Archive

Historical; superseded on 2026-11-02; kept for the record. Not rules, not plans.

- [archive/README.md](archive/README.md): what is here and why.
- [archive/IDEAS.md](archive/IDEAS.md): the evaluated feature backlog.
- [archive/RESEARCH-AGENDA.md](archive/RESEARCH-AGENDA.md): the open questions per phase (`RA-*` ids).
- [archive/ROADMAP.md](archive/ROADMAP.md): phases P0 to P10, replaced by PLAN.md.
- [archive/NEXT-BATCH.md](archive/NEXT-BATCH.md): the nine-part batch of 2026-10-31.
- [archive/MUSE.md](archive/MUSE.md): Muse and its work orders.
- [archive/MUSE-UPLOADS.md](archive/MUSE-UPLOADS.md): moving Muse's music uploads to the new Worker.
- [archive/MEASUREMENTS.md](archive/MEASUREMENTS.md): P1's measurements.
- [archive/MIGRATION.md](archive/MIGRATION.md): the migration spec, all but the old Worker's retirement.
- [archive/STATUS-2026-10.md](archive/STATUS-2026-10.md): October's status page and the whole deploy log.
- [archive/EVALS-aspirational.md](archive/EVALS-aspirational.md): the evals specified but not built.
