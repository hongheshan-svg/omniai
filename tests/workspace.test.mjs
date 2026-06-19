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

const packageManifests = [
  {
    path: "packages/shared/package.json",
    name: "@gw-link-omniai/shared"
  },
  {
    path: "apps/api/package.json",
    name: "@gw-link-omniai/api"
  },
  {
    path: "apps/admin/package.json",
    name: "@gw-link-omniai/admin"
  },
  {
    path: "apps/desktop/package.json",
    name: "@gw-link-omniai/desktop"
  },
  {
    path: "apps/mobile/package.json",
    name: "@gw-link-omniai/mobile"
  }
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test("workspace skeleton has required package manifests", () => {
  for (const path of requiredPaths) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});

test("root package declares expected workspaces", () => {
  const rootPackage = readJson("package.json");

  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.name, "gw-link-omniai");
  assert.equal(rootPackage.packageManager, "pnpm@9.15.0");
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*"]);
});

test("pnpm workspace includes apps and packages", () => {
  const workspaceConfig = readFileSync("pnpm-workspace.yaml", "utf8");

  assert.match(workspaceConfig, /apps\/\*/);
  assert.match(workspaceConfig, /packages\/\*/);
});

test("gitignore keeps isolated worktrees out of source control", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(gitignore, /^\.worktrees\/$/m);
});

test("workspace package manifests declare expected contract", () => {
  for (const { path, name } of packageManifests) {
    const manifest = readJson(path);

    assert.equal(manifest.name, name);
    assert.equal(manifest.private, true);
    assert.equal(manifest.type, "module");
    assert.equal(manifest.scripts.test, "vitest run --passWithNoTests");
  }
});
