---
type: Reference
title: Configuration
description: Global and project config files, environment variable overrides, and how the effective configuration is resolved.
tags: [config, environment-variables, ollama, openai, resolution-order]
---

# Configuration

Wiki Agent merges configuration from several sources. The exact precedence is field-specific and is implemented in `resolveConfig(projectRoot, modelOverride?)` in `src/config.ts`:

- `mode`: `WIKI_PROVIDER_MODE` (or legacy `WIKI_OLLAMA_MODE`) if valid (`"local"`, `"cloud"`, or `"openai"`) → global config `mode` → built-in `"local"`.
- `apiKey`: `WIKI_PROVIDER_API_KEY` (or legacy `WIKI_OLLAMA_API_KEY`) → global config `apiKey` → unset.
- `baseUrl`: `WIKI_PROVIDER_BASE_URL` (or legacy `WIKI_OLLAMA_BASE_URL`) → global config `baseUrl` → mode default (see below).
- `model`: `--model` CLI flag → `.wiki/config.json` `modelOverride` → `WIKI_MODEL` environment variable → `~/.wiki/config.json` `defaultModel` → built-in `kimi-k2.7-code`.
- `embeddingProvider`: `WIKI_EMBEDDING_PROVIDER` if valid (`"local"` or `"ollama"`) → global config `embeddingProvider` → built-in `"local"`.
- `embeddingModel`: `WIKI_EMBEDDING_MODEL` → global config `embeddingModel` → built-in `nomic-embed-text`.
- `embeddingHost`: `WIKI_EMBEDDING_HOST` → global config `embeddingHost` → built-in `http://localhost:11434`.

## Global config: `~/.wiki/config.json`

Lives in the user's home directory. Created and updated by the TUI's credentials setup wizard (`src/tui/CredentialsSetup.tsx`). The file is written with mode `0o600` because it may contain an API key.

```json
{
  "mode": "local",
  "defaultModel": "kimi-k2.7-code",
  "embeddingProvider": "local",
  "embeddingModel": "nomic-embed-text",
  "embeddingHost": "http://localhost:11434"
}
```

For cloud mode:

```json
{
  "mode": "cloud",
  "apiKey": "your-api-key",
  "defaultModel": "kimi-k2.7-code",
  "embeddingProvider": "local",
  "embeddingModel": "nomic-embed-text",
  "embeddingHost": "http://localhost:11434"
}
```

For an OpenAI-compatible endpoint:

```json
{
  "mode": "openai",
  "apiKey": "your-api-key",
  "baseUrl": "https://api.openai.com/v1",
  "defaultModel": "kimi-k2.7-code",
  "embeddingProvider": "local",
  "embeddingModel": "nomic-embed-text",
  "embeddingHost": "http://localhost:11434"
}
```

The `defaultGlobalConfig()` helper returns `{ mode: "local", defaultModel: "kimi-k2.7-code", embeddingProvider: "local", embeddingModel: "nomic-embed-text", embeddingHost: "http://localhost:11434" }` when the file is absent or unreadable. `loadGlobalConfig` swallows parse errors and falls back to the default.

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

`resolveConfig` produces a `ResolvedConfig` (`{ mode, apiKey?, baseUrl, model, embeddingProvider, embeddingModel, embeddingHost }`):

- `mode` — `WIKI_PROVIDER_MODE` (or legacy `WIKI_OLLAMA_MODE`) if valid (`"local"`, `"cloud"`, or `"openai"`), otherwise the global config's `mode`.
- `apiKey` — `WIKI_PROVIDER_API_KEY` (or legacy `WIKI_OLLAMA_API_KEY`) if set, otherwise the global config's `apiKey`.
- `baseUrl` — `WIKI_PROVIDER_BASE_URL` (or legacy `WIKI_OLLAMA_BASE_URL`) if set, otherwise the global config's `baseUrl`, otherwise the mode's default.
- `model` — `modelOverride` arg (the `--model` flag) → `projectConfig.modelOverride` → `WIKI_MODEL` → `globalConfig.defaultModel` → `"kimi-k2.7-code"`.
- `embeddingProvider` — `WIKI_EMBEDDING_PROVIDER` if `"local"` or `"ollama"`, otherwise `globalConfig.embeddingProvider` → `"local"`.
- `embeddingModel` — `WIKI_EMBEDDING_MODEL` → `globalConfig.embeddingModel` → `"nomic-embed-text"`.
- `embeddingHost` — `WIKI_EMBEDDING_HOST` → `globalConfig.embeddingHost` → `"http://localhost:11434"`.

## Provider client construction

`createLLMClient` in `config.ts` produces the SDK client used by the agent:

- `openai` mode: `new OpenAIAdapter(new OpenAI({ apiKey, baseURL: baseUrl }))`.
- `cloud` mode with an API key: `new OllamaAdapter(new Ollama({ host: baseUrl, headers: { Authorization: \`Bearer ${apiKey}\` } }))`.
- `local` mode: `new OllamaAdapter(new Ollama({ host: baseUrl }))`.

The TUI and headless runner both use this factory, so there is exactly one code path for building the client.

## Embedding configuration

`createEmbeddingConfig(config)` extracts embedding-specific settings from a resolved config and is consumed by `createEmbedder` in `src/embeddings.ts`.

| Backend | Provider value | Model default | Host default |
|---------|----------------|---------------|--------------|
| **Local** (`local`) | Transformers.js + `Xenova/all-MiniLM-L6-v2` (384-dim, on-device) | n/a | n/a |
| **Ollama** (`ollama`) | Configurable embedding model (probed at startup) | `nomic-embed-text` | `http://localhost:11434` |

Local embeddings cache downloaded model weights under `~/.wiki/model-cache` via `TRANSFORMERS_CACHE`. Ollama embeddings probe the configured model once to discover its dimension and reuse that value for the SQLite `sqlite-vec` table schema.

## Provider defaults

`defaultBaseUrl(mode)` in `config.ts` is the single source of truth for provider-specific base URLs:

| Mode | Default base URL |
|------|------------------|
| `"local"` | `http://localhost:11434` |
| `"cloud"` | `https://ollama.com` |
| `"openai"` | `https://api.openai.com/v1` |

## Limits

Constants in `config.ts`:

- `DEFAULT_MODEL = "kimi-k2.7-code"` — fallback LLM model ID.
- `DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"` — fallback Ollama embedding model.
- `MAX_TOOL_RESULT_LENGTH = 10_000` — truncation ceiling for any tool result string.

A separate `MAX_READ_LENGTH = 50_000` lives in `tools.ts` and bounds `read_file` returns before the global tool-result truncation step.

## Project config loading

`loadProjectConfig` reads `.wiki/config.json` and swallows parse errors (returning `{}` on failure). `saveProjectConfig` creates the `.wiki/` directory if needed and writes the JSON file. Only `modelOverride` is currently consumed by `resolveConfig`; `lastUpdate` is reserved.

## MCP server wiring

The MCP server (`src/mcp-server.ts`) uses the same `resolveConfig` and `createLLMClient` paths for update runs, and uses `createEmbeddingConfig` plus a per-`projectRoot` embedder cache to serve semantic search without re-initializing the model pipeline on every request.
