import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "@gw-link-omniai/shared";
import { AdminAppShell } from "../appShell";
import { getAdminSessionBanner } from "../sessionModel";

describe("AdminAppShell", () => {
  it("renders the operations modules required by the PRD and auth banner", () => {
    const client = { listModels: async () => [] } as unknown as ApiClient;
    render(<AdminAppShell client={client} />);

    expect(screen.getByText("GW-LINK OmniAI Admin")).toBeTruthy();
    expect(screen.getByText("Admin login required")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Plans & Credits")).toBeTruthy();
    expect(screen.getByText("Model Display")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Usage Metrics")).toBeTruthy();
  });

  it("summarizes an authenticated admin session", () => {
    expect(
      getAdminSessionBanner({
        authenticated: true,
        expiresAt: "2026-06-26T12:00:00.000Z",
        user: {
          id: "user_email_admin_example_com",
          displayName: "admin",
          destination: "admin@example.com",
          channel: "email",
          plan: "studio",
          createdAt: "2026-06-19T12:00:00.000Z"
        }
      })
    ).toBe("Admin session active: admin");
  });
});
