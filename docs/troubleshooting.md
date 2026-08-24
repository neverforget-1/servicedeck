# Troubleshooting manual

Symptom-first runbook. Every entry below was hit and verified on a real
machine during development — the "root cause" lines are autopsy results,
not theories.

## First-response toolkit

Run these before reading further; most incidents surface immediately:

```powershell
# What does the engine think, straight from the source of truth?
powershell -File manager\service-manager.ps1 -Action status-json

# What is actually running? (substitute your pattern)
Get-CimInstance Win32_Process | ? { $_.CommandLine -match '<agent-or-service>' } |
  % { "$($_.Name) PID $($_.ProcessId): $($_.CommandLine)" }

# What did the last deck operations do?
curl http://127.0.0.1:8777/api/operations

# Audit every health probe against the live process table
# (flags wrong expectName, dead probes, over-broad patterns)
powershell -File manager\service-manager.ps1 -Action probe-report

# Tail the manager's own log and any service log
Get-Content logs\manager.log -Tail 30
Get-Content logs\<service-id>.stderr.log -Tail 30
```

---

## 1. Operation stuck in "running" forever; later actions get 409

**Root cause:** services started by the manager inherit the manager's
stdio pipe handles (Windows handle inheritance). Node's `close` event on
the child waits for stream EOF — which never comes while the *service*
(alive for hours) holds the inherited write end. The manager itself
already exited; the completion signal was just wrong.

**Diagnosis:** process list shows no `powershell ... service-manager` —
the action process is gone, but `/api/operations` still shows `running`.

**Fix:** the server resolves on the child's **`exit`** event (not
`close`) and destroys the streams after 250ms. If you reintroduce this,
the symptom is the lock: exactly one operation at a time is enforced, so
one stuck operation bricks every subsequent action with 409.

## 2. Agent/service shows "running" that is not running (phantom ready)

**Root cause (two variants, both ours):**
- `return , $hits` / `Write-Output -NoEnumerate $hits` from a helper wraps
  an **empty** array into a one-item array → `.Count` is 1 → "alive".
