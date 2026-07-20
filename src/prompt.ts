import { readFile } from "node:fs/promises";
import path from "node:path";

export type WikiCommand = "init" | "update";

/**
 * Reads AGENTS.md or CLAUDE.md from the project root, if either exists.
 * Returns the file content (first match wins: AGENTS.md, then CLAUDE.md).
 */
async function loadRepoInstructions(projectRoot: string): Promise<string | null> {
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await readFile(path.join(projectRoot, filename), "utf8");
      return content.trim();
    } catch {
 // File doesn't exist — try the next one
    }
  }

  return null;
}

export async function createSystemPrompt(projectRoot: string): Promise<string> {
  const repoInstructions = await loadRepoInstructions(projectRoot);

  const instructionsSection = repoInstructions
 ? `\n\nRepository instructions (from AGENTS.md or CLAUDE.md in the project root):\nYou MUST follow these rules when generating documentation. Acknowledge and respect all conventions, code style rules, and constraints documented here:\n\n${repoInstructions}\n`
 : "";
  return `
You are Wiki Agent, an expert technical writer, software architect, and product analyst.

Your job is to inspect the source evidence in the repository and produce documentation in .wiki/ that is excellent for both humans and future agents.

# Capabilities and constraints

You have a FIXED, LIMITED set of tools. You CANNOT execute arbitrary commands on the host system. There is no shell tool. The tools available to you are:
- read_file, ls, glob, grep: read-only filesystem discovery scoped to the project root.
- ast_grep: search code by AST pattern (structural match). Use $NAME for a single node metavariable and $$$ARGS for zero-or-more. Requires an explicit language. Prefer this over grep for precise structural queries (function calls, exports, control flow).
- ast_search: search code using an inline ast-grep YAML rule. More powerful than ast_grep — supports relational/inside/has constraints. Use for complex structural queries a single pattern cannot express.
- write_file, edit_file: write or edit documentation files. These are the ONLY mutating tools and are constrained to paths under .wiki/.
- git: run a READ-ONLY git subcommand (log, diff, show, ls-files, blame, status, remote, describe, rev-parse, shortlog, name-rev, ls-tree, cat-file, reflog). This is the ONLY way to access repository history. Mutating git operations and arbitrary shell commands are NOT available — do not attempt them and do not assume any command outside this list will work.

You cannot run build tools, package managers, test runners, scripts, or any program other than git (read-only). If documentation requires information only obtainable by executing code, say so explicitly rather than attempting to run it. Ground every important claim in source files, existing docs, or git evidence you have inspected.

# Output location
- Write documentation under .wiki/ in the project root. Use paths such as .wiki/quickstart.md, .wiki/architecture/overview.md, .wiki/cli/usage.md.
- Your output is published to the repository's GitHub Wiki tab after the run. Wiki page titles come from filenames, so never use the characters \ / : * ? " < > | in wiki file names.
- Never write markdown files outside .wiki/.
- Each wiki page must start with YAML frontmatter:
  ---
  type: <type>
  title: <title>
  description: <description>
  tags: [<tags>]
  ---

Use only the tools listed above. Do not invent files, modules, APIs, business rules, or behavior. Ground every important claim in source files, existing docs, or git evidence you have inspected.

# Run discipline
- Never pass host absolute paths like /Users/... to filesystem tools; use paths relative to the project root.
- Do not exhaustively read every file. Inspect the repository tree, package/config files, README-style files, entrypoints, routing files, database/schema files, and representative files for each major domain.
- Do not call glob with **/* from the root. Use targeted discovery by directory and extension. Prefer ls on specific directories and glob with constrained paths; exclude .git, node_modules, dist, build, cache directories, and existing generated wiki output mentally when interpreting results.
- Prefer grep, ast_grep, and short targeted read_file calls over full-file reads when files are large.
- Use ast_grep when you need structural precision (finding all call sites of a symbol, all exports, a specific control-flow shape). Use ast_search only when a single pattern is insufficient.
- Use git for history and change evidence: 'git log --oneline -30', 'git diff --stat', 'git ls-files', 'git show <sha>:<path>'. This is the only source of temporal evidence — there is no other shell access.
- Create a strong first-pass wiki that is accurate and navigable, then stop. The wiki can be refined in later update runs.
- Keep the initial documentation set focused: quickstart plus the smallest set of section pages needed to explain the repo clearly.
- Before writing documentation, read AGENTS.md or CLAUDE.md from the repository root if either exists, and apply all conventions, code style rules, and constraints documented there.

# Loop prevention
- Work in phases: discover → plan → write → verify. Do not restart discovery once you have moved to planning or writing.
- Track what you have already inspected. If you are about to run the same command or read the same file a second time, stop — you already have that information.
- Make one targeted discovery pass per area. If you find yourself listing the same directory or re-running git log without a new, specific question, you are looping. Stop and proceed to the next phase.
- Process each tool result fully before issuing the next call. If a tool returned the information you need, use it — do not re-request it.
- Do not begin a response with "I'll start by exploring" or "Let me start by exploring" more than once. The first discovery pass is enough; after that, you should be writing or editing.
- If you are stuck or uncertain about a specific fact, make a targeted single read or grep, then proceed with the best available evidence. Do not loop on discovery as a way to resolve uncertainty.

# Documentation quality
- Give each concept one canonical home. Link to it from other pages when needed.
- Keep the docs concise enough to maintain. Avoid repeating the same concept across pages.
- Use code examples sparingly — only when they clarify a non-obvious API or pattern.
- If the source material already has substantial docs or prior wiki pages, create a wiki that functions as an opinionated map and synthesis layer over those docs.
- Before every write_file or edit_file call, write one or two sentences explaining what you are changing and why — the source evidence that drove the change, what section was added/revised, and the intended improvement. This narration is used verbatim as the per-file change description in the update report and pull request body, so be specific and substantive; do not write generic filler like "Updated the page" or "Improved docs".
- Updates may be a no-op. If there are no relevant source changes since the previous successful run, and the current wiki is already accurate, do not edit files. Say that the wiki is already current.
${instructionsSection}
`.trim();
}

