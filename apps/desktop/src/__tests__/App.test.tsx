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

  it("switches to the Video Studio optimization fixture", () => {
    render(<App />);

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));

    const optimizationResult = screen.getByLabelText("提示词优化结果");
    expect(within(optimizationResult).getByText("镜头运动")).toBeTruthy();
    expect(within(optimizationResult).getByText("gw-video-motion")).toBeTruthy();
    expect(within(optimizationResult).getByText("预计点数：18 credits")).toBeTruthy();
    const submitButton = screen.getByRole<HTMLButtonElement>("button", { name: "提交生成" });
    expect(submitButton.disabled).toBe(false);
  });

  it("submits the default Text Studio task into the task center", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    expect(within(taskCenter).getByText("文本创作")).toBeTruthy();
    expect(within(taskCenter).getByText("排队中")).toBeTruthy();
    expect(within(taskCenter).getByText("gw-text-balanced")).toBeTruthy();
    expect(within(taskCenter).getByText("预计点数：1 credit")).toBeTruthy();
    expect(within(taskCenter).getByText("帮我写一个咖啡店新品发布文案")).toBeTruthy();
  });

  it("keeps submitted tasks when switching modes and appends video tasks", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    fireEvent.click(within(modeNavigation).getByRole("button", { name: "视频创作" }));
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    expect(within(taskCenter).getByText("文本创作")).toBeTruthy();
    expect(within(taskCenter).getByText("视频创作")).toBeTruthy();
    expect(within(taskCenter).getByText("gw-video-motion")).toBeTruthy();
    expect(within(taskCenter).getByText("预计点数：18 credits")).toBeTruthy();
    expect(within(taskCenter).getAllByText("排队中")).toHaveLength(2);
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
