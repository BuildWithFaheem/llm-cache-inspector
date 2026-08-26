#!/usr/bin/env node
import { Command } from "commander";
import { createClient } from "./redis.js";
import { scan } from "./scanner.js";
import { profile } from "./profiler.js";
import { report } from "./reporter.js";

const program = new Command();

program
  .name("redis-pattern-profiler")
  .description("Scan Redis keyspace and aggregate MEMORY USAGE by key pattern")
  .argument("[redis-url]", "Redis connection URL", "redis://localhost:6379")
  .option("--prefix <string>", "scan only keys with this prefix")
  .option("--sample-rate <number>", "probabilistic sampling fraction (0-1)", "1.0")
  .option("--top <number>", "show top N patterns", "20")
  .option("--sort <bytes|count>", "sort column", "bytes")
  .option("--json", "emit JSON instead of table")
  .action(async (redisUrl: string, opts) => {
    const client = createClient(redisUrl);

    try {
      await client.ping();
    } catch (err) {
      console.error(`Failed to connect to Redis at ${redisUrl}:`, (err as Error).message);
      process.exit(1);
    }

    const sampleRate = parseFloat(opts.sampleRate);
    const top = parseInt(opts.top, 10);
    const sort = opts.sort as "bytes" | "count";

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
