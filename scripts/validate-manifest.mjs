#!/usr/bin/env node
'use strict';

/*
 * Schema validation for the ServiceDeck registry. Used by CI and as a local
 * pre-flight: node scripts/validate-manifest.mjs [path-to-services.json]
 */

import fs from 'node:fs';
import path from 'node:path';

const KINDS = new Set(['process', 'docker-compose', 'ssh-tunnel', 'external']);
const CAPABILITIES = new Set(['start', 'stop', 'logs']);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOG_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const target = process.argv[2] || path.join(process.cwd(), 'services.json');
if (!fs.existsSync(target)) {
  console.error(`[validate] file not found: ${target}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
} catch (error) {
  console.error(`[validate] JSON parse error: ${error.message}`);
  process.exit(1);
}

const problems = [];
if (!Array.isArray(manifest.services)) problems.push('top-level "services" must be an array');

const seenIds = new Set();
for (const service of manifest.services || []) {
  const label = JSON.stringify(service.id) || '(missing id)';
  if (!ID_PATTERN.test(String(service.id || ''))) problems.push(`${label}: id must match ${ID_PATTERN}`);
  if (seenIds.has(service.id)) problems.push(`${label}: duplicate id`);
  seenIds.add(service.id);

  const kind = String(service.kind || '');
  if (!KINDS.has(kind)) problems.push(`${label}: kind must be one of ${[...KINDS].join(', ')}`);

  for (const capability of service.capabilities || []) {
    if (!CAPABILITIES.has(capability)) problems.push(`${label}: unknown capability "${capability}"`);
  }
  const caps = new Set(service.capabilities || []);
  if (caps.has('start') && kind === 'external') problems.push(`${label}: external entries cannot declare the start capability`);
  if (caps.has('start') && !service.start && kind === 'process') problems.push(`${label}: process kind with start capability needs a "start" block`);
  if (caps.has('stop') && kind !== 'docker-compose' && kind !== 'ssh-tunnel' && !(service.stop && service.stop.matchCommandLine)) {
    problems.push(`${label}: stop capability requires stop.matchCommandLine (except docker-compose / ssh-tunnel)`);
  }
  if (service.start && service.start.window !== undefined && !['hidden', 'visible'].includes(service.start.window)) {
    problems.push(`${label}: start.window must be "hidden" or "visible"`);
  }
  if (service.start && service.start.readyTimeoutSec !== undefined && !(Number.isInteger(service.start.readyTimeoutSec) && service.start.readyTimeoutSec > 0)) {
    problems.push(`${label}: start.readyTimeoutSec must be a positive integer`);
  }
  if (service.health && service.health.type && !['http', 'port', 'process'].includes(service.health.type)) {
    problems.push(`${label}: health.type must be "http", "port" or "process"`);
  }
  if (service.health && service.health.type === 'process' && !service.health.matchCommandLine) {
    problems.push(`${label}: health.type "process" requires health.matchCommandLine`);
  }
  if (kind === 'ssh-tunnel' && !service.ssh) problems.push(`${label}: ssh-tunnel kind needs an "ssh" block`);
  if (kind === 'docker-compose' && !Array.isArray(service.composeFiles)) problems.push(`${label}: docker-compose kind needs composeFiles array`);
  for (const log of service.logs || []) {
    if (!LOG_NAME_PATTERN.test(String(log))) problems.push(`${label}: log name "${log}" must match ${LOG_NAME_PATTERN}`);
  }
}

if (problems.length) {
  console.error(`[validate] ${target} has ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[validate] ${target} OK (${(manifest.services || []).length} services)`);
