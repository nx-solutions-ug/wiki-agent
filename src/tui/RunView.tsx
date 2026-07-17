import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { runAgent, type AgentEvent } from "../agent.js";
import { createOllamaClient, type ResolvedConfig } from "../config.js";
import type { WikiCommand } from "../prompt.js";

interface RunViewProps {
  command: WikiCommand;
  cwd: string;
  config: ResolvedConfig;
  verbose: boolean;
  onExit: () => void;
}

interface DisplayEvent {
  type: "assistant" | "tool" | "error" | "done";
  text: string;
  toolName?: string;
  toolIndex?: number;
}
export function RunView({
  command,
  cwd,
  config,
  verbose,
  onExit,
}: RunViewProps): React.ReactElement {
  const [events, setEvents] = useState<DisplayEvent[]>([]);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<DisplayEvent[]>([]);
  const { exit } = useApp();

  useEffect(() => {
    const client = createOllamaClient(config);
    let toolCount = 0;

    runAgent(client, {
      command,
      projectRoot: cwd,
      model: config.model,
      stream: true,
      onEvent: (event: AgentEvent) => {
        // Merge consecutive assistant chunks into one line so streaming
        // does not fragment prose into separate display rows.
        if (event.type === "assistant") {
          if (event.content) {
            const last = eventsRef.current[eventsRef.current.length - 1];
            if (last && last.type === "assistant") {
              last.text += event.content;
              setEvents([...eventsRef.current]);
              return;
            }
            eventsRef.current = [
              ...eventsRef.current,
              { type: "assistant" as const, text: event.content },
            ];
            setEvents([...eventsRef.current]);
          }
          return;
        }
        let display: DisplayEvent | null = null;
        switch (event.type) {
          case "tool":
            // By default the TUI shows only assistant prose. In verbose
            // mode, record the tool call (marker + result body) so the
            // user can follow the full agent log.
            if (event.result && verbose) {
              toolCount += 1;
              display = {
                type: "tool",
                text: event.result.slice(0, 1000),
                toolName: event.name,
                toolIndex: toolCount,
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
  }, [command, cwd, config, verbose]);

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
      // Indent assistant prose with a cyan bullet so it reads as a
      // distinct paragraph, not a continuation of tool output above.
      return React.createElement(
        Box,
        { marginTop: 1 },
        React.createElement(Text, { color: "cyan" }, "» "),
        React.createElement(Text, { color: "cyan" }, event.text),
      );
    case "tool":
      return React.createElement(
        Box,
        { flexDirection: "column", marginTop: 1 },
        React.createElement(
          Text,
          { color: "gray", dimColor: true },
          `#${event.toolIndex ?? ""} → ${event.toolName}`,
        ),
        event.text
          ? React.createElement(
              Text,
              { color: "gray", dimColor: true },
              event.text,
            )
          : null,
      );
    case "error":
      return React.createElement(Text, { color: "red" }, `Error: ${event.text}`);
    case "done":
      return React.createElement(Text, { color: "green", bold: true }, event.text);
  }
}