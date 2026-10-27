import { describe, it, expect } from "vitest";
import { parseWarmupSeconds, warmupMsToSecondsInput } from "../../src/services/stream-warmup";

describe("stream warm-up seconds input (#244)", () => {
  it("converts seconds to ms and empty to null", () => {
    expect(parseWarmupSeconds("60")).toBe(60_000);
    expect(parseWarmupSeconds(" 1.5 ")).toBe(1_500);
    expect(parseWarmupSeconds("")).toBeNull();
  });

  it("rejects values outside 1..600 seconds", () => {
    expect(parseWarmupSeconds("0.5")).toBeUndefined();
    expect(parseWarmupSeconds("601")).toBeUndefined();
    expect(parseWarmupSeconds("abc")).toBeUndefined();
  });

  it("renders stored ms as seconds", () => {
    expect(warmupMsToSecondsInput(45_000)).toBe("45");
    expect(warmupMsToSecondsInput(null)).toBe("");
  });
});
