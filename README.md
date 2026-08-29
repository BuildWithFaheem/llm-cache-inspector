# llm-cache-inspector

A CLI tool that scans a Redis keyspace, infers key patterns, and reports memory usage per pattern. It's aimed at AI engineers who cache LLM prompts or responses in Redis and need to verify that their cache key structure is actually working—before a misplaced dynamic segment quietly kills every cache hit and inflates their monthly bill.

> Status: early. The API may change before 1.0.

## Install

```bash
npm install -g llm-cache-inspector
```

Or run without installing:

```bash
npx llm-cache-inspector
```

## Quick start

Point it at your Redis instance:

```bash
npx llm-cache-inspector redis://localhost:6379
```

Output:

```
┌─────────────────────────────────────────┬──────────────┬──────┬──────┐
│ Pattern                                 │ Total Memory │ Keys │ TTL% │
├─────────────────────────────────────────┼──────────────┼──────┼──────┤
│ llm:cache:{id}                          │ 18.42 MB     │  312 │ 100% │
│ llm:cache:{id}:{n}                      │ 4.10 MB      │   89 │   0% │
│ session:{hex}                           │ 1.23 MB      │  450 │  82% │
└─────────────────────────────────────────┴──────────────┴──────┴──────┘
```

The second row—`llm:cache:{id}:{n}`—is the problem: a numeric token count leaked into the cache key, meaning every request with a different prompt length is a cache miss.

## Why this exists

Prompt caching (Anthropic's `cache_control`, OpenAI's cached tokens) cuts LLM inference costs by 50–90%. But the benefit only materializes if your cache keys are stable. A single dynamic segment—a request ID, a timestamp, a token count—makes every key unique, so nothing is ever reused. The LLM SDK won't tell you this is happening. The only signal is a higher invoice at the end of the month.

This tool gives you a concrete view of your Redis keyspace organized by pattern rather than by individual key, so structural problems are immediately visible: which patterns hold the most memory, whether entries have TTLs, and whether patterns that should be stable are actually stable.

## Usage

```bash
# Scan the default local Redis
npx llm-cache-inspector

# Remote instance
npx llm-cache-inspector redis://user:pass@cache.example.com:6379

# Only look at LLM cache keys
npx llm-cache-inspector --prefix llm:cache:

# Sample 10% of keys on a large keyspace (faster, still representative)
npx llm-cache-inspector --sample-rate 0.1

# Show the top 10 patterns sorted by key count instead of bytes
npx llm-cache-inspector --top 10 --sort count

# Emit JSON for piping into jq or another tool
npx llm-cache-inspector --json | jq '.[] | select(.count > 100)'
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `[redis-url]` | `redis://localhost:6379` | Redis connection URL |
| `--prefix <string>` | _(all keys)_ | Scan only keys starting with this prefix |
| `--sample-rate <0-1>` | `1.0` | Fraction of keys to sample; use `0.1` for large keyspaces |
| `--top <n>` | `20` | Show the top N patterns in the output |
| `--sort bytes\|count` | `bytes` | Sort column |
| `--json` | _(table)_ | Emit JSON instead of a rendered table |

### JSON output schema

```json
[
  {
    "pattern": "llm:cache:{id}",
    "totalBytes": 19320832,
    "count": 312,
    "ttlPct": "100.0"
  }
]
```

## How it works

The scanner uses Redis `SCAN` (non-blocking, cursor-based) to iterate the keyspace in batches of 200 keys. For each batch it issues a pipelined `MEMORY USAGE` + `TTL` command pair per key, keeping round-trips low. Each key is normalized to a pattern by replacing UUIDs with `{id}`, long hex strings with `{hex}`, and standalone integers with `{n}`. Keys that share a pattern are aggregated: total bytes, key count, and the fraction that carry a TTL. The final sorted list is rendered as a terminal table via `cli-table3`, or as JSON when `--json` is passed.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Syed Muhammad Faheem](https://github.com/SyedMuhammadFaheem)
