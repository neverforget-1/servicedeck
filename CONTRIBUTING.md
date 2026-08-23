# Contributing to ServiceDeck

Thanks for considering a contribution. This project is deliberately small
and dependency-free — the bar for keeping it that way is described below.

## Start here

1. Read [AGENTS.md](AGENTS.md). It is written for AI assistants but it is
   the most complete description of how to work on this codebase — the
   golden rule, the security invariants, the dev loop, and the Windows
   pitfalls. Human or AI, you will save an hour by reading it first.
2. Skim [docs/troubleshooting.md](docs/troubleshooting.md) — several
   entries are "why the code looks weird here" notes.

## Setup

```powershell
git clone <your fork>
cd servicedeck
node --check server.js          # no npm install — stdlib only, by design
powershell -File .\start.ps1    # first run bootstraps services.json from the example
```

Windows 10/11 + PowerShell 5.1 + Node 18+ is the reference environment.
PowerShell 7 compatibility is welcome but 5.1 is the floor — do not use
`&&`, ternaries, or `?.` in the manager.

## What makes a good contribution

- **Registry-driven, not code-driven.** New capability that applies to
  many services → a schema field the engine interprets. One-off service
  logic → belongs in that user's private `services.json` (via a wrapper
  script if needed), not in the repo.
- **Zero runtime dependencies.** Anything that needs `npm install` needs
  an extraordinary justification.
- **Security invariants are load-bearing** (AGENTS.md §"Security
  invariants"). A PR that weakens localhost binding, Host/Origin
  checking, literal spawn arguments, or file-serving tables will not be
  merged, even if a feature seems to need it.
- **Probe changes must be observation-based.** If you touch process
  matching, run
  `powershell -File manager\service-manager.ps1 -Action probe-report`
  against a live machine and include the output in the PR.

## Before you open a PR

- [ ] `node --check` passes on every touched JS file
- [ ] `node scripts/validate-manifest.mjs services.example.json` passes
- [ ] The lifecycle + negative test loop in AGENTS.md §"Dev loop" passes
      (start/stop demo entry, foreign-Origin 403, launch-only 404/403)
- [ ] Registry schema changes update `scripts/validate-manifest.mjs` AND
      `docs/adding-services.md` in the same PR
- [ ] No absolute paths, IPs, usernames, or secrets in committed files
- [ ] CI (windows-latest) is green on your fork

## Reporting issues

Include: the entry's JSON (redact personal paths), the output of
`status-json` and `probe-report`, and what you expected vs. saw. The
troubleshooting manual covers the common causes — mention which entries
you already ruled out.

## License

By contributing you agree your contributions are MIT-licensed, like the
rest of the project.
