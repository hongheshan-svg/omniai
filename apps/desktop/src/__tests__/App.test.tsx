import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { getDesktopSessionCta } from "../sessionModel";

afterEach(cleanup);

describe("Desktop App", () => {
  it("renders the product-first studio shell and sign-in entry", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    expect(within(modeNavigation).getByRole("button", { name: "文本创作" })).toBeTruthy();
    expect(within(modeNavigation).getByRole("button", { name: "图片创作" })).toBeTruthy();
    expect(within(modeNavigation).getByRole("button", { name: "视频创作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("defaults to the Text Studio optimization fixture", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "文本创作" })).toBeTruthy();
    expect(screen.getByLabelText("文本创作需求")).toBeTruthy();
    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("写作目标")).toBeTruthy();
    expect(within(optimizationResult).getByText("gw-text-balanced")).toBeTruthy();
    expect(within(optimizationResult).getByText("预计点数：1 credit")).toBeTruthy();
  });

  it("switches to the Image Studio optimization fixture", () => {
    render(<App />);

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "图片创作" }));

    expect(screen.getByRole("heading", { name: "图片创作" })).toBeTruthy();
    expect(screen.getByLabelText("图片创作需求")).toBeTruthy();
    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("负向提示词")).toBeTruthy();
    expect(within(optimizationResult).getByText("gw-image-creative")).toBeTruthy();
    expect(within(optimizationResult).getByText("预计点数：2 credits")).toBeTruthy();
  });

  it("switches to the Video Studio optimization fixture with generation submit disabled", () => {
    render(<App />);

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));

    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("镜头运动")).toBeTruthy();
    expect(within(optimizationResult).getByText("gw-video-motion")).toBeTruthy();
    expect(within(optimizationResult).getByText("预计点数：18 credits")).toBeTruthy();
    const submitButton = screen.getByRole<HTMLButtonElement>("button", { name: "提交生成（待接入）" });
    expect(submitButton.disabled).toBe(true);
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
