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

function run(args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

function lineFor(stdout, pattern) {
  return stdout.split('\n').find((l) => l.includes(pattern));
}

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

  // --- Scenario: empty keyspace ---
  {
    const result = run([REDIS_URL, '--json']);
    if (result.status !== 0) fail(`Empty keyspace --json exited ${result.status}: ${result.stderr}`);
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { fail('Empty keyspace --json output is not valid JSON'); }
    if (!Array.isArray(parsed) || parsed.length !== 0) fail('Empty keyspace should report an empty array');
  }

  // --- Seed 50 keys across 3 patterns ---
  //    user:{n} (20, TTL), session:{n} (15, no TTL), cache:{n} (15, TTL)
  const pipe = client.pipeline();
  for (let i = 1; i <= 20; i++) pipe.set(`user:${i}`, 'x'.repeat(100), 'EX', 3600);
  for (let i = 1; i <= 15; i++) pipe.set(`session:${i}`, 'x'.repeat(200));
  for (let i = 1; i <= 15; i++) pipe.set(`cache:${i}`, 'x'.repeat(50), 'EX', 600);
  await pipe.exec();

  // --- Real-world pattern normalization keys ---
  await client.set('llm:cache:a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'x'.repeat(300));
  await client.set('llm:cache:a1b2c3d4-e5f6-7890-abcd-ef1234567891:42', 'x'.repeat(300));
  await client.set('session:deadbeef12345678', 'x'.repeat(50));

  // 4. Assert table output has 3 rows with nonzero bytes and TTL%
  const tableResult = run([REDIS_URL]);
  if (tableResult.status !== 0) fail(`CLI exited ${tableResult.status}: ${tableResult.stderr}`);

  const tableOut = tableResult.stdout;
  const patterns = ['user:{n}', 'session:{n}', 'cache:{n}'];
  for (const p of patterns) {
    if (!tableOut.includes(p)) fail(`Table missing pattern: ${p}`);
  }

  for (const p of patterns) {
    const line = lineFor(tableOut, p);
    if (!line) fail(`Row not found for ${p}`);
    if (line.includes('│ 0 B │')) fail(`Zero bytes for pattern ${p}`);
  }

  // TTL% check: user and cache have TTL, session does not
  const userLine = lineFor(tableOut, 'user:{n}');
  if (!userLine || userLine.includes('│ 0.0%')) fail('user:{n} should have nonzero TTL%');
  const sessionLine = lineFor(tableOut, 'session:{n}');
  if (!sessionLine || !sessionLine.includes('0.0%')) fail('session:{n} should have 0 TTL%');

  // --- Real-world pattern normalization end-to-end ---
  if (!tableOut.includes('llm:cache:{id}')) fail('Table missing UUID-normalized pattern llm:cache:{id}');
  if (!tableOut.includes('llm:cache:{id}:{n}')) fail('Table missing UUID+numeric pattern llm:cache:{id}:{n}');
  if (!tableOut.includes('session:{hex}')) fail('Table missing hex-normalized pattern session:{hex}');

  // 5. Assert --json output
  const jsonResult = run([REDIS_URL, '--json']);
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
    if (typeof r.pattern !== 'string' || typeof r.count !== 'number' || typeof r.ttlPct !== 'string') {
      fail(`JSON row has unexpected shape: ${JSON.stringify(r)}`);
    }
  }

  // --- Scenario: --prefix filters the keyspace ---
  {
    const result = run([REDIS_URL, '--prefix', 'user:', '--json']);
    if (result.status !== 0) fail(`--prefix exited ${result.status}: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    const rowPatterns = rows.map(r => r.pattern);
    if (!rowPatterns.includes('user:{n}')) fail('--prefix user: should include user:{n}');
    if (rowPatterns.includes('session:{n}') || rowPatterns.includes('cache:{n}')) {
      fail('--prefix user: leaked keys outside the prefix');
    }
  }

  // --- Scenario: --sample-rate 0 yields no rows ---
  {
    const result = run([REDIS_URL, '--sample-rate', '0', '--json']);
    if (result.status !== 0) fail(`--sample-rate 0 exited ${result.status}: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    if (rows.length !== 0) fail('--sample-rate 0 should yield an empty result set');
  }

  // --- Scenario: --sample-rate 1 yields full results (same as default) ---
  {
    const result = run([REDIS_URL, '--sample-rate', '1', '--json']);
    if (result.status !== 0) fail(`--sample-rate 1 exited ${result.status}: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    for (const p of patterns) {
      if (!rows.map(r => r.pattern).includes(p)) fail(`--sample-rate 1 missing pattern ${p}`);
    }
  }

  // --- Scenario: invalid --sample-rate must error, not silently return empty ---
  for (const bad of ['abc', '-1', '2']) {
    const result = run([REDIS_URL, '--sample-rate', bad, '--json']);
    if (result.status === 0) fail(`--sample-rate ${bad} should exit non-zero, got 0`);
    if (!result.stderr.toLowerCase().includes('sample-rate')) {
      fail(`--sample-rate ${bad} error message should mention --sample-rate: ${result.stderr}`);
    }
  }

  // --- Scenario: --top limits row count ---
  {
    const result = run([REDIS_URL, '--top', '1', '--json']);
    if (result.status !== 0) fail(`--top 1 exited ${result.status}: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    if (rows.length !== 1) fail(`--top 1 should return exactly 1 row, got ${rows.length}`);
  }

  // --- Scenario: invalid --top must error, not silently return empty ---
  for (const bad of ['abc', '0', '-5']) {
    const result = run([REDIS_URL, '--top', bad, '--json']);
    if (result.status === 0) fail(`--top ${bad} should exit non-zero, got 0`);
    if (!result.stderr.toLowerCase().includes('top')) {
      fail(`--top ${bad} error message should mention --top: ${result.stderr}`);
    }
  }

  // --- Scenario: --sort bytes vs --sort count give different, correct ordering ---
  {
    const byBytes = JSON.parse(run([REDIS_URL, '--sort', 'bytes', '--json']).stdout);
    const byCount = JSON.parse(run([REDIS_URL, '--sort', 'count', '--json']).stdout);

    const sortedByBytes = [...byBytes].sort((a, b) => b.totalBytes - a.totalBytes).map(r => r.pattern);
    if (JSON.stringify(byBytes.map(r => r.pattern)) !== JSON.stringify(sortedByBytes)) {
      fail('--sort bytes output is not sorted by totalBytes descending');
    }

    const sortedByCount = [...byCount].sort((a, b) => b.count - a.count).map(r => r.pattern);
    if (JSON.stringify(byCount.map(r => r.pattern)) !== JSON.stringify(sortedByCount)) {
      fail('--sort count output is not sorted by count descending');
    }
  }

  // --- Scenario: invalid --sort must error ---
  {
    const result = run([REDIS_URL, '--sort', 'nonsense', '--json']);
    if (result.status === 0) fail('--sort nonsense should exit non-zero, got 0');
    if (!result.stderr.toLowerCase().includes('sort')) {
      fail(`--sort nonsense error message should mention --sort: ${result.stderr}`);
    }
  }

  // --- Scenario: --help and --version work (CLI convention baseline) ---
  {
    const help = run(['--help']);
    if (help.status !== 0) fail(`--help should exit 0, got ${help.status}`);
    if (!help.stdout.includes('--prefix') || !help.stdout.includes('--json')) {
      fail('--help output should document flags');
    }

    const version = run(['--version']);
    if (version.status !== 0) fail(`--version should exit 0, got ${version.status}`);
    if (!/\d+\.\d+\.\d+/.test(version.stdout)) fail('--version should print a semver string');
  }

  // --- Scenario: bad connection URL fails cleanly, without hanging, without leaking creds ---
  {
    const result = run(['redis://baduser:secretpass@127.0.0.1:1/']);
    if (result.status === 0) fail('Connection to an unreachable Redis should exit non-zero');
    if (result.stderr.includes('secretpass')) fail('Error output leaked the Redis password');
  }

  // --- Scenario: large keyspace spans multiple SCAN batches (default batch size 200) ---
  {
    const bulk = client.pipeline();
    for (let i = 1; i <= 450; i++) bulk.set(`bulk:${i}`, 'y', 'EX', 60);
    await bulk.exec();

    const result = run([REDIS_URL, '--prefix', 'bulk:', '--json']);
    if (result.status !== 0) fail(`Large keyspace scan exited ${result.status}: ${result.stderr}`);
    const rows = JSON.parse(result.stdout);
    const bulkRow = rows.find(r => r.pattern === 'bulk:{n}');
    if (!bulkRow) fail('Large keyspace scan missing bulk:{n} pattern');
    if (bulkRow.count !== 450) fail(`Large keyspace scan should count 450 keys, got ${bulkRow.count}`);
  }

  await client.quit();

  console.log('E2E PASS: all assertions satisfied');
}

main().catch(err => { console.error(err); process.exit(1); });
