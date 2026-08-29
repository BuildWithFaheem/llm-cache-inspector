import { describe, it, expect, vi, afterEach } from "vitest";
import { report } from "../reporter.js";
import type { ProfileStats } from "../profiler.js";

function statsOf(entries: [string, { totalBytes: number; count: number; keysWithTTL: number }][]): ProfileStats {
  return new Map(entries);
}

describe("report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sorts by totalBytes descending by default", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([
      ["small", { totalBytes: 100, count: 5, keysWithTTL: 0 }],
      ["big", { totalBytes: 900, count: 1, keysWithTTL: 0 }],
    ]);

    report(stats, { json: true });

    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.map((r: { pattern: string }) => r.pattern)).toEqual(["big", "small"]);
  });

  it("sorts by count when sort=count", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([
      ["fewKeys", { totalBytes: 900, count: 1, keysWithTTL: 0 }],
      ["manyKeys", { totalBytes: 100, count: 50, keysWithTTL: 0 }],
    ]);

    report(stats, { json: true, sort: "count" });

    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.map((r: { pattern: string }) => r.pattern)).toEqual(["manyKeys", "fewKeys"]);
  });

  it("slices to top N", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([
      ["a", { totalBytes: 300, count: 1, keysWithTTL: 0 }],
      ["b", { totalBytes: 200, count: 1, keysWithTTL: 0 }],
      ["c", { totalBytes: 100, count: 1, keysWithTTL: 0 }],
    ]);

    report(stats, { json: true, top: 2 });

    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out).toHaveLength(2);
    expect(out.map((r: { pattern: string }) => r.pattern)).toEqual(["a", "b"]);
  });

  it("computes ttlPct correctly", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([["p", { totalBytes: 10, count: 4, keysWithTTL: 1 }]]);

    report(stats, { json: true });

    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out[0].ttlPct).toBe("25.0");
  });

  it("renders a table (not JSON) by default, including the pattern text", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([["llm:cache:{id}", { totalBytes: 2048, count: 3, keysWithTTL: 3 }]]);

    report(stats);

    const out = logSpy.mock.calls[0][0] as string;
    expect(out).toContain("llm:cache:{id}");
    expect(out).toContain("2.0 KB");
    expect(out).toContain("100.0%");
    expect(() => JSON.parse(out)).toThrow();
  });

  it("handles an empty stats map without throwing", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => report(statsOf([]), { json: true })).not.toThrow();
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out).toEqual([]);
  });

  it("formats byte sizes across B/KB/MB boundaries", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const stats = statsOf([
      ["bytes", { totalBytes: 512, count: 1, keysWithTTL: 0 }],
      ["kb", { totalBytes: 5 * 1024, count: 1, keysWithTTL: 0 }],
      ["mb", { totalBytes: 3 * 1024 * 1024, count: 1, keysWithTTL: 0 }],
    ]);

    report(stats);

    const out = logSpy.mock.calls[0][0] as string;
    expect(out).toContain("512 B");
    expect(out).toContain("5.0 KB");
    expect(out).toContain("3.00 MB");
  });
});
