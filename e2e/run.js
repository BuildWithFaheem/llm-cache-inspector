'use strict';
const { execSync, spawnSync } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '../dist/cli.js');
const REDIS_URL = 'redis://localhost:6379';
let containerId;

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function cleanup() {
  if (!containerId) return;
  try { execSync(`docker stop ${containerId} && docker rm ${containerId}`, { stdio: 'ignore' }); } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(1));

async function main() {
  // 1. Start Redis
  containerId = execSync('docker run -d -p 6379:6379 redis:7-alpine').toString().trim();

  // 2. Wait for Redis to be ready (up to 15s)
  const Redis = require('ioredis');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const probe = new Redis(REDIS_URL, { lazyConnect: true, enableReadyCheck: false });
    try { await probe.connect(); await probe.ping(); await probe.quit(); ready = true; break; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) fail('Redis never became ready');
  const client = new Redis(REDIS_URL);

  // 3. Seed 50 keys across 3 patterns
  //    user:{n} (20), session:{n} (15), cache:{n} (15)
  const pipe = client.pipeline();
  for (let i = 1; i <= 20; i++) pipe.set(`user:${i}`, 'x'.repeat(100), 'EX', 3600);
  for (let i = 1; i <= 15; i++) pipe.set(`session:${i}`, 'x'.repeat(200));
  for (let i = 1; i <= 15; i++) pipe.set(`cache:${i}`, 'x'.repeat(50), 'EX', 600);
  await pipe.exec();
  await client.quit();

  // 4. Assert table output has 3 rows with nonzero bytes and TTL%
  const tableResult = spawnSync('node', [CLI, REDIS_URL], { encoding: 'utf8' });
  if (tableResult.status !== 0) fail(`CLI exited ${tableResult.status}: ${tableResult.stderr}`);

  const tableOut = tableResult.stdout;
  const patterns = ['user:{n}', 'session:{n}', 'cache:{n}'];
  for (const p of patterns) {
    if (!tableOut.includes(p)) fail(`Table missing pattern: ${p}`);
  }

  // Each pattern row should have nonzero bytes (not "0 B")
  // cli-table3 rows: pattern | Total Memory | Keys | TTL%
  // Just verify the patterns appear and bytes column isn't "0 B" adjacent to them
  for (const p of patterns) {
    const lineIdx = tableOut.split('\n').findIndex(l => l.includes(p));
    if (lineIdx === -1) fail(`Row not found for ${p}`);
    const line = tableOut.split('\n')[lineIdx];
    if (line.includes('│ 0 B │')) fail(`Zero bytes for pattern ${p}`);
  }

  // TTL% check: user and cache have TTL, session does not
  const userLine = tableOut.split('\n').find(l => l.includes('user:{n}'));
  if (!userLine || userLine.includes('│ 0.0%')) fail('user:{n} should have nonzero TTL%');
  const sessionLine = tableOut.split('\n').find(l => l.includes('session:{n}'));
  if (!sessionLine || !sessionLine.includes('0.0%')) fail('session:{n} should have 0 TTL%');

  // 5. Assert --json output
  const jsonResult = spawnSync('node', [CLI, REDIS_URL, '--json'], { encoding: 'utf8' });
  if (jsonResult.status !== 0) fail(`CLI --json exited ${jsonResult.status}: ${jsonResult.stderr}`);

  let parsed;
  try { parsed = JSON.parse(jsonResult.stdout); } catch { fail('--json output is not valid JSON'); }

  if (!Array.isArray(parsed)) fail('JSON output should be an array');
  const jsonPatterns = parsed.map(r => r.pattern);
  for (const p of patterns) {
    if (!jsonPatterns.includes(p)) fail(`JSON missing pattern: ${p}`);
  }
  for (const r of parsed) {
    if (r.totalBytes === 0) fail(`Zero bytes in JSON for pattern: ${r.pattern}`);
  }

  console.log('E2E PASS: all assertions satisfied');
}

main().catch(err => { console.error(err); process.exit(1); });
