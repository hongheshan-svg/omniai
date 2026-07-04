import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiClient, Order } from "@gw-link-omniai/shared";
import { AdminAppShell } from "../appShell";
import { getAdminSessionBanner } from "../sessionModel";

afterEach(cleanup);

const orders: Order[] = [
  {
    id: "order_1",
    packageId: "credits-100",
    credits: 100,
    amountCents: 990,
    currency: "CNY",
    status: "paid",
    checkoutRef: "chk_1",
    createdAt: "2026-07-04T00:00:00.000Z"
  }
];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listModels: async () => [],
    listAllOrders: async () => orders,
    startLogin: async () => ({
      challengeId: "chal_1",
      channel: "email",
      maskedDestination: "a***@example.com",
      expiresAt: "2026-07-04T00:10:00.000Z"
    }),
    verifyLogin: async () => ({
      token: "tok_1",
      user: {
        id: "user_1",
        displayName: "admin",
        destination: "admin@example.com",
        channel: "email",
        plan: "studio",
        createdAt: "2026-07-04T00:00:00.000Z"
      },
      expiresAt: "2026-07-04T01:00:00.000Z"
    }),
    ...overrides
  } as unknown as ApiClient;
}

describe("AdminAppShell", () => {
  it("renders the operations modules required by the PRD and auth banner", () => {
    render(<AdminAppShell client={fakeClient()} />);

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

  it("logs in via the admin console and reveals the orders dashboard", async () => {
    render(<AdminAppShell client={fakeClient()} />);

    expect(await screen.findByText("请先登录")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "admin@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    fireEvent.change(await screen.findByLabelText("验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("order_1")).toBeTruthy();
    expect(screen.queryByText("请先登录")).toBeNull();
  });
});
