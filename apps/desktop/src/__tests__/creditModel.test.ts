import { describe, expect, it } from "vitest";
import { formatCreditBalance } from "../creditModel";

describe("formatCreditBalance", () => {
  it("formats a credit amount as a Chinese label", () => {
    expect(formatCreditBalance({ credits: 100, unit: "credit" })).toBe("积分：100");
  });

  it("formats a zero balance", () => {
    expect(formatCreditBalance({ credits: 0, unit: "credit" })).toBe("积分：0");
  });
});
