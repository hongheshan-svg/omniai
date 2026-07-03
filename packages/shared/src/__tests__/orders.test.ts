import { describe, expect, it } from "vitest";
import { isCreateOrderRequest } from "../orders";

describe("isCreateOrderRequest", () => {
  it("accepts a valid request", () => {
    expect(isCreateOrderRequest({ packageId: "credits-100" })).toBe(true);
  });
  it("rejects invalid shapes", () => {
    expect(isCreateOrderRequest({})).toBe(false);
    expect(isCreateOrderRequest({ packageId: 5 })).toBe(false);
    expect(isCreateOrderRequest(null)).toBe(false);
    expect(isCreateOrderRequest("x")).toBe(false);
  });
});
