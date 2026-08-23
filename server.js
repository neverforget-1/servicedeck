'use strict';

/*
 * ServiceDeck — zero-dependency local dashboard server (Node >= 18).
 *
 * Security model:
 *  - Listens on 127.0.0.1 only (never exposed to the network).
 *  - Rejects requests whose Host header is not localhost, and any request
 *    carrying a foreign Origin header (blocks drive-by CSRF from web pages).
 *  - Child processes are only ever spawned with literal argument lists;
 *    dynamic values (action id, pid to kill) travel through environment
 *    variables that the child re-validates before use.
 *  - Only executes manager actions derived from the registry and permitted
 *    by each service's declared capabilities.
 *  - File serving is table-driven: request paths are lookup keys only, and
 *    every filesystem path is a string literal or a boot-time constant.
 *    The process chdir()s to its own directory at startup so no path
 *    assembly is needed anywhere.
 */

const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

// Anchor every relative path below to this file's directory, regardless of
// where node was invoked from. After this, all paths in the file are plain
// literals ('public/...', 'logs/...', ...) — no path joining at runtime.
process.chdir(__dirname);

const MANIFEST_FILE = 'services.json';
const EXAMPLE_FILE = 'services.example.json';
const LOG_DIR = 'logs';
const DOC_DIR = 'docs';

// First-run bootstrap: derive a private registry from the shipped example.
if (!fs.existsSync(MANIFEST_FILE) && fs.existsSync(EXAMPLE_FILE)) {
  fs.copyFileSync(EXAMPLE_FILE, MANIFEST_FILE);
  console.log('[deck] No services.json found — created one from services.example.json.');
  console.log('[deck] Edit services.json to register your own services (it is gitignored).');
}

// Build the registry view (manifest + service map + derived action map).
// Extracted so the dashboard can hot-reload services.json; boot-time
// settings (bind host, port) intentionally stay frozen from first load.
function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  if (!raw || !Array.isArray(raw.services)) {
    throw new Error('services.json is invalid: expected a top-level "services" array.');
  }
  const svcs = new Map();
  for (const service of raw.services) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(service.id || ''))) {
      throw new Error(`Invalid service id in registry: ${JSON.stringify(service.id)}`);
    }
    if (svcs.has(service.id)) {
      throw new Error(`Duplicate service id in registry: ${service.id}`);
    }
    svcs.set(service.id, service);
  }
  const acts = new Map();
  for (const service of raw.services) {
    const caps = new Set(service.capabilities || []);
    if (caps.has('start')) {
      acts.set(`start-${service.id}`, { id: `start-${service.id}`, label: `Start ${service.name || service.id}`, kind: 'start' });
    }
    if (caps.has('stop')) {
      acts.set(`stop-${service.id}`, { id: `stop-${service.id}`, label: `Stop ${service.name || service.id}`, kind: 'stop' });
    }
  }
  const anyStart = raw.services.some((s) => s.common && (s.capabilities || []).includes('start'));
  const anyStop = raw.services.some((s) => s.common && (s.capabilities || []).includes('stop'));
  if (anyStart) acts.set('start-common', { id: 'start-common', label: 'Start common services', kind: 'start' });
  if (anyStop) acts.set('stop-common', { id: 'stop-common', label: 'Stop common services', kind: 'stop' });
  return { manifest: raw, services: svcs, actions: acts };
}

let registry = loadRegistry();
const registryLoadedAt = () => registryLoadedAtValue;
let registryLoadedAtValue = new Date().toISOString();

// Hot reload: swap the registry when services.json changes on disk. A file
// that fails validation keeps the previous registry running — a half-saved
// edit must never take the dashboard down. (Editors that write via rename
// can drop the watch; re-establish it on error.)
function watchRegistry() {
  let timer = null;
  try {
    fs.watch(MANIFEST_FILE, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const next = loadRegistry();
          registry = next;
          registryLoadedAtValue = new Date().toISOString();
          statusCacheAt = 0;
          console.log(`[deck] registry reloaded: ${next.services.size} services.`);
        } catch (error) {
          console.warn(`[deck] registry reload rejected (${error.message}); keeping previous registry.`);
        }
      }, 300);
    });
  } catch {
    /* watcher establishment failure is non-fatal */
  }
}
watchRegistry();

const HOST = registry.manifest.dashboard?.host || '127.0.0.1';
const PORT = Number(process.env.SERVICEDECK_PORT || registry.manifest.dashboard?.port || 8777);
const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`,
  '127.0.0.1', 'localhost', '[::1]',
]);
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`,
]);
const ACTION_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const LOG_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// Literal spawn argument lists. No request-derived value ever appears here;
// the manager receives the action id and kill pid via environment variables
// and validates them itself (see manager/service-manager.ps1).
const MANAGER_ARGS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'manager/service-manager.ps1'];
const KILL_ARGS = [
  '-NoProfile',
  '-Command',
  '$p = [int]($env:DECK_KILL_PID -as [int]); if ($p -gt 0) { & taskkill.exe /PID $p /T /F | Out-Null }',
];

