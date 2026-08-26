import { describe, it, expect } from "vitest";
import { toPattern } from "../pattern.js";

describe("toPattern", () => {
  it("strips UUID → {id}", () => {
    expect(toPattern("session:a1b2c3d4-e5f6-7890-abcd-ef1234567890:data")).toBe(
      "session:{id}:data"
    );
  });

  it("strips pure-numeric segments → {n}", () => {
    expect(toPattern("user:12345:profile")).toBe("user:{n}:profile");
  });

  it("strips short hex strings ≥8 chars → {hex}", () => {
    expect(toPattern("session:a1b2c3d4:data")).toBe("session:{hex}:data");
  });

  it("preserves nested path with no strippable segments", () => {
    expect(toPattern("config:global:settings")).toBe("config:global:settings");
  });

  it("handles multiple replacements in one key", () => {
    expect(toPattern("user:42:order:99:item:deadbeef12345678")).toBe(
      "user:{n}:order:{n}:item:{hex}"
    );
  });

  it("returns unchanged key when no segments match", () => {
    expect(toPattern("health:check")).toBe("health:check");
  });
});
