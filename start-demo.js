#!/usr/bin/env node
'use strict';
// Starts the server with demo data. Works the same on Windows, macOS and Linux (no "VAR=1 command" syntax).
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const b = spawnSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
if (b.status !== 0) process.exit(b.status || 1);
const env = Object.assign({}, process.env, { SEED_DEMO: '1', PBKDF2_ITERATIONS: process.env.PBKDF2_ITERATIONS || '20000', DATA_DIR: process.env.DATA_DIR || path.join(root, 'data-demo') });
const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { stdio: 'inherit', env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code === null ? 0 : code));
