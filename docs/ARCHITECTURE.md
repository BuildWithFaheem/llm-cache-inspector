# Architecture

## Overview

The tool is a thin pipeline: scan → normalize → aggregate → render. Each stage is a separate module; the CLI wires them together.

```
cli.ts
  └─ scanner.ts   — async generator: SCAN cursor loop → yields string[][]
  └─ profiler.ts  — consumes batches, pipelines MEMORY USAGE + TTL, builds Map<pattern, stats>
  └─ reporter.ts  — sorts, slices, formats as table or JSON
       └─ pattern.ts  — pure function: key string → pattern string
```

## Modules

### `src/scanner.ts`

Wraps the Redis `SCAN` command in an async generator. It loops until the cursor returns to `"0"`, yielding one batch of raw key strings per iteration (default 200 keys). If `--prefix` was given, the `MATCH` argument is `<prefix>*`; otherwise `*`. If `--sample-rate` is less than 1, each key in the batch is kept with probability equal to the rate via `Math.random()`. The generator never loads all keys into memory at once.

### `src/pattern.ts`

A single pure function, `toPattern(key)`, that normalizes a raw Redis key to a pattern string by applying three regex replacements in order:

1. UUIDs (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → `{id}`
2. Long hex strings (8+ hex characters, word-bounded) → `{hex}`
3. Standalone integers (not part of a hex sequence) → `{n}`

The ordering matters: UUID replacement runs first so the hex digits inside a UUID are consumed before the hex rule can split them.

### `src/profiler.ts`

Iterates the async generator from `scanner.ts`. For each batch it builds a single Redis pipeline with two commands per key—`MEMORY USAGE <key> SAMPLES 0` and `TTL <key>`—then executes the pipeline in one round-trip. Results are paired back to their keys (even-indexed = bytes, odd-indexed = TTL) and accumulated into a `Map<string, PatternStats>` keyed by the normalized pattern. `SAMPLES 0` measures only the key's own allocation without sampling nested structures; it's faster and sufficient for relative comparisons.

### `src/reporter.ts`

Takes the `ProfileStats` map, sorts entries by `totalBytes` or `count` (caller's choice), slices to the top N, and either pretty-prints a `cli-table3` table with human-readable byte sizes or emits a JSON array. The JSON shape is stable and documented in the README, making it safe to pipe into other tools.

### `src/redis.ts`

A thin wrapper around `ioredis` that constructs a client from a URL string. Kept separate so tests can substitute a mock client without touching CLI argument parsing.

## Data flow

```
Redis keyspace
    │
    ▼  SCAN (cursor loop, batch=200)
scanner.ts → yields string[][] (batches of raw keys)
    │
    ▼  MEMORY USAGE + TTL pipelined per batch
profiler.ts → Map<pattern, { totalBytes, count, keysWithTTL }>
    │
    ▼  sort + slice + format
reporter.ts → stdout (table or JSON)
```

## Design decisions

**Async generator for scanning.** Avoids buffering the entire keyspace in memory. The profiler can start processing the first batch while the scanner fetches the second.

**Pipelined MEMORY USAGE.** Issuing one pipeline per batch rather than one command per key cuts round-trip overhead from O(keys) to O(batches). For a 100 k-key keyspace at batch size 200 that's 500 round-trips instead of 100 000.

**Pattern normalization as a pure function.** `toPattern` has no I/O or state, making it trivial to unit-test and easy to replace if a different normalization strategy is needed later.

**No persistence.** Results are printed and discarded. Adding historical tracking (writing snapshots to disk, diffing runs) is outside scope for now.
