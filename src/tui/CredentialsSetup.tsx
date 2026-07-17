import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { saveGlobalConfig, type GlobalConfig, type ResolvedConfig } from "../config.js";

interface CredentialsSetupProps {
  cwd: string;
  onConfigSaved: (config: ResolvedConfig) => void;
}

type SetupStep = "mode-select" | "api-key" | "model" | "saving";

export function CredentialsSetup({
  onConfigSaved,
}: CredentialsSetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>("mode-select");
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("qwen3-coder");
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setStep("saving");

    try {
      const globalConfig: GlobalConfig = {
        mode,
        defaultModel: model,
        ...(mode === "cloud" ? { apiKey } : {}),
      };

      await saveGlobalConfig(globalConfig);

      const resolved: ResolvedConfig = {
        mode,
        ...(mode === "cloud" ? { apiKey } : {}),
        baseUrl: mode === "cloud" ? "https://ollama.com" : "http://localhost:11434",
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
      React.createElement(Text, { bold: true }, "Select Ollama mode:"),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  1. "),
        "Ollama Local (no API key required)",
      ),
      React.createElement(Text, null,
        React.createElement(Text, { color: "green" }, "  2. "),
        "Ollama Cloud (API key required)",
      ),
      React.createElement(Text, { color: "gray" }, "\nPress 1 or 2 to select."),
      error ? React.createElement(Text, { color: "red" }, `Error: ${error}`) : null,
    );
  }

  if (step === "api-key") {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Enter your Ollama Cloud API key:"),
      React.createElement(Text, { color: "gray" }, "Get your API key from https://ollama.com"),
      React.createElement(TextInput, {
        value: apiKey,
        onChange: setApiKey,
        onSubmit: () => {
          if (!apiKey.trim()) {
            setError("API key is required for cloud mode.");
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
    React.createElement(Text, { color: "gray" }, "Press Enter to use the default (qwen3-coder)"),
    React.createElement(TextInput, {
      value: model,
      onChange: setModel,
      onSubmit: () => {
        void handleSave();
      },
    }),
  );
}