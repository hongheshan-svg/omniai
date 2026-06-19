import { describe, expect, it } from "vitest";
import { inferLoginChannel, maskLoginDestination } from "../auth";

describe("auth helpers", () => {
  it("infers email channel when destination contains an at sign", () => {
    expect(inferLoginChannel("creator@example.com")).toBe("email");
  });

  it("infers phone channel for non-email destinations", () => {
    expect(inferLoginChannel("+86 138 0013 8000")).toBe("phone");
  });

  it("masks email destinations without hiding the domain", () => {
    expect(maskLoginDestination("creator@example.com")).toBe("c***@example.com");
  });

  it("masks phone destinations while preserving the final four digits", () => {
    expect(maskLoginDestination("+86 138 0013 8000")).toBe("*********8000");
  });
});
