import { describe, expect, it } from "vitest";
import { getMobileHomeActions } from "../homeModel";
import { getMobileSessionCta } from "../sessionModel";

describe("getMobileHomeActions", () => {
  it("returns the mobile-first creation, auth, and history actions", () => {
    expect(getMobileHomeActions()).toEqual([
      "Sign In",
      "Text Chat",
      "Image Generation",
      "Video Generation",
      "Creation History",
      "Task Notifications"
    ]);
  });

  it("returns a concise mobile session label", () => {
    expect(
      getMobileSessionCta({
        authenticated: false,
        user: null,
        expiresAt: null
      })
    ).toBe("Sign In");
  });
});
