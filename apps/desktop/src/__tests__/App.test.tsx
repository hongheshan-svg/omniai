import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { getDesktopSessionCta } from "../sessionModel";

describe("Desktop App", () => {
  it("renders the three core creation modes and sign-in entry", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    expect(screen.getByText("Text Chat")).toBeTruthy();
    expect(screen.getByText("Image Generation")).toBeTruthy();
    expect(screen.getByText("Video Generation")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("summarizes authenticated desktop sessions", () => {
    expect(
      getDesktopSessionCta({
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
    ).toBe("Signed in as creator");
  });
});
