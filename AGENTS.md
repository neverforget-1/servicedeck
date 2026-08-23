# AGENTS.md — Operating manual for AI assistants

You are working on **ServiceDeck**, a zero-dependency Windows-first dashboard
for managing local services, containers, and AI agent tools. This file tells
you everything you need to contribute safely. Human language: English (the
README has a Chinese section; user-facing strings in `public/` are zh-CN).

## The one golden rule

**Services are data, not code.** A service is an entry in `services.json`
(kind + start + health + stop + capabilities + logs). The PowerShell engine
(`manager/service-manager.ps1`) interprets the registry and contains zero
knowledge of any concrete service. Never add per-service code to the engine —
if you find yourself writing `Start-MyTool`, you are doing it wrong: extend
the registry schema instead, or fix the entry's JSON.

## Repo map

| File | Role |
|---|---|
| `server.js` | HTTP layer. Node stdlib only, no npm deps, Node >= 18. |
| `manager/service-manager.ps1` | Lifecycle engine (PowerShell 5.1 compatible). |
| `services.example.json` | Schema documentation by example; copied to `services.json` on first boot. |
| `services.json` | The user's private registry. **Gitignored — never commit, never read secrets from it.** |
| `public/` | Vanilla frontend (no build, no remote assets, offline-safe). |
| `scripts/validate-manifest.mjs` | Registry schema validator (CI + local). |
| `docs/adding-services.md` | Field reference; keep in sync with the validator. |
| `docs/agents-cookbook.md` | Agent recipes (CLI/TUI, GUI, IDE-hosted) + probe checklist. |
| `docs/troubleshooting.md` | Symptom-first runbook; read it BEFORE debugging anything. |
| `start.ps1` | Human launcher (idempotent, opens browser). |

## Security invariants — weakening any of these blocks the change

1. **Localhost-only.** Server binds `127.0.0.1`. Never change the bind host.
2. **Host/Origin checking.** `requestIsLocal()` rejects non-local Host
   (DNS rebinding) and foreign Origin (drive-by CSRF). All API routes sit
   behind it.
3. **Whitelisted actions.** The only executable actions are `start-<id>` /
   `stop-<id>` derived from declared `capabilities`, plus `start/stop-common`.
   The action id is validated three times: Node whitelist → regex guard at
   spawn → PowerShell re-validation of `DECK_ACTION`.
4. **Literal spawn arguments.** `MANAGER_ARGS` and `KILL_ARGS` are compile-time
   constants. Dynamic values (action id, kill pid) travel via environment
   variables (`DECK_ACTION`, `DECK_KILL_PID`), never via argv. Keep it that way.
5. **Table-driven file serving.** Request paths are exact-match lookup keys in
   `STATIC_ROUTES` / `DOC_ROUTES`; filesystem paths come only from table
   values (constants). Never reintroduce `path.join`/`path.resolve` with
   request-derived input — that is a path-traversal finding.
6. **Log filename allowlist.** `tailFile()` accepts bare names matching
   `/^[A-Za-z0-9._-]+$/` and only names declared in the registry's `logs`.
7. **Process attribution before killing.** Stop logic matches command-line
   signatures (`stop.matchCommandLine` + `expectName`); unknown owners are
   reported, never killed. If a service is still healthy after a stop pass,
   that is a failure, not a success.

## Privacy invariants

Committed files must never contain absolute personal paths, IPs, usernames,
keys, or machine-specific values. Use `${ENV_VAR}` placeholders in registry
examples. `services.json`, `logs/`, and scanner artifacts are gitignored.

## Dev loop

```powershell
node --check server.js; node --check public/app.js       # syntax
node scripts/validate-manifest.mjs services.example.json # schema
$env:SERVICEDECK_PORT = '8791'; node server.js           # boot on a test port
curl http://127.0.0.1:8791/api/health                    # expect {"ok":true,...}
powershell -File manager\service-manager.ps1 -Action probe-report  # audit every health probe
```

The registry hot-reloads: editing `services.json` swaps the server's view
within ~300ms (invalid files keep the previous registry; watch the server
console). Bind host/port still freeze at boot.

