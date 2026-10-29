# Thunderhead documentation

The source of truth for what the Thunderhead does and how it is built. Specs describe exact
behavior; anything marked **[proposal]** is not decided yet. Fixed decisions live in
[process/decisions.md](process/decisions.md) and win over any other page.

## Start here

| If you are… | Read |
|---|---|
| New to the project | [product/VISION.md](product/VISION.md) → [product/GLOSSARY.md](product/GLOSSARY.md) → [process/decisions.md](process/decisions.md) |
| An agent picking up work | [process/STATUS.md](process/STATUS.md) → [process/decisions.md](process/decisions.md) → the spec for your task |
| The owner setting things up | [process/SETUP.md](process/SETUP.md) |

## Product

- [VISION.md](product/VISION.md): the idea, the laws, what success looks like
- [GLOSSARY.md](product/GLOSSARY.md): the project's words
- [HOME.md](product/HOME.md): the home screen, exactly
- [BRIEFING.md](product/BRIEFING.md): the swipe-right page
- [MENU-AND-SETTINGS.md](product/MENU-AND-SETTINGS.md): the swipe-left menu and every setting
- [SIGN-IN.md](product/SIGN-IN.md): setup, sign-in, devices, recovery
- Apps: [MUSIC](product/apps/MUSIC.md) · [GUITAR](product/apps/GUITAR.md) · [PODCASTS](product/apps/PODCASTS.md) · [STUDY](product/apps/STUDY.md) · [ASTRA](product/apps/ASTRA.md) · [MY-MEDIA](product/apps/MY-MEDIA.md)

## Design

- [DESIGN-SYSTEM.md](design/DESIGN-SYSTEM.md): tokens, type, motion, components
- [GESTURES.md](design/GESTURES.md): hold, swipe, ring, back
- [COPY.md](design/COPY.md): how the Thunderhead speaks, and every fixed string

## The mind

- [CONSTITUTION.md](mind/CONSTITUTION.md): the laws, loaded every session
- [BEHAVIOR.md](mind/BEHAVIOR.md): when and how it speaks and acts
- [RUNTIME.md](mind/RUNTIME.md): sessions, wake loop, the `th` CLI, hooks
- [MEMORY.md](mind/MEMORY.md): what it remembers and how
- [EVALS.md](mind/EVALS.md): the meter and the tests of its behavior
- [MUSE.md](mind/MUSE.md): the worker agent and work orders

## Engineering

- [ARCHITECTURE.md](engineering/ARCHITECTURE.md) · [DATA.md](engineering/DATA.md) · [API.md](engineering/API.md)
- [SECURITY.md](engineering/SECURITY.md) · [PRIVACY.md](engineering/PRIVACY.md)
- [OPERATIONS.md](engineering/OPERATIONS.md) · [TESTING.md](engineering/TESTING.md) · [PERFORMANCE.md](engineering/PERFORMANCE.md) · [JOBS.md](engineering/JOBS.md)
- [EXTENDING.md](engineering/EXTENDING.md): how to add a route, table, verb, surface kind, search source or app · [CONTRACT.md](engineering/CONTRACT.md): the generated contract appendix
- [MIGRATION.md](engineering/MIGRATION.md): moving from the old system

## Process

- [STATUS.md](process/STATUS.md): where things stand now
- [ROADMAP.md](process/ROADMAP.md): phases and "done when"
- [decisions.md](process/decisions.md): fixed decisions, newest last
- [SETUP.md](process/SETUP.md): the owner's one-time setup
- [RESEARCH-AGENDA.md](process/RESEARCH-AGENDA.md): open questions and how to settle them
- [IDEAS.md](process/IDEAS.md): evaluated feature backlog
