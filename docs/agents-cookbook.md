# Agent registration cookbook

AI agent tools come in (at least) three runtime shapes. Each needs a
different registration recipe. All recipes were verified against real
installations on a real machine.

## Shape 1: CLI / TUI agents (claude, codex, omp, gemini-cli, ...)

Interactive terminal programs. They need a **terminal host** — the deck
cannot attach to their session, it can only spawn a window for them.

```json
{
  "id": "claude-code",
  "section": "agents",
  "kind": "process",
  "capabilities": ["start"],
  "start": {
    "exe": "wt.exe",
    "args": ["-d", "D:\\work", "cmd", "/k", "claude"],
    "window": "visible",
    "readyTimeoutSec": 30
  },
  "health": { "type": "process", "matchCommandLine": "claude-code", "expectName": "claude.exe" },
  "logs": []
}
```

Rules learned the hard way:

- **`wt.exe -d <dir> cmd /k <cli>`** is the standard wrapper: Windows
  Terminal (if installed) + `cmd /k` so the window *stays open* after the
  agent exits and you can read its final output. Use `cmd /c` if you prefer
  windows that close on exit — you lose the output. Without `wt.exe`,
  `cmd.exe /k ...` still works (plain console host).
- **`-d <dir>` sets the working directory** — for CLI agents the cwd *is*
  the project. One registry entry = one project; register the same CLI
  twice with different ids and cwds for different projects.
- **Verify the actual process shape before writing the probe.** Modern
  CLIs are increasingly *native binaries*: Claude Code today runs as
  `claude.exe` (not `node.exe` — the npm shim spawns the native binary and
  exits). Run the agent once, then:
  `Get-CimInstance Win32_Process | ? { $_.CommandLine -match '<name>' } | % { $_.Name + ' ' + $_.CommandLine }`
  and write `expectName` from what you *see*, not from what the installer
  suggests. A wrong `expectName` produces a probe that never turns green
  (or worse, matches a transient wrapper).
- **First run needs login.** Most agents require interactive auth on first
  launch. That happens inside the popped terminal — the deck cannot and
  should not automate it. Document it in the entry description.
- **One entry per agent, not per window.** Launching while already running
  is safe: the engine probes health first and skips if ready (see Shape 2
  for why this also matters for GUI apps).

## Shape 2: GUI agents (ZCode, ChatGPT/Claude desktop, IDEs-as-agents)

Electron/native apps with their own windows. No terminal host, no wrapper.

```json
{
  "id": "zcode",
  "section": "agents",
  "kind": "process",
  "capabilities": ["start"],
  "start": { "exe": "D:\\tools\\ZCode\\ZCode.exe", "args": [], "window": "visible", "readyTimeoutSec": 30 },
  "health": { "type": "process", "matchCommandLine": "ZCode\\\\ZCode\\.exe", "expectName": "ZCode.exe" },
  "logs": []
}
```

- Launch the **main exe directly** — never through `cmd`/`wt` (a console
  window would flash behind the GUI for no benefit).
- `cwd` is mostly irrelevant for GUI apps (they have their own project
  pickers); set it to something sensible anyway.
- **Single-instance semantics:** Electron apps typically grab a
  single-instance lock; a second launch just forwards to the running
  instance and exits immediately. The engine's probe-first-skip-if-ready
  behavior makes the start button a no-op when already running, which is
  exactly what you want. Without that, a second launch would race the
  health probe with a process that dies in ~1s.
- **Probe specificity:** GUI apps spawn many helper processes with the
  *same* image name (gpu, renderer, crashpad, plugin hosts). Include a
  path fragment in `matchCommandLine` (`ZCode\\\\ZCode\\.exe`) rather than
  just the exe name — `"ZCode"` alone would also match unrelated
  processes, and a bare exe name matches every helper (harmless for
  liveness, but noisier than needed).
