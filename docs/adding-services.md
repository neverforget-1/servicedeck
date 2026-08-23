# Adding services and agents

Everything ServiceDeck can start, stop, probe, or display lives in `services.json` (created from `services.example.json` on first run, gitignored). Adding an entry never requires touching code — the manager engine interprets the registry.

## Service entry reference

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "nameZh": "我的工具",
  "section": "services",
  "group": "Developer Tools",
  "description": "One sentence about what this is.",
  "icon": "terminal",
  "accent": "#60a5fa",
  "kind": "process",
  "capabilities": ["start", "stop", "logs"],
  "common": false,
  "enabled": true,
  "url": "http://127.0.0.1:9000",
  "endpoint": "http://127.0.0.1:9000/v1",
  "port": 9000,
  "start": { },
  "health": { },
  "stop": { },
  "logs": ["my-tool.stdout.log", "my-tool.stderr.log"]
}
```

| Field | Meaning |
|---|---|
| `id` | `a-z0-9-`, unique. Used in action ids (`start-my-tool`) and status keys. |
| `section` | `services` (default) or `agents` (launch-only tab). |
| `kind` | `process` \| `docker-compose` \| `ssh-tunnel` \| `external`. See below. |
| `capabilities` | Subset of `start`, `stop`, `logs`. Controls both the UI buttons and what the API/engine accept. `external` entries typically declare `[]` or `["logs"]`. |
| `common` | Included in the `start-common` / `stop-common` bulk actions. |
| `enabled` | `false` disables the entry without deleting it (shows as "未启用", refuses to start). |
| `start` / `health` / `stop` / `logs` | Kind-specific blocks, documented below. |

`${ENVIRONMENT_VARIABLE}` placeholders are expanded in every path (plus `${SD_HOME}` = the deck root), so the registry you keep for yourself never hard-codes machine-specific absolute paths.

## kind: process

```json
"start": {
  "exe": "node",
  "args": ["-u", "server.py"],
  "cwd": "${MY_TOOL_HOME}",
  "readyTimeoutSec": 60
},
"health": { "type": "http", "url": "http://127.0.0.1:9000" },
"stop": {
  "matchCommandLine": "python.+server\\.py",
  "expectName": "python.exe"
}
```

- `exe` is resolved via PATH first, then used as an absolute path.
- stdout/stderr are redirected to `logs/<id>.stdout.log` / `<id>.stderr.log` (the names in `logs` must match these or point at files your service writes itself).
- If the exe is a Python program, include `-u` in `args` so redirected logs stream immediately instead of sitting in the block buffer.
- `health.type` is `http` (any 2xx–4xx counts as up) or `port` (a listener on that port counts as up). `readyTimeoutSec` bounds the start wait (default 60s — cold-starting runtimes like first-boot containers need more; be generous).
- `stop.matchCommandLine` is a case-insensitive regex matched against the full command line; `expectName` additionally pins the process image name. The engine kills **only** processes matching both, then verifies the service is actually down.

## kind: docker-compose

```json
"kind": "docker-compose",
"composeFiles": ["${MY_STACK_HOME}/docker-compose.yml"],
"envFile": "${MY_STACK_HOME}/.env",
"health": { "type": "http", "url": "http://127.0.0.1:8080/health", "readyTimeoutSec": 120 }
```

Start runs `docker compose -f ... [--env-file ...] up -d`; stop runs `compose stop` (containers stop, **volumes are preserved**). `composeFiles` accepts multiple files (merged like `docker compose -f a -f b`).

## kind: ssh-tunnel

```json
"kind": "ssh-tunnel",
"ssh": {
  "host": "user@example.com",
  "keyPath": "${USERPROFILE}/.ssh/id_ed25519",
  "localPort": 16080,
  "remoteHost": "127.0.0.1",
  "remotePort": 6080
},
"health": { "type": "port", "port": 16080, "readyTimeoutSec": 30 }
```

Runs `ssh -N -L localPort:remoteHost:remotePort` with BatchMode and keepalives. A stale tunnel process holding the port without forwarding is recycled automatically (matched by the exact forward spec in its command line).

## kind: external

Monitor-only: no `start`/`stop` blocks, usually `"capabilities": []`. The deck probes `health` (or `port`) and displays the card; management stays with whatever owns the service.

## Registering an agent (launch-only)

```json
{
  "id": "my-coding-agent",
  "name": "My Coding Agent",
  "section": "agents",
  "group": "Agents",
  "kind": "process",
  "capabilities": ["start"],
  "start": { "exe": "${AGENT_HOME}/agent.exe", "args": ["serve"], "cwd": "${AGENT_HOME}", "readyTimeoutSec": 90 },
  "health": { "type": "port", "port": 9113 },
  "stop": { "matchCommandLine": "agent\\.exe.+serve" },
  "logs": []
}
```

The contract: the Agents tab shows status and a start button — no stop, no logs, no other permissions. The engine and the API both refuse `stop-<id>` when the `stop` capability is absent, so a launch-only entry cannot be killed through the deck even with direct API access.

## Validating your changes

```powershell
node scripts/validate-manifest.mjs services.json
powershell -File manager/service-manager.ps1 -Action status-json
```

Then reload the dashboard (it reads the registry at startup) and exercise start / stop / status / logs for the new entry.

## Checklist for a good entry

1. `stop.matchCommandLine` matches **only** this service — test it while similar services run.
2. `readyTimeoutSec` covers the slowest realistic cold start (first boot, dependency install).
3. Log filenames in `logs` use `[A-Za-z0-9._-]` only (the API enforces this allowlist).
4. Never put credentials, cookies, or API keys in the registry, descriptions, or logs.
