# ServiceDeck

**A zero-dependency, declarative control panel for local services, containers, and AI agent tools — Windows-first, localhost-only.**

ServiceDeck gives every program you run on your own machine one card on one page: live health status, start/stop with capability-scoped permissions, log tails, and a dedicated launch-only section for agent harnesses. Everything is driven by a single `services.json` registry — adding an entry never touches code.

```
git clone <this repo>
cd servicedeck
powershell -File .\start.ps1        # opens http://127.0.0.1:8777
```

On first start, ServiceDeck copies `services.example.json` to a private `services.json` (gitignored) with a working demo service so you can verify the full pipeline immediately.

---

## Why

Dev machines accumulate local infrastructure: an API gateway, a database container, a web workbench, three CLI agents... each with its own start script, its own logs folder, and its own way of answering "is it up?". ServiceDeck replaces that drawer of `.bat` files with one declarative manifest and one page.

Design principles:

- **Declarative.** A service is a JSON block — kind, start command, health probe, stop rules, capabilities, log files. The engine is generic.
- **Capability-scoped.** Every entry declares what the dashboard may do: `start`, `stop`, `logs`. Agent tools get a launch-only contract — display and start, nothing else.
- **Localhost-only.** The server binds `127.0.0.1`, rejects foreign `Origin`/`Host` headers, and only executes actions whitelisted in the registry (validated twice: in Node and in PowerShell).
- **Zero dependencies.** Node standard library + PowerShell + vanilla frontend. No `npm install`, no build step, works offline.

## The registry at a glance

```json
{
  "id": "my-agent",
  "name": "My Agent CLI",
  "section": "agents",
  "kind": "process",
  "capabilities": ["start"],
  "start": { "exe": "node", "args": ["agent.js"], "cwd": "${MY_AGENT_HOME}", "readyTimeoutSec": 60 },
  "health": { "type": "http", "url": "http://127.0.0.1:9112" },
  "stop": { "matchCommandLine": "node.+agent\\.js", "expectName": "node.exe" },
  "logs": ["my-agent.stdout.log", "my-agent.stderr.log"]
}
```

- `kind`: `process` | `docker-compose` | `ssh-tunnel` | `external` (status-only)
- `section`: `services` (default) or `agents` (the launch-only tab)
- `${ENV_VAR}` placeholders keep absolute paths out of the file you commit
- `stop.matchCommandLine` is how the engine attributes processes — it kills only what provably belongs to the entry, and refuses to touch unknown port owners

Full field reference: [docs/adding-services.md](docs/adding-services.md)

## The Agents tab

AI agent harnesses (coding agents, chat CLIs, automation runtimes) keep multiplying. ServiceDeck treats them as first-class citizens with a restricted contract: the deck may **show their status and start them — nothing else**. No stop button, no log access, no other permissions, because these tools manage their own lifecycles and may hold your sessions. Register an entry with `"section": "agents"` and `"capabilities": ["start"]` and it appears on its own tab.

Planned: a community catalog of ready-made registry snippets for popular harnesses (one JSON block per tool, drop-in).

## Security model

| Layer | Mechanism |
|---|---|
| Network | Binds `127.0.0.1` only; never exposed to LAN/WAN |
| Web | Rejects non-local `Host` (DNS rebinding) and foreign `Origin` (drive-by CSRF); strict CSP; no remote assets |
| Execution | Only registry-derived action ids run; validated in Node *and* re-validated in PowerShell; child processes spawned with literal argument lists, dynamic values passed via environment variables |
| Files | Static file serving is directory-contained; log reading is restricted to filenames declared in the registry |
| Processes | Stop logic attributes processes by command-line signature before killing; unknown owners are reported, never killed |

If you need remote access, tunnel it over SSH — do not change the bind host.

## Project layout

```
server.js                    # HTTP layer (Node stdlib only)
manager/service-manager.ps1  # generic lifecycle engine (interprets the registry)
services.example.json        # schema documentation by example; copied to services.json on first run
public/                      # vanilla frontend, local icons, offline-safe
docs/adding-services.md      # how to register a service / agent
scripts/validate-manifest.mjs# CI + local schema validation
start.ps1                    # start the dashboard
```

## Requirements

- Windows 10/11 with PowerShell 5.1+ (a Linux/macOS manager adapter is on the roadmap — the server and registry are already platform-neutral)
- Node.js 18+
- Docker (only if you register `docker-compose` entries)
- OpenSSH client (only if you register `ssh-tunnel` entries)

## Development

```powershell
node --check server.js
node --check public/app.js
node scripts/validate-manifest.mjs services.example.json
powershell -File manager/service-manager.ps1 -Action status-json
```

PRs welcome — see the roadmap below for good first issues.

## Roadmap

- [ ] Watchdog mode: auto-restart crashed services with backoff
- [ ] WebSocket live status (drop the 2.5s polling)
- [ ] Agent harness catalog: curated registry snippets for popular CLI agents
- [ ] Linux/macOS manager adapter (`sh` implementation of the same action contract)
- [ ] Per-service resource stats (CPU/RAM)
- [ ] Dependency ordering between entries (`dependsOn`)
- [ ] Optional token auth for tunneled remote access

## License

[MIT](LICENSE) — © The ServiceDeck Authors

---

# ServiceDeck（中文说明）

**零依赖、声明式的本地服务与 AI Agent 工具控制面板 —— Windows 优先，仅监听本机。**

给你机器上运行的每一个程序一张卡片：实时健康状态、按能力授权的启动/停止、日志查看，以及一个专为 Agent 工具设置的"仅展示与启动"分区。所有条目都由一份 `services.json` 清单驱动——加东西只改配置，不改代码。

```powershell
git clone <本仓库>
cd servicedeck
powershell -File .\start.ps1     # 自动打开 http://127.0.0.1:8777
```

首次启动会自动把 `services.example.json` 复制为私有的 `services.json`（已被 gitignore），并自带一个可运行的演示服务，方便你立刻验证整条启动/停止/健康检查链路。

**核心理念**：声明式登记（服务 = 一段 JSON）；能力级权限（每个条目声明 `start`/`stop`/`logs` 的子集，Agent 工具只有启动权）；仅本机（绑定 127.0.0.1、拦截跨站请求、动作双重白名单校验）；零依赖（Node 标准库 + PowerShell + 原生前端，离线可用）。

**Agent 分区**：把 coding agent、聊天 CLI、自动化运行时这类工具登记在 `agents` 分区，面板只提供状态展示和启动入口——没有停止按钮、没有日志权限，因为这些工具自己管理生命周期并持有你的会话。

**安全模型**：仅本机监听；Host/Origin 校验防 DNS 重绑定与 CSRF；严格 CSP；子进程参数全字面量、动态值走环境变量并在两侧校验；静态文件目录边界限制；日志文件名白名单；停止操作先按命令行签名归属进程、绝不误杀陌生进程。需要远程访问请走 SSH 隧道，不要改监听地址。

完整字段说明见 [docs/adding-services.md](docs/adding-services.md)。