- **Tray-resident apps** keep running after their window closes. The card
  stays green because the process is alive — correct, but occasionally
  surprising. Mention it in the entry description if the agent minimizes
  to tray.
- GUI agents must never get a `stop` capability from the deck:
  `taskkill /T /F` is a crash, not a shutdown — data loss risk. Their own
  UI owns shutdown. (If you ever add one, use graceful close semantics,
  not the engine's tree kill.)

## Shape 3: IDE-hosted agents (VS Code extensions — Continue, Cline, Claude Code for VS Code, ...)

The agent is **not a process of its own** — it lives inside an extension
host of an IDE. There is nothing to probe directly; the honest model is:
*launch the IDE with a workspace; probe the IDE process bound to that
workspace.*

```json
{
  "id": "vscode-claude",
  "name": "VS Code + Claude",
  "section": "agents",
  "kind": "process",
  "capabilities": ["start"],
  "start": {
    "exe": "D:\\ide\\Microsoft VS Code\\Code.exe",
    "args": ["D:\\work\\my-project"],
    "window": "visible",
    "readyTimeoutSec": 30
  },
  "health": { "type": "process", "matchCommandLine": "Code\\.exe.*my-project", "expectName": "Code.exe" },
  "logs": []
}
```

- Launch `Code.exe <workspace>` **directly** (the `code` CLI shim adds a
  console flash and nothing else). Same recipe works for Cursor / Windsurf
  / Trae forks — just their exe and workspace.
- **The probe anchors on the workspace path** in the IDE process command
  line. This gives you one card per (IDE, project) pair, which is the
  granularity users actually think in. Each project gets its own entry.
- **What "running" means here:** the IDE hosting the agent is up with that
  workspace open. Whether the extension is activated/idle you cannot see
  from outside — and shouldn't pretend to. Keep the description honest
  ("opens the workspace in VS Code with the Claude extension").
- VS Code reuses a running instance for new windows: if an IDE process is
  already up *without* your workspace, launching opens a new window in
  that instance; the probe still matches because the window's process
  command line carries the workspace path.

## Probe pattern checklist (all shapes)

1. Run the target once. Copy the **real** `Name` and `CommandLine` from
   `Get-CimInstance Win32_Process`.
2. Prefer a pattern with a **path fragment** (`omp\\bin\\omp\\.exe`,
   `Code\\.exe.*my-project`) over a bare word — bare words match unrelated
   processes (e.g. a pattern containing `Codex` will happily match every
   process whose command line mentions a `D:\Codex学习区\...` path).
3. Mind **substring collisions** between your agents (`zcode` does not
   contain `codex`, but `claude` contains... check your own names).
4. Escape backslashes twice in JSON (`\\\\` in the file → `\\` in the
   regex → `\` matched).
5. Regex order matters when you combine fragments:
   `Hermes-Runtime.*hermes_cli` matched, `hermes_cli.*Hermes-Runtime`
   didn't — command lines put the interpreter path *before* the module.
   Two anywhere-matches in the old manager were two separate `-match`
   calls; a single combined regex must respect the actual order.
6. Test the probe against: target running (expect ready), target stopped
   (expect stopped), *similar* agent running (expect stopped).

## What the deck deliberately does NOT do for agents

- **No watchdog.** Watchdog revives things that *were running and died* —
  for interactive agents that is exactly wrong: a terminal or window the
  user closed is not a crash, and resurrecting it would fight the user.
  Keep `"watchdog"` off every agents-section entry; it is for unattended
  background services only.
- **No stop** — agents own their sessions and lifecycles; force-killing a
  coding agent mid-task is how work gets lost. The engine and API both
  refuse `stop-<id>` for launch-only entries even under direct API calls.
- **No logs** — a TUI's "log" is its own screen; a GUI agent's state is in
  its windows. Redirecting their output would require owning their
  console, which contradicts visible-window launching.
- **No status beyond process liveness** — no token counts, no session
  state. Process-level truth only; anything deeper belongs to the agent's
  own UI.
