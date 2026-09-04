import { describe, expect, test, beforeEach, afterEach, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  saveProjectConfig,
  resolveConfig,
  createLLMClient,
  type GlobalConfig,
  getGlobalConfigDir,
  defaultBaseUrl,
  type ProviderMode,
} from "../src/config.js";
import { OllamaAdapter, OpenAIAdapter } from "../src/llm.js";

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
      expect(config.defaultModel).toBe("glm-5.3-flash");
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

    test("returns default config when file contains invalid JSON", async () => {
      const dir = getGlobalConfigDir();
      await mkdir(dir, { recursive: true });
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, "this is not valid json", "utf8");

      const config = await loadGlobalConfig();
      expect(config.mode).toBe("local");
      expect(config.defaultModel).toBe("glm-5.3-flash");
    });
  });

  describe("saveGlobalConfig", () => {
    test("creates directory and writes config with 0o600 permissions", async () => {
      await saveGlobalConfig({ mode: "local", defaultModel: "glm-5.3-flash" });
      const configPath = path.join(getGlobalConfigDir(), "config.json");
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

      expect(config.model).toBe("glm-5.3-flash");
      await rm(projectRoot, { recursive: true, force: true });
    });
  });
});

describe("resolveConfig precedence", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("prioritizes WIKI_PROVIDER_MODE over WIKI_OLLAMA_MODE", async () => {
    process.env.WIKI_PROVIDER_MODE = "openai";
    process.env.WIKI_OLLAMA_MODE = "cloud";
    const config = await resolveConfig("/fake/path");
    expect(config.mode).toBe("openai");
  });

  it("falls back to WIKI_OLLAMA_MODE if WIKI_PROVIDER_MODE is missing", async () => {
    delete process.env.WIKI_PROVIDER_MODE;
    process.env.WIKI_OLLAMA_MODE = "cloud";
    const config = await resolveConfig("/fake/path");
    expect(config.mode).toBe("cloud");
  });

  it("resolves baseUrl for openai correctly", async () => {
    process.env.WIKI_PROVIDER_MODE = "openai";
    const config = await resolveConfig("/fake/path");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("resolves baseUrl for cloud correctly", async () => {
    process.env.WIKI_PROVIDER_MODE = "cloud";
    const config = await resolveConfig("/fake/path");
    expect(config.baseUrl).toBe("https://ollama.com");
  });

  it("prioritizes WIKI_PROVIDER_API_KEY over WIKI_OLLAMA_API_KEY", async () => {
    process.env.WIKI_PROVIDER_API_KEY = "provider-key";
    process.env.WIKI_OLLAMA_API_KEY = "ollama-key";
    const config = await resolveConfig("/fake/path");
    expect(config.apiKey).toBe("provider-key");
  });

  it("falls back to WIKI_OLLAMA_API_KEY when WIKI_PROVIDER_API_KEY is missing", async () => {
    delete process.env.WIKI_PROVIDER_API_KEY;
    process.env.WIKI_OLLAMA_API_KEY = "ollama-key";
    const config = await resolveConfig("/fake/path");
    expect(config.apiKey).toBe("ollama-key");
  });

  it("prioritizes WIKI_PROVIDER_BASE_URL over WIKI_OLLAMA_BASE_URL", async () => {
    process.env.WIKI_PROVIDER_BASE_URL = "https://provider.example/v1";
    process.env.WIKI_OLLAMA_BASE_URL = "https://ollama.example";
    const config = await resolveConfig("/fake/path");
    expect(config.baseUrl).toBe("https://provider.example/v1");
  });

  it("WIKI_OLLAMA_BASE_URL overrides the default Ollama host", async () => {
    process.env.WIKI_PROVIDER_MODE = "cloud";
    process.env.WIKI_OLLAMA_BASE_URL = "https://custom-ollama.example";
    const config = await resolveConfig("/fake/path");
    expect(config.baseUrl).toBe("https://custom-ollama.example");
  });
});

describe("createLLMClient", () => {
  it("creates OpenAIAdapter for openai mode", () => {
    const client = createLLMClient({ mode: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "test_key", model: "test" });
    expect(client).toBeInstanceOf(OpenAIAdapter);
  });

  it("creates OllamaAdapter for cloud mode", () => {
    const client = createLLMClient({ mode: "cloud", baseUrl: "https://ollama.com", apiKey: "test", model: "test" });
    expect(client).toBeInstanceOf(OllamaAdapter);
  });

  it("creates OllamaAdapter for local mode", () => {
    const client = createLLMClient({ mode: "local", baseUrl: "http://localhost:11434", model: "test" });
    expect(client).toBeInstanceOf(OllamaAdapter);
  });
});

describe("defaultBaseUrl", () => {
  it("returns DEFAULT_OPENAI_HOST for openai mode", () => {
    expect(defaultBaseUrl("openai")).toBe("https://api.openai.com/v1");
  });

  it("returns DEFAULT_CLOUD_HOST for cloud mode", () => {
    expect(defaultBaseUrl("cloud")).toBe("https://ollama.com");
  });

  it("returns DEFAULT_LOCAL_HOST for local mode", () => {
    expect(defaultBaseUrl("local")).toBe("http://localhost:11434");
  });

  it("returns DEFAULT_LOCAL_HOST for unknown/default mode", () => {
    expect(defaultBaseUrl("unknown" as unknown as ProviderMode)).toBe("http://localhost:11434");
  });
});
