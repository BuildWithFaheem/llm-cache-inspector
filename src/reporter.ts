import Table from "cli-table3";
import { ProfileStats } from "./profiler.js";

interface ReportOptions {
  top?: number;
  sort?: "bytes" | "count";
  json?: boolean;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function report(stats: ProfileStats, opts: ReportOptions = {}): void {
  const { top = 20, sort = "bytes", json = false } = opts;

  const rows = [...stats.entries()]
    .sort((a, b) =>
      sort === "bytes"
        ? b[1].totalBytes - a[1].totalBytes
        : b[1].count - a[1].count
    )
    .slice(0, top)
    .map(([pattern, s]) => ({
      pattern,
      totalBytes: s.totalBytes,
      count: s.count,
      ttlPct: s.count > 0 ? ((s.keysWithTTL / s.count) * 100).toFixed(1) : "0.0",
    }));

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const table = new Table({
    head: ["Pattern", "Total Memory", "Keys", "TTL%"],
    style: { head: ["cyan"] },
  });

  for (const r of rows) {
    table.push([r.pattern, fmtBytes(r.totalBytes), String(r.count), `${r.ttlPct}%`]);
  }

  console.log(table.toString());
}
