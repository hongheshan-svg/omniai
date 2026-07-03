import { describe, expect, it } from "vitest";
import { ConfigPackageCatalog, PackageCatalogError } from "../packageCatalog";

const config = {
  packages: [
    { id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" },
    { id: "credits-500", displayName: "500 积分", credits: 500, amountCents: 4500, currency: "CNY" }
  ]
};

describe("ConfigPackageCatalog", () => {
  it("lists all packages", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(catalog.listPackages().map((p) => p.id)).toEqual(["credits-100", "credits-500"]);
  });
  it("gets a package by id", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(catalog.getPackage("credits-500").credits).toBe(500);
  });
  it("throws a 404 catalog error for an unknown id", () => {
    const catalog = new ConfigPackageCatalog(config);
    expect(() => catalog.getPackage("nope")).toThrowError(PackageCatalogError);
    try {
      catalog.getPackage("nope");
    } catch (error) {
      expect((error as PackageCatalogError).statusCode).toBe(404);
    }
  });
  it("returns copies so callers cannot mutate catalog state", () => {
    const catalog = new ConfigPackageCatalog(config);
    catalog.listPackages()[0].credits = 1;
    expect(catalog.getPackage("credits-100").credits).toBe(100);
  });
});
