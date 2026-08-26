import Redis from "ioredis";
import { toPattern } from "./pattern.js";

export interface PatternStats {
  totalBytes: number;
  count: number;
  keysWithTTL: number;
}

export type ProfileStats = Map<string, PatternStats>;

export async function profile(
  client: Redis,
  keyBatches: AsyncIterable<string[]>
): Promise<ProfileStats> {
  const stats: ProfileStats = new Map();

  for await (const keys of keyBatches) {
    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.memory("USAGE", key, "SAMPLES", "0");
      pipeline.ttl(key);
    }

    const results = await pipeline.exec();
    if (!results) continue;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const bytesResult = results[i * 2];
      const ttlResult = results[i * 2 + 1];

      const bytes = bytesResult && !bytesResult[0] ? (bytesResult[1] as number) ?? 0 : 0;
      const ttl = ttlResult && !ttlResult[0] ? (ttlResult[1] as number) : -1;

      const pattern = toPattern(key);
      const existing = stats.get(pattern) ?? { totalBytes: 0, count: 0, keysWithTTL: 0 };
      existing.totalBytes += bytes;
      existing.count += 1;
      if (ttl > 0) existing.keysWithTTL += 1;
      stats.set(pattern, existing);
    }
  }

  return stats;
}