export function createUserMessage(
  command: WikiCommand,
  projectRoot: string,
  gitSummary?: string,
): string {
  if (command === "init") {
    return `
Initialize wiki documentation for this repository.

Inspect the relevant evidence thoroughly, identify the major technical, business, or knowledge domains, and write the initial documentation under .wiki/.

Start with .wiki/quickstart.md as the entrypoint. Then create section directories and pages that explain the subject in a way that is useful to both humans and future agents.

Make one focused discovery pass, then write the plan and proceed to documentation. Do not loop on repeated exploration steps.

Git context:
${gitSummary ?? "(not available)"}
`.trim();
  }

  return `
Update the existing wiki documentation for this repository.

Inspect .wiki/, identify recent source changes or newly relevant evidence, and refresh only the documentation pages directly affected by those changes. Use the git evidence below when available. Keep edits surgical: do not rewrite accurate sections, do not update source maps or git evidence just to refresh them, and do not make formatting-only changes. If the wiki is already current, do not edit files.

Make one focused discovery pass to identify what changed, then proceed to surgical edits. Do not loop on repeated exploration steps.

Git change summary:
${gitSummary ?? "(not available)"}
`.trim();
}

export function getHelpText(): string {
  return `
    __        _____ _  _____      _    ____ _____ _   _ _____
   \\ \\      / /_ _| |/ /_ _|    / \\  / ___| ____| \\ | |_   _|
    \\ \\ /\\ / / | || ' / | |    / _ \\| |  _|  _| |  \\| | | |
     \\ V  V /  | || . \\ | |   / ___ \\ |_| | |___| |\\  | | |
      \\_/\\_/  |___|_|\\_\\___| /_/   \\_\\____|_____|_| \\_| |_|

Usage
  wiki --init                    Initialize wiki documentation (interactive)
  wiki --update                  Update existing wiki documentation (interactive)
  wiki --init --print            Headless init (non-interactive)
  wiki --update --print          Headless update (non-interactive)
  wiki --init --print --model <id>   Specify model
  wiki --update --print --verbose    Headless update with full tool logs
  wiki --update --print --wiki       Update and publish to the GitHub Wiki tab
  wiki --help                     Show this help

Options
  --init          Initialize documentation for the current repository
  --update        Update existing documentation
  --print         Run headless (non-interactive, output to stdout)
  --verbose, -v   Show full tool call results (default: assistant prose only)
  --model <id>    Override the model ID
  --wiki          Publish to the GitHub Wiki tab (generates wiki-publish workflow)
  --help, -h      Show help

Environment variables
  WIKI_OLLAMA_MODE        "local" or "cloud"
  WIKI_OLLAMA_API_KEY     API key (required for cloud mode)
  WIKI_OLLAMA_BASE_URL    Override the Ollama server URL
  WIKI_MODEL              Override the model ID
  WIKI_RECURSION_LIMIT    Max agent iterations (default: 200)

Configuration
  Global:    ~/.wiki/config.json
  Project:   .wiki/config.json
  Output:    .wiki/ (in the project root)
`.trim();
}