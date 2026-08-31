---
type: Reference
title: Configuration
description: Global and project config files, environment variable overrides,
  and how the effective configuration is resolved.
tags: [ config, environment-variables, ollama, openai, resolution-order ]
last_updated: 2026-08-31T16:04:55.864Z
updated_by: wiki-agent
---

# Configuration

Wiki Agent merges configuration from several sources. The exact precedence is field-specific and is implemented in `resolveConfig(projectRoot, modelOverride?)` in `src/config.ts`. Frontmatter authorship for `.wiki/` writes is resolved separately by `resolveUpdatedBy` in `src/cli-helpers.ts` (see [Tools](./tools.md)); that resolver honors `WIKI_UPDATED_BY`, `WIKI_MCP`, `WIKI_AUTOMATED`, and the generic `CI`/`GITHUB_ACTIONS` variables in addition to `git config user.name`.

The field-by-field precedence of `resolveConfig`:

- `mode`: `WIKI_PROVIDER_MODE` (or legacy `WIKI_OLLAMA_MODE`) if valid (`"local"`, `"cloud"`, or `"openai"`) → global config `mode` → built-in `"local"`.
- `apiKey`: `WIKI_PROVIDER_API_KEY` (or legacy `WIKI_OLLAMA_API_KEY`) → global config `apiKey` → unset.
- `baseUrl`: `WIKI_PROVIDER_BASE_URL` (or legacy `WIKI_OLLAMA_BASE_URL`) → global config `baseUrl` → mode default (see below).
- `model`: `--model` CLI flag → `.wiki/config.json` `modelOverride` → `WIKI_MODEL` environment variable → `~/.wiki/config.json` `defaultModel` → built-in `kimi-k3`.
- `embeddingProvider`: `WIKI_EMBEDDING_PROVIDER` env var (`"local"` or `"ollama"`) → global config `embeddingProvider` → `"local"`.
- `embeddingModel`: `WIKI_EMBEDDING_MODEL` env var → global config `embeddingModel` → `"nomic-embed-text"`.
- `embeddingHost`: `WIKI_EMBEDDING_HOST` env var → global config `embeddingHost` → `http://localhost:11434`.

## Global config: `~/.wiki/config.json`

Lives in the user's home directory. Created and updated by the TUI's credentials setup wizard (`src/tui/CredentialsSetup.tsx`). The file is written with mode `0o600` because it may contain an API key.

```json
{
  "mode": "local",
  "defaultModel": "kimi-k3"
}
```

For cloud mode:

```json
{
  "mode": "cloud",
  "apiKey": "your-api-key",
  "defaultModel": "kimi-k3"
}
```

For an OpenAI-compatible endpoint:

```json
{
  "mode": "openai",
  "apiKey": "your-api-key",
  "baseUrl": "https://api.openai.com/v1",
  "defaultModel": "kimi-k3",
  "embeddingProvider": "local",
  "embeddingModel": "nomic-embed-text",
  "embeddingHost": "http://localhost:11434"
}
```

The `defaultGlobalConfig()` helper returns `{ mode: "local", defaultModel: "kimi-k3", embeddingProvider: "local", embeddingModel: "nomic-embed-text", embeddingHost: "http://localhost:11434" }` when the file is absent or unreadable. `loadGlobalConfig` swallows parse errors and falls back to the default.

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
- `model` — `modelOverride` arg (the `--model` flag) → `projectConfig.modelOverride` → `WIKI_MODEL` → `globalConfig.defaultModel` → `"kimi-k3"`.
- `embeddingProvider` — `WIKI_EMBEDDING_PROVIDER` env var (if `"local"` or `"ollama"`) → `globalConfig.embeddingProvider` → `"local"`.
- `embeddingModel` — `WIKI_EMBEDDING_MODEL` env var → `globalConfig.embeddingModel` → `"nomic-embed-text"`.
- `embeddingHost` — `WIKI_EMBEDDING_HOST` env var → `globalConfig.embeddingHost` → `http://localhost:11434`.

## Provider client construction

`createLLMClient` in `config.ts` produces the SDK client used by the agent:

- `openai` mode: `new OpenAIAdapter(new OpenAI({ apiKey, baseURL: baseUrl }))`.
- `cloud` mode with an API key: `new OllamaAdapter(new Ollama({ host: baseUrl, headers: { Authorization: \`Bearer ${apiKey}\` } }))`.
- `local` mode: `new OllamaAdapter(new Ollama({ host: baseUrl }))`.

The TUI and headless runner both use this factory, so there is exactly one code path for building the client.

`createEmbeddingConfig` extracts `{ provider, ollamaModel, ollamaHost }` from the resolved config for the embeddings/MCP server path. The embedding provider is independent of the LLM provider: you can use `openai` for the agent and `local` embeddings, or `local` LLM plus `ollama` embeddings.

To inspect the fully resolved configuration for the current directory, run `wiki --get-config`. It applies the same precedence rules as an actual init/update run and prints the resulting `ResolvedConfig` as JSON.

## Provider defaults

`defaultBaseUrl(mode)` in `config.ts` is the single source of truth for provider-specific base URLs:

| Mode | Default base URL |
|------|------------------|
| `"local"` | `http://localhost:11434` |
| `"cloud"` | `https://ollama.com` |
| `"openai"` | `https://api.openai.com/v1` |

## Limits

Constants exported from `config.ts`:

- `DEFAULT_MODEL = "kimi-k3"` — fallback model ID.
- `DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"` — fallback Ollama embedding model ID.
- `MAX_TOOL_RESULT_LENGTH = 10_000` — truncation ceiling for any tool result string.

A separate `MAX_READ_LENGTH = 50_000` lives in `tools.ts` and bounds `read_file` returns before the global tool-result truncation step.

## Project config loading

`loadProjectConfig` reads `.wiki/config.json` and swallows parse errors (returning `{}` on failure). `saveProjectConfig` creates the `.wiki/` directory if needed and writes the JSON file. Only `modelOverride` is currently consumed by `resolveConfig`; `lastUpdate` is reserved. The MCP server and embeddings modules do not currently read project-config values.
