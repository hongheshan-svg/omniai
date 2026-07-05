import { describe, expect, it } from "vitest";
import { getIndustryTemplates, listIndustries, templatesForIndustry } from "../templatesModel";

describe("templatesModel", () => {
  it("provides at least 12 templates across 6 industries, 2+ each", () => {
    const templates = getIndustryTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(12);
    const industries = listIndustries();
    expect(industries).toEqual(["电商", "广告", "建筑", "游戏", "影视", "时尚"]);
    for (const industry of industries) {
      expect(templatesForIndustry(industry).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every template an id, title, non-trivial prompt and valid mode", () => {
    for (const template of getIndustryTemplates()) {
      expect(template.id).toMatch(/^[a-z0-9-]+$/);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.prompt.length).toBeGreaterThan(20);
      expect(["text", "image", "video"]).toContain(template.mode);
    }
  });

  it("has unique template ids", () => {
    const ids = getIndustryTemplates().map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns clones so callers cannot mutate internal data", () => {
    getIndustryTemplates()[0].title = "mutated";
    expect(getIndustryTemplates()[0].title).not.toBe("mutated");
    templatesForIndustry("电商")[0].prompt = "mutated";
    expect(templatesForIndustry("电商")[0].prompt).not.toBe("mutated");
  });
});
