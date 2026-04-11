import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { loadBaseToolRegistry, resolvePackageRegistryProvidersDir } from "../src/tool-registry.js";

async function createTempRegistryPackage() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-tool-registry-"));
  const projectNodeModulesDir = path.join(rootDir, "project", "node_modules");
  const runeflowDir = path.join(projectNodeModulesDir, "runeflow");
  const registryDir = path.join(projectNodeModulesDir, "runeflow-registry");
  const providersDir = path.join(registryDir, "providers");

  await fs.mkdir(path.join(runeflowDir, "src"), { recursive: true });
  await fs.mkdir(path.join(providersDir, "acme"), { recursive: true });
  await fs.writeFile(
    path.join(registryDir, "package.json"),
    JSON.stringify({ name: "runeflow-registry", type: "module" }),
  );
  await fs.writeFile(path.join(registryDir, "index.js"), "export {};\n");

  return {
    rootDir,
    moduleUrl: pathToFileURL(path.join(runeflowDir, "src", "tool-registry.js")).href,
    registryDir,
    providersDir,
  };
}

test("resolvePackageRegistryProvidersDir resolves providers from runeflow-registry package", async () => {
  const fixture = await createTempRegistryPackage();

  const resolved = resolvePackageRegistryProvidersDir({
    moduleUrl: fixture.moduleUrl,
    resolvePackage: () => pathToFileURL(path.join(fixture.registryDir, "index.js")).href,
  });

  assert.equal(resolved, fixture.providersDir);
});

test("resolvePackageRegistryProvidersDir falls back to flat node_modules layout", async () => {
  const fixture = await createTempRegistryPackage();

  const resolved = resolvePackageRegistryProvidersDir({
    moduleUrl: fixture.moduleUrl,
    resolvePackage: () => {
      throw new Error("resolution unavailable");
    },
  });

  assert.equal(resolved, fixture.providersDir);
});

test("loadBaseToolRegistry loads schemas from an installed runeflow-registry package", async () => {
  const fixture = await createTempRegistryPackage();
  const schemaName = "acme.example_tool";
  await fs.writeFile(
    path.join(fixture.providersDir, "acme", "schemas.json"),
    JSON.stringify([{ name: schemaName, description: "Example tool" }]),
  );

  const registry = loadBaseToolRegistry({
    packageRegistryProvidersDir: fixture.providersDir,
    registryDir: path.join(fixture.rootDir, "missing-user-registry"),
  });

  assert.equal(registry.get(schemaName)?.description, "Example tool");
});
