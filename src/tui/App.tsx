import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { runAgent, type AgentEvent } from "../agent.js";
import { createOllamaClient, type ResolvedConfig } from "../config.js";
import { CredentialsSetup } from "./CredentialsSetup.js";
import { RunView } from "./RunView.js";
import { VERSION } from "../version.js";

interface AppProps {
  command: "init" | "update";
  cwd: string;
  config: ResolvedConfig;
  verbose: boolean;
  wiki: boolean;
}

export function App({ command, cwd, config, verbose, wiki }: AppProps): React.ReactElement {
  const [needsSetup, setNeedsSetup] = useState(config.mode === "cloud" && !config.apiKey);
  const [resolvedConfig, setResolvedConfig] = useState(config);
  const { exit } = useApp();

  useInput((input) => {
    if (input === "q" || input === "\u0003") {
      exit();
    }
  });

  const handleConfigSaved = useCallback((newConfig: ResolvedConfig) => {
    setResolvedConfig(newConfig);
    setNeedsSetup(false);
  }, []);

  if (needsSetup) {
    return React.createElement(CredentialsSetup, {
      cwd,
      onConfigSaved: handleConfigSaved,
    });
  }

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 1 },
      React.createElement(Text, null,
        React.createElement(Text, { bold: true }, `Wiki Agent v${VERSION}`),
        " | ",
        React.createElement(Text, { color: "cyan" }, `Ollama (${resolvedConfig.mode})`),
        " | ",
        React.createElement(Text, { color: "gray" }, `model: ${resolvedConfig.model}`),
        " | ",
        React.createElement(Text, { color: "gray" }, cwd),
      ),
    ),
    React.createElement(RunView, {
      command,
      cwd,
      config: resolvedConfig,
      verbose,
      wiki,
      onExit: exit,
    }),
  );
}