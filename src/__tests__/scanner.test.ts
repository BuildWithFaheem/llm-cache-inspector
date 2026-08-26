import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scan } from "../scanner.js";
import type Redis from "ioredis";

function mockRedis(keyBatches: string[][]): Redis {
  let call = 0;
  return {
    scan: vi.fn().mockImplementation(() => {
      const keys = keyBatches[call] ?? [];
      const cursor = call < keyBatches.length - 1 ? String(call + 1) : "0";
      call++;
      return Promise.resolve([cursor, keys]);
    }),
  } as unknown as Redis;
}

describe("scan", () => {
  const keys = ["user:1", "user:2", "user:3"];

  it("yields nothing when sample-rate=0", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = mockRedis([keys]);
    const batches: string[][] = [];
    for await (const batch of scan(client, { sampleRate: 0 })) {
      batches.push(batch);
    }
    expect(batches.flat()).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("yields all keys when sample-rate=1", async () => {
    const client = mockRedis([keys]);
    const batches: string[][] = [];
    for await (const batch of scan(client, { sampleRate: 1 })) {
      batches.push(batch);
    }
    expect(batches.flat()).toEqual(keys);
  });

  it("is deterministic when Math.random is stubbed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.3);
    const client = mockRedis([keys]);
    const batches: string[][] = [];
    // rate=0.5, random=0.3 → 0.3 < 0.5 → all keys pass
    for await (const batch of scan(client, { sampleRate: 0.5 })) {
      batches.push(batch);
    }
    expect(batches.flat()).toEqual(keys);
    vi.restoreAllMocks();
  });

  it("filters by prefix via MATCH pattern", async () => {
    const client = mockRedis([[]]);
    const scanSpy = (client as unknown as { scan: ReturnType<typeof vi.fn> }).scan;
    for await (const _ of scan(client, { prefix: "user:" })) { /* drain */ }
    expect(scanSpy).toHaveBeenCalledWith("0", "MATCH", "user:*", "COUNT", 200);
  });
});