- A `matchCommandLine` that matches *something else* (see #7).

**Diagnosis:** compare engine output vs. reality:
`Get-CimInstance Win32_Process | ? { $_.CommandLine -match '<pattern>' -and $_.Name -eq '<expectName>' }`
returns nothing, but `status-json` says `ready`.

**Fix:** helpers return arrays plainly; every call site collects with
`@(...)`. Never "fix" single-element flattening with a comma prefix — it
creates this bug for the empty case (we shipped both bugs in sequence).

## 3. Service with exactly one live process reports stopped

**Root cause:** mirror image of #2. Plain `return @($one)` gets unrolled
by the pipeline; the caller receives a bare object; `.Count` is `$null`
under PowerShell 5.1; `$null -gt 0` is false. Only bites when the hit
count is exactly 1 — which is the common case for agents.

**Diagnosis:** the process exists in `Get-CimInstance` output; engine
says stopped; adding a *second* instance of the service flips it to ready
(suspicious as hell when you notice it).

**Fix:** same contract — `@(...)` at every collection site.

## 4. `docker compose` (or any native tool) fails with a strange
PowerShell error under this engine

**Root cause:** PowerShell 5.1 converts native stderr lines into error
records when stderr is redirected (`& docker ... 2>&1`); with
`$ErrorActionPreference = 'Stop'` the first progress line on stderr
becomes a terminating exception. Docker writes ordinary progress to
stderr.

**Fix:** never call noisy native tools inline with `2>&1` under Stop.
Use `Start-Process -RedirectStandardOutput <file> -RedirectStandardError
<file> -Wait` and check `$proc.ExitCode` (that is what the engine's
compose paths do).

## 5. Redirected service logs stay empty (0 bytes) forever

**Root causes (stack them, we did):**
1. Launcher never redirects (service writes nowhere useful).
2. Python block-buffers stdout when redirected — output sits in an 8KB
   buffer.
3. A wrapper script sends the child's output to `DEVNULL` explicitly.

**Fix:** each layer needs its own piece: engine redirects per-service
logs; Python entries must include `-u` in `args`; wrapper scripts must
let output be inherited, not discarded. Verify with a fresh start and
immediate `Get-Content logs\<id>.stdout.log`.

## 6. Start fails: "did not become ready within N seconds" — but the
service is actually up a minute later

**Root cause:** readiness timeout shorter than real cold start. Real
cases from this machine: a container-backed API gateway took >60s
(docker engine wake + postgres healthcheck); a CLI-bridge service took
~90-120s cold. The failed-start path then **kills the just-started
service** (engine cleanup), which the user experiences as "the panel
keeps murdering my service".

**Fix:** set `readyTimeoutSec` to the *worst realistic* cold start, not
the warm one. 180s is a sane default for anything that touches docker or
compiles on first run. If a start timed out but you suspect the service
actually survived, re-check status before retrying (double-start is
guarded by the probe-first check).

## 7. Health probe never turns green (or matches the wrong thing)

**Root causes:**
- `expectName` written from assumption, not observation (Claude Code:
  npm-era knowledge said `node.exe`; the 2.x binary is a native
  `claude.exe`).
- Pattern order wrong when combining fragments: `hermes_cli...run.*Hermes-Runtime`
  never matched because the interpreter path (`...Hermes-Runtime\...`)
  comes *before* the module args. Combined single-regex fragments must
  respect command-line order.
- Pattern too broad: a fragment like `Codex` matches every command line
  containing a `D:\Codex学习区\...` path — i.e., half the machine.

**Fix:** see the probe checklist in [agents-cookbook.md](agents-cookbook.md).
Core rule: run the target once, copy the real process name and command
line, and test the pattern against running / stopped / lookalike states.

## 8. API returns 403 "only accepts requests from the local machine"

**Root cause:** none — that is the CSRF/DNS-rebinding guard doing its
job. Triggers: a foreign `Origin` header (request from a web page, not
your dashboard) or a `Host` header that is not `127.0.0.1[:port]` /
`localhost[:port]` (DNS rebinding attack, or you proxied the dashboard).

**Fix:** open `http://127.0.0.1:8777` directly. For remote access use an
SSH tunnel (which preserves localhost semantics) — do not change the
bind host.

## 9. `/api/logs/<id>` returns 403 or 404

**Root cause:** 403 = the entry has no `logs` capability
(agent-launch-only contract — by design). 404 = unknown id. Empty files
list = `logs: []` in the registry, or filenames failing the
`[A-Za-z0-9._-]+` allowlist.

## 10. Registry edits don't show up in the dashboard

**Fixed since v0.2.0:** `services.json` hot-reloads — the server watches the
file and swaps the registry on valid changes (invalid half-saved files keep
the previous registry running; check the server console for a "reload
rejected" line). `GET /api/meta` exposes `registryLoadedAt` so you can
verify the swap happened. **Bind host/port changes still require a
restart** — they are frozen at boot by design. The manager re-reads the
registry per action, so health checks always see the newest file even if
the server somehow did not reload.

## 11. Agent terminal window closes (or stays) immediately after launch

**Root causes:** `cmd /k` keeps the window after exit (chosen default:
you can read the agent's final output); `cmd /c` closes it. An agent that
dies instantly is usually first-run auth (it printed instructions you
could not read fast enough) — with `/k` they stay on screen; run the
agent once manually to complete login.

## 12. `git push` over HTTPS fails: "ServicePointManager 不支持具有 socks5
方案的代理" (or GCM auth loops)

**Root cause:** environment, not the deck: git's global `http.proxy` was
`socks5://127.0.0.1:7890`; Git Credential Manager is a .NET app and
.NET's ServicePointManager cannot use socks5 schemes, so every
credential flow dies before showing you anything.

**Fix:** point git at the same proxy over http (Clash-family mixed
ports accept both schemes):
`git config --global http.proxy http://127.0.0.1:7890` (+ `https.proxy`).
Then `git credential reject`/`approve` to cycle stored credentials.

## 13. Two identical buttons / duplicated form controls in a web UI you
are automating

Not a deck bug, recorded because it cost real time: modern web apps
render duplicate submit controls (in-form + sticky bar). When a click
"does nothing", snapshot first — the visible pair usually shares one
action, and a covering modal (`aria-modal` confirmation dialog) is often
the real reason a click timed out.

## 14. Service keeps restarting / card says "看护已熔断"

**Root cause:** watchdog is doing its job on a genuinely broken service.
The card shows `看护退避中（已试 N 次）` while backing off, and
`看护已熔断，请手动启动排查` after `maxAttempts` consecutive failures
(default 3). The circuit breaker exists so a crash-looping service cannot
monopolize the operation lock.

**Diagnosis:** read the service's own logs (`logs\<id>.stderr.log`) for
the crash reason; `GET /api/status` exposes per-entry
`watchdog: {attempts, gaveUp, nextRetryAt}`.

**Fix:** repair the service, start it manually (a manual start re-arms
and forgives the watchdog state), and confirm it stays ready past
`minUptimeSec`. Note the watchdog only revives entries that were ready
first — a service that was never up is never auto-started (that is
boot-autostart, not watchdog).

---

## Bug-class summary (the two Laws of PowerShell 5.1 arrays)

1. **Unroll law:** functions return arrays by unrolling them. Collect
   with `@(...)` everywhere; never call `.Count` on a raw call result
   (single hit → bare object → `$null.Count`).
2. **Wrapping law:** every "clever" way to defeat the unroll law
   (`return ,$x`, `Write-Output -NoEnumerate`) wraps *empty* arrays into
   one-item arrays. There is no local fix; the contract is plain return
   + `@()` collection.

Both laws were violated once each, in opposite directions, within an
hour. The engine now encodes the contract in comments; keep it that way.
