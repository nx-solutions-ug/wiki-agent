import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { runAgent, type AgentEvent } from "../agent.js";
import { createOllamaClient, type ResolvedConfig } from "../config.js";
import type { WikiCommand } from "../prompt.js";

interface RunViewProps {
  command: WikiCommand;
  cwd: string;
  config: ResolvedConfig;
  onExit: () => void;
}

interface DisplayEvent {
  type: "assistant" | "tool" | "error" | "done";
  text: string;
  toolName?: string;
}

export function RunView({
  command,
  cwd,
  config,
  onExit,
}: RunViewProps): React.ReactElement {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<DisplayEvent[]>([]);
  const { exit } = useApp();

  useEffect(() => {
    const client = createOllamaClient(config);

    runAgent(client, {
      command,
      projectRoot: cwd,
      model: config.model,
      stream: true,
      onEvent: (event: AgentEvent) => {
        let display: DisplayEvent | null = null;

        switch (event.type) {
          case "assistant":
            if (event.content) {
              display = { type: "assistant", text: event.content };
            }
            break;
          case "tool":
            if (event.result) {
              display = {
                type: "tool",
                text: event.result.slice(0, 500),
                toolName: event.name,
              };
            }
            break;
          case "error":
            display = { type: "error", text: event.message };
            setError(event.message);
            break;
          case "done":
            display = { type: "done", text: event.summary };
            setRunning(false);
            break;
        }

        if (display) {
          eventsRef.current = [...eventsRef.current, display];
          setEvents([...eventsRef.current]);
        }
      },
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    });
  }, [command, cwd, config]);

  return React.createElement(Box, { flexDirection: "column", marginTop: 1 },
    ...events.map((event, i) =>
      React.createElement(EventLine, { key: i, event }),
    ),
    running
      ? React.createElement(Text, { color: "yellow" }, "⏳ Working...")
      : React.createElement(Text, { color: "green" }, `✓ ${error ? "Failed: " + error : "Done"}`),
    !running
      ? React.createElement(Text, { color: "gray" }, "Press q or Ctrl+C to exit.")
      : null,
  );
}

function EventLine({
  event,
}: {
  event: DisplayEvent;
}): React.ReactElement {
  switch (event.type) {
    case "assistant":
      return React.createElement(Text, null, event.text);
    case "tool":
      return React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { color: "gray", dimColor: true },
          `[tool: ${event.toolName}]`,
        ),
        React.createElement(Text, { color: "gray", dimColor: true },
          event.text,
        ),
      );
    case "error":
      return React.createElement(Text, { color: "red" }, `Error: ${event.text}`);
    case "done":
      return React.createElement(Text, { color: "green", bold: true }, event.text);
  }
}