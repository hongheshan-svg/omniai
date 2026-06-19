import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredPaths = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "packages/shared/package.json",
  "apps/api/package.json",
  "apps/admin/package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json"
];

test("workspace skeleton has required package manifests", () => {
  for (const path of requiredPaths) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});

test("root package declares expected workspaces", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.name, "gw-link-omniai");
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*"]);
});
