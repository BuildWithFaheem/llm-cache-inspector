import { describe, it, expect } from "vitest";
import { createClient } from "../redis.js";

describe("createClient", () => {
  it("builds an ioredis client without connecting immediately (lazyConnect)", () => {
    const client = createClient("redis://localhost:6379");
    expect(client.status).toBe("wait");
    client.disconnect();
  });

  it("parses host/port from the connection URL", () => {
    const client = createClient("redis://example.com:6390");
    expect(client.options.host).toBe("example.com");
    expect(client.options.port).toBe(6390);
    client.disconnect();
  });
});
