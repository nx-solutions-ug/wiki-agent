import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveGlobalConfig, defaultBaseUrl, type GlobalConfig, type ResolvedConfig, type ProviderMode } from "../config.js";

interface CredentialsSetupProps {
  cwd: string;
  onConfigSaved: (config: ResolvedConfig) => void;
}

type SetupStep = "mode-select" | "api-key" | "base-url" | "model" | "saving";

export function CredentialsSetup({
  onConfigSaved,
}: CredentialsSetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>("mode-select");
  const [mode, setMode] = useState<ProviderMode>("local");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setStep("saving");

    try {
      const effectiveBaseUrl = baseUrl.trim() || defaultBaseUrl(mode);
      const globalConfig: GlobalConfig = {
        mode,
        defaultModel: model.trim() || "kimi-k2.7-code",
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
        ...(effectiveBaseUrl !== defaultBaseUrl(mode) ? { baseUrl: effectiveBaseUrl } : {}),
      };

      await saveGlobalConfig(globalConfig);

      const resolved: ResolvedConfig = {
        mode,
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
        baseUrl: effectiveBaseUrl,
        model: model.trim() || "kimi-k2.7-code",
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
          setStep("model");
        },
      }),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  // model step
  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true }, "Enter default model ID:"),
    React.createElement(Text, { color: "gray" }, "Press Enter to use the default (kimi-k2.7-code)"),
    React.createElement(TextInput, {
      value: model,
      onChange: setModel,
      onSubmit: () => {
        void handleSave();
      },
    }),
  );
}