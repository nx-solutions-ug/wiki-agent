import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  saveProjectConfig,
  resolveConfig,
  type GlobalConfig,
} from "../src/config.ts";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-test-"));
}

describe("config", () => {
  let homeBackup: string | undefined;
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await tempDir();
    homeBackup = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(async () => {
    if (homeBackup !== undefined) {
      process.env.HOME = homeBackup;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  describe("loadGlobalConfig", () => {
    test("returns default config when file does not exist", async () => {
      const config = await loadGlobalConfig();
      expect(config.mode).toBe("local");
      expect(config.defaultModel).toBe("kimi-k2.7-code");
    });

    test("reads existing config file", async () => {
      const config: GlobalConfig = {
        mode: "cloud",
        apiKey: "test-key",
        defaultModel: "llama3.2",
      };
      await saveGlobalConfig(config);

      const loaded = await loadGlobalConfig();
      expect(loaded.mode).toBe("cloud");
      expect(loaded.apiKey).toBe("test-key");
      expect(loaded.defaultModel).toBe("llama3.2");
    });
  });

  describe("saveGlobalConfig", () => {
    test("creates directory and writes config with 0o600 permissions", async () => {
      await saveGlobalConfig({ mode: "local", defaultModel: "kimi-k2.7-code" });
      const configPath = path.join(tempHome, ".wiki", "config.json");
      const content = await readFile(configPath, "utf8");
      expect(JSON.parse(content).mode).toBe("local");
    });
  });

  describe("project config", () => {
    test("returns empty config when file does not exist", async () => {
      const projectRoot = await tempDir();
      const config = await loadProjectConfig(projectRoot);
      expect(config).toEqual({});
      await rm(projectRoot, { recursive: true, force: true });
    });

    test("writes and reads project config", async () => {
      const projectRoot = await tempDir();
      await saveProjectConfig(projectRoot, {
        modelOverride: "llama3.2",
        lastUpdate: { commitSha: "abc123", timestamp: "2026-01-01T00:00:00Z" },
      });

      const loaded = await loadProjectConfig(projectRoot);
      expect(loaded.modelOverride).toBe("llama3.2");
      expect(loaded.lastUpdate?.commitSha).toBe("abc123");
      await rm(projectRoot, { recursive: true, force: true });
    });
  });

  describe("resolveConfig", () => {
    test("env vars override global config", async () => {
      process.env.WIKI_OLLAMA_MODE = "cloud";
      process.env.WIKI_OLLAMA_API_KEY = "env-key";
      process.env.WIKI_MODEL = "llama3.2";

      const projectRoot = await tempDir();
      const config = await resolveConfig(projectRoot);

      expect(config.mode).toBe("cloud");
      expect(config.apiKey).toBe("env-key");
      expect(config.model).toBe("llama3.2");

      delete process.env.WIKI_OLLAMA_MODE;
      delete process.env.WIKI_OLLAMA_API_KEY;
      delete process.env.WIKI_MODEL;
      await rm(projectRoot, { recursive: true, force: true });
    });

    test("modelOverride param takes priority over env and config", async () => {
      process.env.WIKI_MODEL = "env-model";
      const projectRoot = await tempDir();
      const config = await resolveConfig(projectRoot, "cli-model");

      expect(config.model).toBe("cli-model");

      delete process.env.WIKI_MODEL;
      await rm(projectRoot, { recursive: true, force: true });
    });

    test("falls back to global config default model", async () => {
      const projectRoot = await tempDir();
      const config = await resolveConfig(projectRoot);

      expect(config.model).toBe("kimi-k2.7-code");
      await rm(projectRoot, { recursive: true, force: true });
    });
  });
});