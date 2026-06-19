import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("Desktop App", () => {
  it("renders the three core creation modes", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    expect(screen.getByText("Text Chat")).toBeTruthy();
    expect(screen.getByText("Image Generation")).toBeTruthy();
    expect(screen.getByText("Video Generation")).toBeTruthy();
  });
});