// File-serving tables: request paths are exact-match lookup KEYS only; the
// table VALUES are compile-time/boot-time filename constants, so no
// request-derived string ever reaches a filesystem path.
const STATIC_ROUTES = new Map([
  ['/', 'public/index.html'],
  ['/index.html', 'public/index.html'],
  ['/app.js', 'public/app.js'],
  ['/styles.css', 'public/styles.css'],
]);
const DOC_ROUTES = new Map();
if (fs.existsSync(DOC_DIR)) {
  for (const name of fs.readdirSync(DOC_DIR)) {
    if (name.endsWith('.md')) DOC_ROUTES.set(`/docs/${name}`, `${DOC_DIR}/${name}`);
  }
}

const operations = new Map();
let activeOperation = null;
let statusCache = null;
let statusCacheAt = 0;
let statusInFlight = null;
const serverStartedAt = new Date().toISOString();

fs.mkdirSync(LOG_DIR, { recursive: true });

function trimOutput(value, limit = 24000) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(-limit)}\n[output truncated]` : text;
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function writeText(response, statusCode, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  const text = String(body);
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  response.end(text);
}

function fail(response, statusCode, message, details = undefined) {
  writeJson(response, statusCode, details ? { error: message, details } : { error: message });
}

// Reject DNS-rebinding (bad Host) and cross-site requests (foreign Origin).
// Browsers always set Host to the request target and send Origin on
// cross-origin POSTs, so neither header can be forged from a web page.
function requestIsLocal(request) {
  const host = String(request.headers.host || '').toLowerCase();
  if (host && !ALLOWED_HOSTS.has(host)) return false;
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(String(origin).toLowerCase())) return false;
  return true;
}

function operationView(operation) {
  return {
    id: operation.id,
    action: operation.action,
    label: operation.label,
    status: operation.status,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt || null,
    code: operation.code ?? null,
    output: trimOutput(operation.output),
    error: operation.error || null,
  };
}

function killProcessTree(pid) {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return;
  try {
    spawn('powershell.exe', KILL_ARGS, {
      cwd: '.',
      windowsHide: true,
      env: { ...process.env, DECK_KILL_PID: String(numeric) },
    });
  } catch {
    /* best effort */
  }
}

function runManager(action) {
  // Boundary guard: action ids are whitelist-derived from the registry, but
  // enforce the shape here too so nothing can smuggle an option past the
  // literal argument list (the manager re-validates DECK_ACTION as well).
  if (!ACTION_ID_PATTERN.test(String(action))) {
    return Promise.resolve({ code: 1, stdout: '', stderr: '', error: 'invalid action id' });
  }
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', MANAGER_ARGS, {
      cwd: '.',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DECK_ACTION: String(action) },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      resolve({ code: 124, stdout, stderr, error: 'operation timed out' });
    }, 300000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: 1, stdout, stderr, error: error.message });
    });
    // Resolve on 'exit', not 'close': services started by the manager are
    // grandchildren of this child, and on Windows they can inherit its stdio
    // pipe handles. Those handles stay open for the service's lifetime, so
    // the 'close' event (which waits for stream EOF) may never fire. The
    // manager process terminating is the authoritative completion signal.
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setTimeout(() => {
        try { child.stdout.destroy(); } catch { /* already closed */ }
        try { child.stderr.destroy(); } catch { /* already closed */ }
        resolve({ code: code ?? 1, stdout, stderr });
      }, 250);
    });
  });
}

async function getStatus() {
  const now = Date.now();
  if (statusCache && now - statusCacheAt < 2500) return statusCache;
  if (statusInFlight) return statusInFlight;
  statusInFlight = runManager('status-json')
    .then((result) => {
      if (result.code !== 0) {
        throw new Error(trimOutput(result.stderr || result.stdout || 'status action failed', 5000));
      }
      const payload = JSON.parse(result.stdout);
      statusCache = payload;
      statusCacheAt = Date.now();
      return payload;
    })
    .finally(() => { statusInFlight = null; });
  return statusInFlight;
}

function startOperation(actionId) {
  const action = registry.actions.get(actionId);
  if (!action) {
    const error = new Error('action is not registered');
    error.statusCode = 404;
    throw error;
  }
  if (activeOperation) {
    const error = new Error('another operation is already running');
    error.statusCode = 409;
    error.operationId = activeOperation.id;
    throw error;
  }

  const operation = {
    id: crypto.randomUUID(),
    action: actionId,
    label: action.label,
    status: 'running',
    startedAt: new Date().toISOString(),
    output: '',
    error: '',
    code: null,
  };
  operations.set(operation.id, operation);
  activeOperation = operation;

  runManager(actionId).then((result) => {
    operation.code = result.code;
    operation.output = trimOutput(`${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`);
    operation.error = result.error || (result.code === 0 ? '' : trimOutput(result.stderr || result.stdout, 5000));
    operation.status = result.code === 0 ? 'succeeded' : 'failed';
    operation.finishedAt = new Date().toISOString();
    activeOperation = null;
    statusCacheAt = 0;
    while (operations.size > 40) {
      const oldest = operations.keys().next().value;
      operations.delete(oldest);
    }
  });
  return operation;
}

function safeLogFiles(serviceId) {
  const service = registry.services.get(serviceId);
  if (!service) return [];
  return (service.logs || [])
    .filter((name) => typeof name === 'string' && LOG_NAME_PATTERN.test(name));
}

function tailFile(fileName, maxBytes = 90000) {
  // Validate at the read site: bare filename only (no separators, no '..').
  if (!LOG_NAME_PATTERN.test(String(fileName))) return '';
  const filePath = `${LOG_DIR}/${fileName}`;
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8').split(/\r?\n/).slice(-160).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

function mimeType(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.md': 'text/markdown; charset=utf-8',
  })[ext] || 'application/octet-stream';
}

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

function sendRouteFile(response, filePath, cacheControl) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(response, 404, 'not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mimeType(filePath),
    'Cache-Control': cacheControl,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(filePath).pipe(response);
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    writeJson(response, 200, { ok: true, host: HOST, port: PORT, version: registry.manifest.version || 1 });
    return;
  }
  if (url.pathname === '/api/meta' && request.method === 'GET') {
    writeJson(response, 200, {
      dashboard: registry.manifest.dashboard,
      services: registry.manifest.services.map((service) => ({
        id: service.id,
        name: service.name,
        nameZh: service.nameZh,
        section: service.section || 'services',
        group: service.group,
        description: service.description,
        icon: service.icon,
        accent: service.accent,
        kind: service.kind,
        capabilities: service.capabilities || [],
        common: Boolean(service.common),
        url: service.url,
        endpoint: service.endpoint,
        port: service.port,
      })),
      actions: Array.from(registry.actions.values()),
      registryLoadedAt: registryLoadedAt(),
      server: { host: HOST, port: PORT, startedAt: serverStartedAt },
    });
    return;
  }
  if (url.pathname === '/api/status' && request.method === 'GET') {
    try {
      writeJson(response, 200, await getStatus());
    } catch (error) {
      fail(response, 502, 'unable to read service status', error.message);
    }
    return;
  }
  if (url.pathname === '/api/operations' && request.method === 'GET') {
    writeJson(response, 200, {
      active: activeOperation ? operationView(activeOperation) : null,
      recent: Array.from(operations.values()).slice(-12).reverse().map(operationView),
    });
    return;
  }
  const operationMatch = url.pathname.match(/^\/api\/operations\/([0-9a-f-]+)$/i);
  if (operationMatch && request.method === 'GET') {
    const operation = operations.get(operationMatch[1]);
    if (!operation) return fail(response, 404, 'operation not found');
    writeJson(response, 200, operationView(operation));
    return;
  }
  const actionMatch = url.pathname.match(/^\/api\/actions\/([a-z0-9-]+)$/);
  if (actionMatch && request.method === 'POST') {
    try {
      const operation = startOperation(actionMatch[1]);
      writeJson(response, 202, operationView(operation));
    } catch (error) {
      fail(response, error.statusCode || 500, error.message, error.operationId ? { operationId: error.operationId } : undefined);
    }
    return;
  }
  const logMatch = url.pathname.match(/^\/api\/logs\/([a-z0-9-]+)$/);
  if (logMatch && request.method === 'GET') {
    const service = registry.services.get(logMatch[1]);
    if (!service) return fail(response, 404, 'service not found');
    const caps = new Set(service.capabilities || []);
    if (!caps.has('logs')) return fail(response, 403, 'this service does not expose logs');
    const fileNames = safeLogFiles(logMatch[1]);
    writeJson(response, 200, {
      serviceId: logMatch[1],
      files: fileNames.map((fileName) => ({ name: fileName, content: tailFile(fileName) })),
    });
    return;
  }
  fail(response, 404, 'api route not found');
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    if (!requestIsLocal(request)) {
      fail(response, 403, 'this dashboard only accepts requests from the local machine');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET') {
      fail(response, 405, 'method not allowed');
      return;
    }
    const docRoute = DOC_ROUTES.get(url.pathname);
    if (docRoute) {
      sendRouteFile(response, docRoute, 'no-store');
      return;
    }
    const staticRoute = STATIC_ROUTES.get(url.pathname);
    if (staticRoute) {
      sendRouteFile(response, staticRoute, url.pathname === '/' || url.pathname === '/index.html' ? 'no-cache' : 'public, max-age=300');
      return;
    }
    fail(response, 404, 'not found');
  } catch (error) {
    fail(response, 500, 'internal server error', error.message);
  }
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
  console.log(`ServiceDeck listening at http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
