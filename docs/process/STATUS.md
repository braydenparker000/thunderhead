# Status

Where the project is right now. Every agent session reads this first and updates it before ending.
Keep it short: current phase, the next three tasks, what is blocked, what waits on the owner, the last deploy.

## Current phase

**P0 · Site live** — code ready, waiting on the owner's setup (repository, Azure storage account, trust, settings).

## Next three tasks

1. Push the prepared history to `main` as soon as the repository exists and the Claude app can reach it.
2. Run the first Deploy; confirm the live checks and one deliberate rollback.
3. Start P1: Worker skeleton with `Core` + `Auth`, health, CORS, deploy job; run measurements X1, X3, X4, X5.

## Blocked / waiting on the owner

- Setup steps in [SETUP.md](SETUP.md) (repository, Claude app access, storage account, role, federated credential, repository settings, scheduled task).
- Owner questions (see the morning summary): music privacy timing, old repo clean-up, the tiny R2 storage cost, usage credits OFF, phone navigation mode (3-button or gestures), which extra old pages to keep.

## Last deploy

None yet.

## Notes for the next session

- Hosting is the Azure Storage static website (owner ruling); Static Web Apps is ruled out.
- Read [decisions.md](decisions.md) before changing anything structural.
