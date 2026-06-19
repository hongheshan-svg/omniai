import { describe, expect, it } from "vitest";
import { getMobileHomeActions } from "../homeModel";

describe("getMobileHomeActions", () => {
  it("returns the mobile-first creation and history actions", () => {
    expect(getMobileHomeActions()).toEqual([
      "Text Chat",
      "Image Generation",
      "Video Generation",
      "Creation History",
      "Task Notifications"
    ]);
  });
});
