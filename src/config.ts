import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Ollama } from "ollama";
import OpenAI from "openai";
import { type LLMClient, OpenAIAdapter, OllamaAdapter } from "./llm.js";

export type ProviderMode = "local" | "cloud" | "openai";

export interface GlobalConfig {
  mode: ProviderMode;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
}

export interface ProjectConfig {
  modelOverride?: string;
  lastUpdate?: { commitSha: string; timestamp: string };
}

export interface ResolvedConfig {
  mode: ProviderMode;
  apiKey?: string;
  baseUrl: string;
  model: string;
}

function getGlobalConfigDir(): string {
  return path.join(os.homedir(), ".wiki");
}
function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), "config.json");
}

const DEFAULT_LOCAL_HOST = "http://localhost:11434";
const DEFAULT_CLOUD_HOST = "https://ollama.com";
const DEFAULT_MODEL = "kimi-k2.7-code";

const MAX_TOOL_RESULT_LENGTH = 10_000;

function defaultGlobalConfig(): GlobalConfig {
  return { mode: "local", defaultModel: DEFAULT_MODEL };
}

export { getGlobalConfigDir };

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  try {
    const raw = await readFile(getGlobalConfigPath(), "utf8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return defaultGlobalConfig();
  }
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const dir = getGlobalConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const configPath = getGlobalConfigPath();
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  await chmod(configPath, 0o600);
}

export async function loadProjectConfig(
  projectRoot: string,
): Promise<ProjectConfig> {
  const configPath = path.join(projectRoot, ".wiki", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return {};
  }
}

export async function saveProjectConfig(
  projectRoot: string,
  config: ProjectConfig,
): Promise<void> {
  const configDir = path.join(projectRoot, ".wiki");
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Resolves the effective configuration by merging (in priority order):
 * 1. Environment variables (WIKI_PROVIDER_MODE, WIKI_PROVIDER_API_KEY,
 *    WIKI_PROVIDER_BASE_URL, WIKI_OLLAMA_MODE, WIKI_OLLAMA_API_KEY,
 *    WIKI_OLLAMA_BASE_URL, WIKI_MODEL)
 * 2. Global config file (~/.wiki/config.json)
 * 3. Project config (.wiki/config.json modelOverride)
 * 4. Built-in defaults
 */
export async function resolveConfig(
  projectRoot: string,
  modelOverride?: string,
): Promise<ResolvedConfig> {
  const globalConfig = await loadGlobalConfig();
  const projectConfig = await loadProjectConfig(projectRoot);

  const env = process.env;

  let mode = globalConfig.mode;
  if (env.WIKI_PROVIDER_MODE === "cloud" || env.WIKI_PROVIDER_MODE === "local" || env.WIKI_PROVIDER_MODE === "openai") {
    mode = env.WIKI_PROVIDER_MODE as ProviderMode;
  } else if (env.WIKI_OLLAMA_MODE === "cloud" || env.WIKI_OLLAMA_MODE === "local" || env.WIKI_OLLAMA_MODE === "openai") {
    mode = env.WIKI_OLLAMA_MODE as ProviderMode;
  }

  const apiKey =
    (env.WIKI_PROVIDER_API_KEY || env.WIKI_OLLAMA_API_KEY) ?? globalConfig.apiKey;

  const baseUrl =
    (env.WIKI_PROVIDER_BASE_URL || env.WIKI_OLLAMA_BASE_URL) ??
    globalConfig.baseUrl ??
    (mode === "openai" ? "https://api.openai.com/v1" : mode === "cloud" ? DEFAULT_CLOUD_HOST : DEFAULT_LOCAL_HOST);

  const model =
    modelOverride ??
    projectConfig.modelOverride ??
    env.WIKI_MODEL ??
    globalConfig.defaultModel ??
    DEFAULT_MODEL;

  return { mode, apiKey, baseUrl, model };
}

/**
 * Creates an LLM client (Ollama or OpenAI) from resolved config.
 */
export function createLLMClient(config: ResolvedConfig): LLMClient {
  if (config.mode === "openai") {
    return new OpenAIAdapter(new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    }));
  }
  if (config.mode === "cloud" && config.apiKey) {
    return new OllamaAdapter(new Ollama({
      host: config.baseUrl,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }));
  }

  return new OllamaAdapter(new Ollama({ host: config.baseUrl }));
}

export function truncateResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) {
    return result;
  }

  return result.slice(0, MAX_TOOL_RESULT_LENGTH) + "\n... (truncated)";
}

export { DEFAULT_MODEL, MAX_TOOL_RESULT_LENGTH };