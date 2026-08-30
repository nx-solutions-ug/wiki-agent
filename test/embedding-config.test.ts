import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveConfig,
  saveGlobalConfig,
  createEmbeddingConfig,
  type GlobalConfig,
} from "../src/config.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-config-test-"));
}

describe("embedding config", () => {
  let homeBackup: string | undefined;
  let tempHome: string;
  let projectRoot: string;

  beforeEach(async () => {
    homeBackup = process.env.HOME;
    tempHome = await tempDir();
    process.env.HOME = tempHome;

    projectRoot = await tempDir();
    await mkdir(path.join(projectRoot, ".wiki"), { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = homeBackup;
    await rm(tempHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("resolveConfig includes embedding defaults", async () => {
    const config = await resolveConfig(projectRoot);
    expect(config.embeddingProvider).toBe("local");
    expect(config.embeddingModel).toBe("nomic-embed-text");
    expect(config.embeddingHost).toBe("http://localhost:11434");
  });

  test("resolveConfig reads embedding provider from global config", async () => {
    const globalConfig: GlobalConfig = {
      mode: "local",
      defaultModel: "kimi-k3",
      embeddingProvider: "ollama",
      embeddingModel: "mxbai-embed-large",
    };
    await saveGlobalConfig(globalConfig);

    const config = await resolveConfig(projectRoot);
    expect(config.embeddingProvider).toBe("ollama");
    expect(config.embeddingModel).toBe("mxbai-embed-large");
  });

  test("resolveConfig respects WIKI_EMBEDDING_PROVIDER env var", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, WIKI_EMBEDDING_PROVIDER: "ollama" };

    try {
      const config = await resolveConfig(projectRoot);
      expect(config.embeddingProvider).toBe("ollama");
    } finally {
      process.env = originalEnv;
    }
  });

  test("resolveConfig respects WIKI_EMBEDDING_MODEL env var", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, WIKI_EMBEDDING_MODEL: "bge-m3" };

    try {
      const config = await resolveConfig(projectRoot);
      expect(config.embeddingModel).toBe("bge-m3");
    } finally {
      process.env = originalEnv;
    }
  });

  test("resolveConfig respects WIKI_EMBEDDING_HOST env var", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, WIKI_EMBEDDING_HOST: "http://my-ollama:8080" };

    try {
      const config = await resolveConfig(projectRoot);
      expect(config.embeddingHost).toBe("http://my-ollama:8080");
    } finally {
      process.env = originalEnv;
    }
  });

  test("createEmbeddingConfig extracts embedding fields", async () => {
    const config = await resolveConfig(projectRoot);
    const embeddingConfig = createEmbeddingConfig(config);
    expect(embeddingConfig.provider).toBe("local");
    expect(embeddingConfig.ollamaModel).toBe("nomic-embed-text");
    expect(embeddingConfig.ollamaHost).toBe("http://localhost:11434");
  });
});