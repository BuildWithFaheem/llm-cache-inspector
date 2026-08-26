import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));

describe("package identity", () => {
  it("package name is llm-cache-inspector", () => {
    expect(pkg.name).toBe("llm-cache-inspector");
  });

  it("bin is llm-cache-inspector", () => {
    expect(pkg.bin).toHaveProperty("llm-cache-inspector");
    expect(pkg.bin).not.toHaveProperty("redis-pattern-profiler");
  });
});