Full lifecycle test (run before claiming anything works):

1. `POST /api/actions/start-demo-api` → poll `GET /api/operations/<id>` →
   expect `succeeded` within ~5s, then `GET http://127.0.0.1:9111/` → 200.
2. `POST /api/actions/stop-demo-api` → expect `succeeded`, port 9111 dead.
3. Negative checks: `Origin: http://evil.com` on `/api/meta` → 403;
   `Host: evil.com` → 403; `POST /api/actions/stop-example-agent` → 404
   (launch-only entries cannot be stopped); `GET /api/logs/example-agent` → 403.
4. Kill leftover test servers when done (match `node.exe` command lines, not
   by port alone).

CI (`.github/workflows/ci.yml`) runs the same checks on `windows-latest`.

## Hard-won Windows lessons — read before touching process/spawn code

- **Grandchild pipe inheritance.** Services started by the manager inherit
  the manager's stdio pipe handles. Node's `close` event (which waits for
  stream EOF) then never fires while the service lives. That is why
  `runManager()` resolves on the **`exit`** event and destroys the streams
  after 250ms. Do not "simplify" this back to `close`.
- **PowerShell 5.1 turns native stderr into terminating errors** when
  `$ErrorActionPreference = 'Stop'` and stderr is redirected into the stream
  (e.g. `& docker ... 2>&1`). This is why compose/docker calls use
  `Start-Process -RedirectStandardOutput/-RedirectStandardError` to files
  instead of `& exe 2>&1`.
- **Python block-buffering.** Registry entries launching Python must include
  `-u` in `args`, or redirected logs stay empty until the buffer flushes.
- **Cold starts are slow.** `readyTimeoutSec` should cover the worst realistic
  first boot (containers, dependency installs). Default 60s is often not
  enough; the example uses generous values on purpose.
- **Array-return contract.** PowerShell unrolls arrays returned from
  functions: a single hit comes back as a bare object (`.Count` is `$null`
  under PS 5.1) — so ALWAYS collect helper results with `@(...)`, never call
  `.Count` directly on the call. And do NOT "fix" this with a comma prefix
  or `Write-Output -NoEnumerate`: both wrap EMPTY arrays into a one-item
  array, making zero hits look like one. Plain `return $hits` + `@()` at
  every call site is the only combination correct in both directions
  (cost: two subtle bugs during v0.1 development).
- **UTF-8 output.** `status-json` must print pure JSON on stdout: the engine
  silences human chatter in machine mode; keep `Write-Host` calls behind the
  machine-mode guard.

## Registry schema (v2) — quick reference

```
id            ^[a-z0-9][a-z0-9-]{0,63}$, unique
section       "services" (default) | "agents"        (agents = launch-only tab)
kind          process | docker-compose | ssh-tunnel | external
capabilities  subset of start, stop, logs            (external: usually [])
common        included in start-common / stop-common
enabled       false disables the entry without deleting it
start         { exe, args[], cwd, readyTimeoutSec }            (process)
health        { type: http|port, url|port, readyTimeoutSec }
stop          { matchCommandLine, expectName }      (compose/tunnel: not needed)
ssh           { host, keyPath, localPort, remoteHost, remotePort }  (tunnel)
composeFiles  [] + optional envFile                             (compose)
logs          [bare filenames, ^[A-Za-z0-9._-]+$]
```

`${ENV_VAR}` placeholders are expanded in every path field (`${SD_HOME}` =
deck root). Agents section entries: `"capabilities": ["start"]` only — the
engine and API refuse stop/logs even under direct API access.

## Checklist before you commit

- [ ] `node --check` on every touched JS file
- [ ] `node scripts/validate-manifest.mjs services.example.json` passes
- [ ] Lifecycle + negative test loop above passes on a test port
- [ ] No new npm dependencies (the project is stdlib-only by design)
- [ ] No absolute paths / IPs / usernames / secrets in committed files
- [ ] `docs/adding-services.md` updated if the schema changed
- [ ] PowerShell stays 5.1-compatible (no `&&`, no ternary, no `?.`)
