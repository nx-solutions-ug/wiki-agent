import { describe, expect, test } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  test("parses --init command", () => {
    const args = parseArgs(["node", "cli.js", "--init"]);
    expect(args.command).toBe("init");
  });

  test("parses --update command", () => {
    const args = parseArgs(["node", "cli.js", "--update"]);
    expect(args.command).toBe("update");
  });

  test("parses --mcp stdio transport", () => {
    const args = parseArgs(["node", "cli.js", "--mcp", "stdio"]);
    expect(args.mcp).toBe("stdio");
  });

  test("throws on invalid MCP transport", () => {
    expect(() => parseArgs(["node", "cli.js", "--mcp", "http"])).toThrow(
      "Unknown MCP transport: http. Supported: stdio",
    );
  });

  test("throws when --mcp has no transport argument", () => {
    expect(() => parseArgs(["node", "cli.js", "--mcp"])).toThrow(
      "Unknown MCP transport: undefined. Supported: stdio",
    );
  });

  test("parses --model option", () => {
    const args = parseArgs(["node", "cli.js", "--init", "--model", "custom-model"]);
    expect(args.model).toBe("custom-model");
  });

  test("parses --print, --verbose, and --wiki flags", () => {
    const args = parseArgs(["node", "cli.js", "--update", "--print", "--verbose", "--wiki"]);
    expect(args.print).toBe(true);
    expect(args.verbose).toBe(true);
    expect(args.wiki).toBe(true);
  });

  test("parses --help and --version", () => {
    const helpArgs = parseArgs(["node", "cli.js", "--help"]);
    expect(helpArgs.help).toBe(true);

    const versionArgs = parseArgs(["node", "cli.js", "--version"]);
    expect(versionArgs.version).toBe(true);
  });
});
