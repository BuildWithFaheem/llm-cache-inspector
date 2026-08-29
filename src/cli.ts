#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createClient } from "./redis.js";
import { scan } from "./scanner.js";
import { profile } from "./profiler.js";
import { report } from "./reporter.js";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

const program = new Command();

program
  .name("llm-cache-inspector")
  .description("Scan Redis keyspace and aggregate MEMORY USAGE by LLM cache key pattern")
  .version(pkg.version)
  .argument("[redis-url]", "Redis connection URL", "redis://localhost:6379")
  .option("--prefix <string>", "scan only keys with this prefix")
  .option("--sample-rate <number>", "probabilistic sampling fraction (0-1)", "1.0")
  .option("--top <number>", "show top N patterns", "20")
  .option("--sort <bytes|count>", "sort column", "bytes")
  .option("--json", "emit JSON instead of table")
  .action(async (redisUrl: string, opts) => {
    const sampleRate = parseFloat(opts.sampleRate);
    if (Number.isNaN(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      console.error(`Invalid --sample-rate "${opts.sampleRate}": must be a number between 0 and 1`);
      process.exit(1);
    }

    const top = parseInt(opts.top, 10);
    if (Number.isNaN(top) || top < 1) {
      console.error(`Invalid --top "${opts.top}": must be a positive integer`);
      process.exit(1);
    }

    const sort = opts.sort as "bytes" | "count";
    if (sort !== "bytes" && sort !== "count") {
      console.error(`Invalid --sort "${opts.sort}": must be "bytes" or "count"`);
      process.exit(1);
    }

    let safeUrl = redisUrl;
    try {
      const parsed = new URL(redisUrl);
      if (parsed.password) parsed.password = "***";
      if (parsed.username) parsed.username = "***";
      safeUrl = parsed.toString();
    } catch {
      // not a valid URL; fall through and use it as-is
    }

    const client = createClient(redisUrl);

    try {
      await client.ping();
    } catch (err) {
      console.error(`Failed to connect to Redis at ${safeUrl}:`, (err as Error).message);
      process.exit(1);
    }

    const keyBatches = scan(client, {
      prefix: opts.prefix,
      sampleRate,
    });

    const stats = await profile(client, keyBatches);
    report(stats, { top, sort, json: opts.json });

    await client.disconnect();
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
