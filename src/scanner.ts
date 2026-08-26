import Redis from "ioredis";

interface ScanOptions {
  prefix?: string;
  sampleRate?: number;
  batchSize?: number;
}

export async function* scan(
  client: Redis,
  opts: ScanOptions = {}
): AsyncGenerator<string[]> {
  const { prefix, sampleRate = 1.0, batchSize = 200 } = opts;
  const match = prefix ? `${prefix}*` : "*";
  let cursor = "0";

  do {
    const [next, keys] = await client.scan(cursor, "MATCH", match, "COUNT", batchSize);
    cursor = next;

    const sampled =
      sampleRate >= 1.0
        ? keys
        : keys.filter(() => Math.random() < sampleRate);

    if (sampled.length > 0) yield sampled;
  } while (cursor !== "0");
}
