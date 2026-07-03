import { readFileSync } from "node:fs";
import type { CreditPackage } from "@gw-link-omniai/shared";

export interface PackageCatalogConfig {
  packages: CreditPackage[];
}

export class PackageCatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PackageCatalogError";
  }
}

export interface PackageCatalog {
  listPackages(): CreditPackage[];
  getPackage(id: string): CreditPackage;
}

function clonePackage(pkg: CreditPackage): CreditPackage {
  return { ...pkg };
}

export class ConfigPackageCatalog implements PackageCatalog {
  private readonly packages: CreditPackage[];

  constructor(config: PackageCatalogConfig) {
    this.packages = config.packages.map(clonePackage);
  }

  listPackages(): CreditPackage[] {
    return this.packages.map(clonePackage);
  }

  getPackage(id: string): CreditPackage {
    const found = this.packages.find((pkg) => pkg.id === id);
    if (!found) {
      throw new PackageCatalogError(`Unknown package: ${id}`, 404);
    }
    return clonePackage(found);
  }
}

export function loadPackageCatalogConfig(path: string): PackageCatalogConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as PackageCatalogConfig;
  return parsed;
}
