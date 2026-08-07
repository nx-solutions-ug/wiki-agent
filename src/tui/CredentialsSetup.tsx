import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveGlobalConfig, type GlobalConfig, type ResolvedConfig, type ProviderMode } from "../config.js";

interface CredentialsSetupProps {
  cwd: string;
  onConfigSaved: (config: ResolvedConfig) => void;
}

type SetupStep = "mode-select" | "api-key" | "model" | "saving";

export function CredentialsSetup({
  onConfigSaved,
}: CredentialsSetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>("mode-select");
  const [mode, setMode] = useState<ProviderMode>("local");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("kimi-k2.7-code");
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setStep("saving");

    try {
      const globalConfig: GlobalConfig = {
        mode,
        defaultModel: model,
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
      };

      await saveGlobalConfig(globalConfig);

      const resolved: ResolvedConfig = {
        mode,
        ...((mode === "cloud" || mode === "openai") ? { apiKey } : {}),
        baseUrl: mode === "openai" ? "https://api.openai.com/v1" : mode === "cloud" ? "https://ollama.com" : "http://localhost:11434",
        model,
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
        setStep("model");
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
        "OpenAI API (API key required)",
      ),
      React.createElement(Text, { color: "gray" }, "\nPress 1, 2, or 3 to select."),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "api-key") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, mode === "openai" ? "Enter your OpenAI API key:" : "Enter your Ollama Cloud API key:"),
      React.createElement(Text, { color: "gray" }, mode === "openai" ? "Get your API key from OpenAI platform" : "Get your API key from https://ollama.com"),
      React.createElement(TextInput, {
        value: apiKey,
        onChange: setApiKey,
        onSubmit: () => {
          if (!apiKey.trim()) {
            setError("API key is required for this mode.");
            return;
          }
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