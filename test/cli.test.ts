import { pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseArgs, isMainModule } from "../src/cli.js";

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

describe("isMainModule", () => {
  test("returns false when argv[1] is undefined or empty", () => {
    expect(isMainModule(undefined)).toBe(false);
    expect(isMainModule("")).toBe(false);
  });

  test("returns false for test runners and unrelated scripts", () => {
    expect(isMainModule("/path/to/node_modules/vitest/dist/cli.mjs")).toBe(false);
    expect(isMainModule("/usr/local/bin/vitest")).toBe(false);
    expect(isMainModule("/path/to/setup-cli.js")).toBe(false);
    expect(isMainModule("/path/to/my-cli.tsx")).toBe(false);
    expect(isMainModule("/path/to/cli.jsx")).toBe(false);
    expect(isMainModule("/path/to/other-script.js")).toBe(false);
  });

  test("returns true for exact path match with file URL", () => {
    const filePath = path.resolve("/some/project/dist/cli.js");
    const fileUrl = pathToFileURL(filePath).href;
    expect(isMainModule(filePath, fileUrl)).toBe(true);
  });

  test("returns true for supported binary names and entry filenames", () => {
    expect(isMainModule("/usr/local/bin/wiki")).toBe(true);
    expect(isMainModule("~/.bun/bin/wiki")).toBe(true);
    expect(isMainModule("/usr/local/bin/wiki-agent")).toBe(true);
    expect(isMainModule("/path/to/dist/cli.js")).toBe(true);
    expect(isMainModule("/path/to/src/cli.tsx")).toBe(true);
  });

  test("returns false when imported during test execution", () => {
    // When executing within vitest, process.argv[1] is the vitest runner, so isMainModule() evaluates to false
    expect(isMainModule(process.argv[1])).toBe(false);
  });
});

