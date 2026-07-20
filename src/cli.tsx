#!/usr/bin/env node
import React from "react";
import { render as inkRender } from "ink";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runAgent } from "./agent.js";
import {
  resolveConfig,
  createOllamaClient,
} from "./config.js";
import { getHelpText } from "./prompt.js";
import { App } from "./tui/App.js";

const execAsync = promisify(exec);

interface CliArgs {
  command: "init" | "update" | null;
  print: boolean;
  verbose: boolean;
  model?: string;
  wiki: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: null, print: false, verbose: false, wiki: false, help: false };
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
      case "--model":
        args.model = argv[++i];
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
}

async function getGitSummary(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git log --oneline -30", {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "(git not available or not a git repository)";
  }
}

async function runHeadless(
  command: "init" | "update",
  cwd: string,
  model: string,
  verbose: boolean,
  wiki: boolean,
): Promise<void> {
  const config = await resolveConfig(cwd, model);
  const client = createOllamaClient(config);
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

  if (args.help || args.command === null) {
    console.log(getHelpText());
    process.exit(0);
  }

  const command = args.command;
  const cwd = process.cwd();
  const config = await resolveConfig(cwd, args.model);

  if (config.mode === "cloud" && !config.apiKey) {
    console.error(
      "WIKI_OLLAMA_API_KEY is required for cloud mode. Set it via environment variable or run interactively to configure.",
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});