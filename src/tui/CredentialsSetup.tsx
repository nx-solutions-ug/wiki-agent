import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveGlobalConfig, defaultBaseUrl, type GlobalConfig, type ResolvedConfig, type ProviderMode } from "../config.js";
import type { EmbeddingProvider } from "../embeddings.js";

interface CredentialsSetupProps {
  cwd: string;
  onConfigSaved: (config: ResolvedConfig) => void;
}

type SetupStep =
  | "mode-select"
  | "api-key"
  | "base-url"
  | "model"
  | "embedding-select"
  | "embedding-model"
  | "embedding-host"
  | "saving";

const DEFAULT_LLM_MODEL = "kimi-k3";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

export function CredentialsSetup({
  onConfigSaved,
}: CredentialsSetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>("mode-select");
  const [mode, setMode] = useState<ProviderMode>("local");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>("local");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingHost, setEmbeddingHost] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setStep("saving");

    try {
      const effectiveBaseUrl = baseUrl.trim() || defaultBaseUrl(mode);
      const effectiveEmbeddingHost = embeddingHost.trim() || effectiveBaseUrl;

      const globalConfig: GlobalConfig = {
        mode,
        defaultModel: model.trim() || DEFAULT_LLM_MODEL,
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
        ...(effectiveBaseUrl !== defaultBaseUrl(mode) ? { baseUrl: effectiveBaseUrl } : {}),
        embeddingProvider,
        embeddingModel: embeddingModel.trim() || DEFAULT_EMBEDDING_MODEL,
        ...(effectiveEmbeddingHost !== defaultBaseUrl(mode) ? { embeddingHost: effectiveEmbeddingHost } : {}),
      };

      await saveGlobalConfig(globalConfig);

      const resolved: ResolvedConfig = {
        mode,
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
        baseUrl: effectiveBaseUrl,
        model: model.trim() || DEFAULT_LLM_MODEL,
        embeddingProvider,
        embeddingModel: embeddingModel.trim() || DEFAULT_EMBEDDING_MODEL,
        embeddingHost: effectiveEmbeddingHost,
      };

      onConfigSaved(resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("mode-select");
    }
  }

  useInput((input) => {
    if (step === "mode-select") {
      if (input === "1") {
        setMode("local");
        setBaseUrl(defaultBaseUrl("local"));
        setStep("base-url");
      } else if (input === "2") {
        setMode("cloud");
        setStep("api-key");
      } else if (input === "3") {
        setMode("openai");
        setStep("api-key");
      }
    } else if (step === "embedding-select") {
      if (input === "1") {
        setEmbeddingProvider("local");
        setStep("model");
      } else if (input === "2") {
        setEmbeddingProvider("ollama");
        setStep("embedding-model");
      }
    }
  });

  if (step === "saving") {
    return React.createElement(Box, null,
      React.createElement(Text, { color: "cyan" }, "Saving configuration..."),
    );
  }

  if (step === "mode-select") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Select provider:"),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  1. "),
        "Ollama Local (no API key required)",
      ),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  2. "),
        "Ollama Cloud (API key required)",
      ),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  3. "),
        "OpenAI-compatible API (API key required, custom endpoint supported)",
      ),
      React.createElement(Text, { color: "gray" }, "\nPress 1, 2, or 3 to select."),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "api-key") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, mode === "openai" ? "Enter your API key:" : "Enter your Ollama Cloud API key:"),
      React.createElement(Text, { color: "gray" }, mode === "openai" ? "Paste your API key for your OpenAI-compatible endpoint" : "Get your API key from https://ollama.com"),
      React.createElement(TextInput, {
        value: apiKey,
        onChange: setApiKey,
        onSubmit: () => {
          if (!apiKey.trim()) {
            setError("API key is required for this mode.");
            return;
          }
          setError(null);
          setBaseUrl(defaultBaseUrl(mode));
          setStep("base-url");
        },
      }),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "base-url") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Enter API base URL:"),
      React.createElement(Text, { color: "gray" }, `Press Enter to use the default (${defaultBaseUrl(mode)})`),
      React.createElement(TextInput, {
        value: baseUrl,
        onChange: setBaseUrl,
        onSubmit: () => {
          setError(null);
          setStep("embedding-select");
        },
      }),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "embedding-select") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Select embedding provider for wiki search:"),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  1. "),
        "Local (Transformers.js — all-MiniLM-L6-v2, runs on-device, no server needed)",
      ),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  2. "),
        "Ollama (uses your Ollama server for embeddings, e.g. nomic-embed-text)",
      ),
      React.createElement(Text, { color: "gray" }, "\nPress 1 or 2 to select. Used by 'wiki --mcp stdio' for semantic search."),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "embedding-model") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Enter Ollama embedding model:"),
      React.createElement(Text, { color: "gray" }, `Press Enter to use the default (${DEFAULT_EMBEDDING_MODEL})`),
      React.createElement(TextInput, {
        value: embeddingModel,
        onChange: setEmbeddingModel,
        onSubmit: () => {
          setError(null);
          setStep("embedding-host");
        },
      }),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "embedding-host") {
    const defaultHost = baseUrl.trim() || defaultBaseUrl(mode);
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Enter Ollama server URL for embeddings:"),
      React.createElement(Text, { color: "gray" }, `Press Enter to use the default (${defaultHost})`),
      React.createElement(TextInput, {
        value: embeddingHost,
        onChange: setEmbeddingHost,
        onSubmit: () => {
          setError(null);
          setStep("model");
        },
      }),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  // model step (LLM model)
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true }, "Enter default model ID:"),
    React.createElement(Text, { color: "gray" }, `Press Enter to use the default (${DEFAULT_LLM_MODEL})`),
    React.createElement(TextInput, {
      value: model,
      onChange: setModel,
      onSubmit: () => {
        void handleSave();
      },
    }),
  );
}