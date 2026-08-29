# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CLI entry point (`llm-cache-inspector`) with `commander`; accepts a Redis URL positional argument defaulting to `redis://localhost:6379`.
- `--prefix` flag to restrict the `SCAN` to keys with a given prefix.
- `--sample-rate` flag (0–1) for probabilistic sampling; keys are filtered per-batch using `Math.random()`.
- `--top` flag to limit output to the N highest-ranked patterns (default 20).
- `--sort bytes|count` flag to choose the ranking column (default `bytes`).
- `--json` flag to emit newline-delimited JSON instead of a terminal table.
- Key pattern inference in `src/pattern.ts`: normalizes UUIDs → `{id}`, long hex strings → `{hex}`, standalone integers → `{n}`.
- Non-blocking keyspace scan in `src/scanner.ts` using Redis `SCAN` with a cursor loop and configurable batch size (200 keys/batch).
- Memory and TTL profiling in `src/profiler.ts` using pipelined `MEMORY USAGE … SAMPLES 0` + `TTL` per key; aggregates `totalBytes`, `count`, and `keysWithTTL` per pattern.
- Table renderer in `src/reporter.ts` using `cli-table3`; columns: Pattern, Total Memory, Keys, TTL%.
- Human-readable byte formatter (`B` / `KB` / `MB`).
- Unit tests for pattern normalization and profiling aggregation (Vitest).
- End-to-end test runner (`e2e/run.js`) against a live Redis instance.
