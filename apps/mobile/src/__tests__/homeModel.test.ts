import { describe, expect, it, vi } from "vitest";
import { getMobileHomeActions } from "../homeModel";
import { getMobileSessionCta } from "../sessionModel";

describe("getMobileHomeActions", () => {
  it("uses the anonymous session CTA for the first home action", async () => {
    vi.resetModules();
    vi.doMock("../sessionModel", () => ({
      getMobileSessionCta: () => "Mock Session CTA"
    }));

    const { getMobileHomeActions: getMockedMobileHomeActions } = await import(
      "../homeModel"
    );

    try {
      expect(getMockedMobileHomeActions()).toEqual([
        "Mock Session CTA",
        "Text Chat",
        "Image Generation",
        "Video Generation",
        "Creation History",
        "Task Notifications"
      ]);
    } finally {
      vi.doUnmock("../sessionModel");
      vi.resetModules();
    }
  });

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

  it("returns the authenticated mobile session display name", () => {
    expect(
      getMobileSessionCta({
        authenticated: true,
        expiresAt: "2026-06-26T12:00:00.000Z",
        user: {
          id: "user_email_creator_example_com",
          displayName: "creator",
          destination: "creator@example.com",
          channel: "email",
          plan: "free",
          createdAt: "2026-06-19T12:00:00.000Z"
        }
      })
    ).toBe("creator");
  });
});
