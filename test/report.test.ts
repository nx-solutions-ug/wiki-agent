import { describe, expect, test } from "vitest";
import { generateUpdateReport } from "../src/agent.ts";

describe("generateUpdateReport", () => {
  test("empty changedFiles produces no-op report", () => {
    const report = generateUpdateReport("update", []);
    expect(report).toContain("# Wiki Updated");
    expect(report).toContain("No files were changed");
  });

  test("init command uses 'Initialized' label", () => {
    const report = generateUpdateReport("init", []);
    expect(report).toContain("# Wiki Initialized");
  });

  test("created files are listed under New pages", () => {
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/quickstart.md", description: "" },
    ]);
    expect(report).toContain("## New pages");
    expect(report).toContain(".wiki/quickstart.md");
    expect(report).not.toContain("## Updated pages");
  });

  test("edited files are listed under Updated pages", () => {
    const report = generateUpdateReport("update", [
      { action: "edited", path: ".wiki/architecture.md", description: "" },
    ]);
    expect(report).toContain("## Updated pages");
    expect(report).toContain(".wiki/architecture.md");
    expect(report).not.toContain("## New pages");
  });

  test("descriptions are rendered as blockquotes under each file", () => {
    const report = generateUpdateReport("update", [
      {
        action: "edited",
        path: ".wiki/cli/usage.md",
        description:
          "Revised the --print section after the headless output refactor in cli.tsx changed how events are emitted.",
      },
    ]);
    expect(report).toContain(".wiki/cli/usage.md");
    expect(report).toContain("Revised the --print section");
    expect(report).toContain(">"); // blockquote marker
  });

  test("missing description does not produce a blockquote", () => {
    const report = generateUpdateReport("update", [
      { action: "edited", path: ".wiki/cli/usage.md" },
    ]);
    expect(report).toContain(".wiki/cli/usage.md");
    // No description provided — should not render a blockquote line
    const lines = report.split("\n");
    const fileLineIdx = lines.findIndex((l) => l.includes(".wiki/cli/usage.md"));
    const following = lines.slice(fileLineIdx + 1, fileLineIdx + 3).join("\n");
    expect(following).not.toContain(">");
  });

  test("long descriptions are truncated", () => {
    const long = "A".repeat(800);
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/big.md", description: long },
    ]);
    expect(report).toContain("…");
    // Should not contain the full 800-char string
    expect(report).not.toContain(long);
  });

  test("whitespace in descriptions is collapsed", () => {
    const report = generateUpdateReport("update", [
      {
        action: "edited",
        path: ".wiki/x.md",
        description: "Added\n  newlines\t  and   extra   spaces",
      },
    ]);
    expect(report).toContain("Added newlines and extra spaces");
  });

  test("summary counts both created and edited", () => {
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/a.md", description: "" },
      { action: "created", path: ".wiki/b.md", description: "" },
      { action: "edited", path: ".wiki/c.md", description: "" },
    ]);
    expect(report).toContain("created 2 pages");
    expect(report).toContain("edited 1 page");
  });
});