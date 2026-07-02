import { describe, expect, it } from "vitest";
import { formatDuration } from "../resultModel";

describe("formatDuration", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(15)).toBe("0:15");
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("clamps non-finite or negative input to 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
