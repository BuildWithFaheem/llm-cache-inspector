import { describe, it, expect, vi } from "vitest";
import { profile } from "../profiler.js";
import type Redis from "ioredis";

function mockClient(pipelineResults: [Error | null, unknown][]): Redis {
  const pipeline = {
    memory: vi.fn().mockReturnThis(),
    ttl: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(pipelineResults),
  };
  return { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis;
}

async function* batchesOf(keys: string[]): AsyncGenerator<string[]> {
  yield keys;
}

describe("profile", () => {
  it("sums totalBytes correctly across pipeline results", async () => {
    // keys: ["user:1", "user:2"] → both pattern "user:{n}"
    // MEMORY USAGE returns 100, 200; TTL returns -1, 300
    const client = mockClient([
      [null, 100], [null, -1],
      [null, 200], [null, 300],
    ]);

    const stats = await profile(client, batchesOf(["user:1", "user:2"]));
    const entry = stats.get("user:{n}");
    expect(entry?.totalBytes).toBe(300);
    expect(entry?.count).toBe(2);
  });

  it("computes TTL coverage ratio correctly", async () => {
    // 1 of 2 keys has TTL > 0
    const client = mockClient([
      [null, 50], [null, -1],
      [null, 50], [null, 600],
    ]);

    const stats = await profile(client, batchesOf(["user:1", "user:2"]));
    const entry = stats.get("user:{n}");
    expect(entry?.keysWithTTL).toBe(1);
    expect(entry?.count).toBe(2);
  });
});
