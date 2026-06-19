import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminAppShell } from "../appShell";

describe("AdminAppShell", () => {
  it("renders the operations modules required by the PRD", () => {
    render(<AdminAppShell />);

    expect(screen.getByText("GW-LINK OmniAI Admin")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Plans & Credits")).toBeTruthy();
    expect(screen.getByText("Model Display")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Usage Metrics")).toBeTruthy();
  });
});
