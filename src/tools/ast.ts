import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tool, resolveProjectPath, truncateResult } from "./helpers.js";

const execFileAsync = promisify(execFile);

export function createAstGrepTool(projectRoot: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "ast_grep",
        description:
          "Search code by AST pattern using ast-grep. Matches code structure (not text), so metavariables and node shapes work. Requires an explicit language. Use for precise structural queries like finding all calls to a function, all exports, or a specific control-flow shape.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                "AST pattern to match. Use $NAME for a single node metavariable and $$$ARGS for zero-or-more. Example: 'console.log($$$)'",
            },
            lang: {
              type: "string",
              description:
                "Language of the pattern. Supported: bash, c, cpp, csharp, css, elixir, go, haskell, html, java, javascript, json, jsx, kotlin, lua, nix, php, python, ruby, rust, scala, solidity, swift, tsx, typescript, yaml.",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
            selector: {
              type: "string",
              description:
                "Optional AST kind to extract as the actual matcher (ast-grep --selector).",
            },
            strictness: {
              type: "string",
              description:
                "Optional pattern strictness: cst, smart, ast, relaxed, signature, template.",
            },
          },
          required: ["pattern", "lang"],
        },
      },
    },
    handler: async (args) => {
      const pattern = args.pattern as string;
      const lang = args.lang as string;
      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );

      const argv = [
        "run",
        "--json=compact",
        "--lang",
        lang,
        "--pattern",
        pattern,
      ];

      const selector = args.selector as string | undefined;
      if (selector) {
        argv.push("--selector", selector);
      }

      const strictness = args.strictness as string | undefined;
      if (strictness) {
        argv.push("--strictness", strictness);
      }

      argv.push(searchPath);

      try {
        const { stdout } = await execFileAsync("ast-grep", argv, {
          cwd: projectRoot,
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        });
        return truncateResult(stdout || "(no matches)");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return truncateResult(`Error: ${message}`);
      }
    },
  };
}

export function createAstSearchTool(projectRoot: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "ast_search",
        description:
          "Search code using an ast-grep YAML rule (inline). More powerful than ast_grep: supports relational/inside/has constraints and multiple rules separated by '---'. Use for complex structural queries that a single pattern cannot express.",
        parameters: {
          type: "object",
          properties: {
            rule: {
              type: "string",
              description:
                "Inline ast-grep YAML rule(s). Must have id, language, and rule fields. Multiple rules separated by '---'.",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
          },
          required: ["rule"],
        },
      },
    },
    handler: async (args) => {
      const rule = args.rule as string;
      if (
        !rule ||
        typeof rule !== "string" ||
        !/\bid\s*:/i.test(rule) ||
        !/\blanguage\s*:/i.test(rule) ||
        !/\b(rule|rules)\s*:/i.test(rule)
      ) {
        return truncateResult(
          "Error: Invalid ast-grep rule. Must be YAML containing id, language, and rule/rules fields.",
        );
      }

      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );

      try {
        const { stdout } = await execFileAsync(
          "ast-grep",
          ["scan", "--json=compact", "--inline-rules", rule, searchPath],
          {
            cwd: projectRoot,
            maxBuffer: 1024 * 1024,
            timeout: 30_000,
          },
        );
        return truncateResult(stdout || "(no matches)");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return truncateResult(`Error: ${message}`);
      }
    },
  };
}
