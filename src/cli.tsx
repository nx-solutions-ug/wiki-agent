#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render as inkRender } from "ink";
import { runAgent } from "./agent.js";
import {
  resolveConfig,
  createLLMClient,
} from "./config.js";
import { getHelpText } from "./prompt.js";
import { VERSION } from "./version.js";
import { App } from "./tui/App.js";
import { getGitSummary } from "./cli-helpers.js";


type McpTransport = "stdio";

interface CliArgs {
  command: "init" | "update" | null;
  print: boolean;
  verbose: boolean;
  model?: string;
  wiki: boolean;
  mcp: McpTransport | null;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: null, print: false, verbose: false, wiki: false, mcp: null, help: false, version: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--init":
        args.command = "init";
        break;
      case "--update":
        args.command = "update";
        break;
      case "--print":
        args.print = true;
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        break;
      case "--wiki":
        args.wiki = true;
        break;
      case "--mcp": {
        const transport = argv[++i];
        if (transport !== "stdio") {
          throw new Error(`Unknown MCP transport: ${transport}. Supported: stdio`);
        }
        args.mcp = transport;
        break;
      }
      case "--model":
        args.model = argv[++i];
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
        args.version = true;
        break;
    }
  }

  return args;
}

async function runHeadless(
  command: "init" | "update",
  cwd: string,
  model: string,
  verbose: boolean,
  wiki: boolean,
): Promise<void> {
  const config = await resolveConfig(cwd, model);
  const client = createLLMClient(config);
  const gitSummary = await getGitSummary(cwd);

  await runAgent(client, {
    command,
    projectRoot: cwd,
    model: config.model,
    gitSummary,
    wikiPublish: wiki,
    stream: false,
    onEvent: (event) => {
      switch (event.type) {
        case "assistant":
          if (event.content) {
            process.stdout.write(`\n${event.content}\n`);
          }
          break;
        case "tool":
          if (event.result && verbose) {
            process.stdout.write(`\n[tool: ${event.name}]\n${event.result}\n`);
          }
          break;
        case "error":
          process.stderr.write(`\nError: ${event.message}\n`);
          break;
        case "done":
          process.stdout.write(`\n${event.summary}\n`);
          break;
      }
    },
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(`wiki-agent v${VERSION}`);
    process.exit(0);
  }

  // --mcp stdio: start MCP server (no --init/--update required)
  if (args.mcp === "stdio") {
    const cwd = process.cwd();
    // Dynamic import: only load MCP SDK + native sqlite/transformers deps
    // when --mcp is actually used, so normal --init/--update stays lightweight.
    const { startMcpStdioServer } = await import("./mcp-server.js");
    await startMcpStdioServer(cwd);
    return;
  }

  if (args.help || args.command === null) {
    console.log(getHelpText());
    process.exit(0);
  }

  const command = args.command;
  const cwd = process.cwd();
  const config = await resolveConfig(cwd, args.model);

  if ((config.mode === "cloud" || config.mode === "openai") && !config.apiKey) {
    console.error(
      "API key is required for cloud or openai mode. Set it via environment variable or run interactively to configure.",
    );
    process.exit(1);
  }

  if (args.print) {
    await runHeadless(command, cwd, config.model, args.verbose, args.wiki);
  } else {
    const { waitUntilExit } = inkRender(
      React.createElement(App, {
        command,
        cwd,
        config,
        verbose: args.verbose,
        wiki: args.wiki,
      }),
    );
    await waitUntilExit();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}