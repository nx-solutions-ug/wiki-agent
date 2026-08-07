---
type: Reference
title: Configuration
description: Global and project config files, environment variable overrides, and how the effective configuration is resolved.
tags: [config, environment-variables, ollama, openai, resolution-order]
---

# Configuration

Wiki Agent merges configuration from several sources. The exact precedence is field-specific and is implemented in `resolveConfig(projectRoot, modelOverride?)` in `src/config.ts`:

- `mode`: `WIKI_PROVIDER_MODE` if valid (`"local"`, `"cloud"`, or `"openai"`) → `WIKI_OLLAMA_MODE` if valid → global config `mode` → built-in `"local"`.
- `apiKey`: `WIKI_PROVIDER_API_KEY` → `WIKI_OLLAMA_API_KEY` → global config `apiKey` → unset.
- `baseUrl`: `WIKI_PROVIDER_BASE_URL` → `WIKI_OLLAMA_BASE_URL` → global config `baseUrl` → mode default (`http://localhost:11434` for local, `https://ollama.com` for cloud, `https://api.openai.com/v1` for openai).
- `model`: `--model` CLI flag → `.wiki/config.json` `modelOverride` → `WIKI_MODEL` environment variable → `~/.wiki/config.json` `defaultModel` → built-in `kimi-k2.7-code`.

## Global config: `~/.wiki/config.json`

Lives in the user's home directory. Created and updated by the TUI's credentials setup wizard (`src/tui/CredentialsSetup.tsx`). The file is written with mode `0o600` because it may contain an API key.

```json
{
  "mode": "local",
  "defaultModel": "kimi-k2.7-code"
}
```

For cloud mode:

```json
{
  "mode": "cloud",
  "apiKey": "your-api-key",
  "defaultModel": "kimi-k2.7-code"
}
```

For OpenAI or any OpenAI-compatible endpoint:

```json
{
  "mode": "openai",
  "apiKey": "your-openai-api-key",
  "baseUrl": "https://api.openai.com/v1",
  "defaultModel": "gpt-4o"
}
```

The `defaultGlobalConfig()` helper returns `{ mode: "local", defaultModel: "kimi-k2.7-code" }` when the file is absent or unreadable. `loadGlobalConfig` swallows parse errors and falls back to the default.

## Project config: `.wiki/config.json`

Lives inside the wiki output directory. Currently only two fields are read:

```json
{
  "modelOverride": "llama3.2",
  "lastUpdate": {
    "commitSha": "abc1234",
    "timestamp": "2026-07-17T00:00:00Z"
  }
}
```

`modelOverride` is the per-project pin for the model. `lastUpdate` is reserved for future change-detection; the agent does not yet read it.

## Resolution order

`resolveConfig` produces a `ResolvedConfig` (`{ mode, apiKey?, baseUrl, model }`):

- `mode` — `WIKI_PROVIDER_MODE` if valid (`"local"`, `"cloud"`, or `"openai"`), otherwise `WIKI_OLLAMA_MODE` if valid, otherwise the global config's `mode`.
- `apiKey` — `WIKI_PROVIDER_API_KEY` if set, otherwise `WIKI_OLLAMA_API_KEY`, otherwise the global config's `apiKey`.
- `baseUrl` — `WIKI_PROVIDER_BASE_URL` if set, otherwise `WIKI_OLLAMA_BASE_URL`, otherwise the global config's `baseUrl`, otherwise the mode's default.
- `model` — `modelOverride` arg (the `--model` flag) → `projectConfig.modelOverride` → `WIKI_MODEL` → `globalConfig.defaultModel` → `"kimi-k2.7-code"`.

## LLM client construction

`createLLMClient` in `config.ts` produces the SDK client used by the agent. It returns an adapter that exposes a common `chat` interface for both Ollama and OpenAI:

- OpenAI-compatible mode: `new OpenAIAdapter(new OpenAI({ apiKey, baseURL: baseUrl }))`.
- Ollama cloud mode with an API key: `new OllamaAdapter(new Ollama({ host, headers: { Authorization: \`Bearer ${apiKey}\` } }))`.
- Ollama local mode: `new OllamaAdapter(new Ollama({ host }))`.

The TUI and headless runner both use this factory, so there is exactly one code path for building the client.

## Limits

Two constants live in `config.ts` and are re-exported for tools:

- `DEFAULT_MODEL = "kimi-k2.7-code"` — fallback model ID.
- `MAX_TOOL_RESULT_LENGTH = 10_000` — truncation ceiling for any tool result string.

A separate `MAX_READ_LENGTH = 50_000` lives in `tools.ts` and bounds `read_file` returns before the global tool-result truncation step.

## Project config loading

`loadProjectConfig` reads `.wiki/config.json` and swallows parse errors (returning `{}` on failure). `saveProjectConfig` creates the `.wiki/` directory if needed and writes the JSON file. Only `modelOverride` is currently consumed by `resolveConfig`; `lastUpdate` is reserved.
