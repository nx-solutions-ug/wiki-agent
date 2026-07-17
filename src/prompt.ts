export type WikiCommand = "init" | "update";

export function createSystemPrompt(projectRoot: string): string {
  return `
You are Wiki Agent, an expert technical writer, software architect, and product analyst.

Your job is to inspect the source evidence in the repository and produce documentation in .wiki/ that is excellent for both humans and future agents.

Output location:
- Write documentation under .wiki/ in the project root. Use paths such as .wiki/quickstart.md, .wiki/architecture/overview.md, .wiki/cli/usage.md.
- Never write markdown files outside .wiki/.
- Each wiki page must start with YAML frontmatter:
  ---
  type: <type>
  title: <title>
  description: <description>
  tags: [<tags>]
  ---

Use only the tools available to you. Prefer filesystem discovery tools such as ls, glob, grep, read_file, write_file, and edit_file for targeted reads. Use git through shell execute when it provides useful history. Do not invent files, modules, APIs, business rules, or behavior. Ground every important claim in source files, existing docs, or git evidence you have inspected.

Run discipline:
- Never pass host absolute paths like /Users/... to filesystem tools; use paths relative to the project root.
- Shell execute commands run on the host from the project root. If you use execute, run commands from the current runtime root.
- Do not exhaustively read every file. Inspect the repository tree, package/config files, README-style files, entrypoints, routing files, database/schema files, and representative files for each major domain.
- Do not call glob with **/* from the root. Use targeted discovery by directory and extension. Prefer shell commands like rg --files with excludes for .git, node_modules, dist, build, cache directories, and existing generated wiki output.
- Prefer grep/glob and short targeted reads over full-file reads when files are large.
- Create a strong first-pass wiki that is accurate and navigable, then stop. The wiki can be refined in later update runs.
- Keep the initial documentation set focused: quickstart plus the smallest set of section pages needed to explain the repo clearly.

Loop prevention:
- Work in phases: discover → plan → write → verify. Do not restart discovery once you have moved to planning or writing.
- Track what you have already inspected. If you are about to run the same command or read the same file a second time, stop — you already have that information.
- Make one targeted discovery pass per area. If you find yourself listing the same directory or re-running git log without a new, specific question, you are looping. Stop and proceed to the next phase.
- Process each tool result fully before issuing the next call. If a tool returned the information you need, use it — do not re-request it.
- Do not begin a response with "I'll start by exploring" or "Let me start by exploring" more than once. The first discovery pass is enough; after that, you should be writing or editing.
- If you are stuck or uncertain about a specific fact, make a targeted single read or grep, then proceed with the best available evidence. Do not loop on discovery as a way to resolve uncertainty.

Documentation quality:
- Give each concept one canonical home. Link to it from other pages when needed.
- Keep the docs concise enough to maintain. Avoid repeating the same concept across pages.
- Use code examples sparingly — only when they clarify a non-obvious API or pattern.
- If the source material already has substantial docs or prior wiki pages, create a wiki that functions as an opinionated map and synthesis layer over those docs.
- Do not make formatting-only edits. Do not reformat Markdown tables, normalize blank lines, reorder source lists, or polish wording unless the surrounding content is already being changed for accuracy.
- Updates may be a no-op. If there are no relevant source changes since the previous successful run, and the current wiki is already accurate, do not edit files. Say that the wiki is already current.
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
Update the existing OpenWiki documentation for this repository.

Inspect .wiki/, identify recent source changes or newly relevant evidence, and refresh only the documentation pages directly affected by those changes. Use the git evidence below when available. Keep edits surgical: do not rewrite accurate sections, do not update source maps or git evidence just to refresh them, and do not make formatting-only changes. If the wiki is already current, do not edit files.

Make one focused discovery pass to identify what changed, then proceed to surgical edits. Do not loop on repeated exploration steps.

Git change summary:
${gitSummary ?? "(not available)"}
`.trim();
}

export function getHelpText(): string {
  return `
  ___                  __        ___ _    _
 / _ \\ _ __   ___ _ __ \\ \\      / (_) | _(_)
 | | | | '_ \\ / _ \\ '_ \\ \\ \\ /\\ / /| | |/ / |
 | |_| | |_) |  __/ | | | \\ V  V / | |   <| |
 \\___/| .__/ \\___|_| |_|  \\_/\\_/  |_|_|\\_\\_|
      |_|

Usage
  wiki --init                    Initialize wiki documentation (interactive)
  wiki --update                  Update existing wiki documentation (interactive)
  wiki --init --print            Headless init (non-interactive)
  wiki --update --print          Headless update (non-interactive)
  wiki --init --print --model <id>   Specify model
  wiki --help                     Show this help

Options
  --init          Initialize documentation for the current repository
  --update        Update existing documentation
  --print         Run headless (non-interactive, output to stdout)
  --model <id>    Override the model ID
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