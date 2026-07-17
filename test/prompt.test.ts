import { describe, expect, test } from "vitest";
import { createSystemPrompt, createUserMessage, getHelpText } from "../src/prompt.ts";

describe("prompt", () => {
  describe("createSystemPrompt", () => {
    test("contains role definition", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).toContain("Wiki Agent");
      expect(prompt).toContain("technical writer");
    });

    test("contains output location instruction", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).toContain(".wiki/");
      expect(prompt).toContain("quickstart.md");
    });

    test("contains loop prevention section", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).toContain("Loop prevention");
      expect(prompt).toContain("discover → plan → write → verify");
      expect(prompt).toContain("Do not begin a response with");
    });

    test("contains frontmatter instruction", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).toContain("YAML frontmatter");
      expect(prompt).toContain("type:");
      expect(prompt).toContain("title:");
      expect(prompt).toContain("description:");
      expect(prompt).toContain("tags:");
    });

    test("contains tool discipline", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).toContain("grep");
      expect(prompt).toContain("glob");
      expect(prompt).toContain("read_file");
      expect(prompt).toContain("write_file");
    });

    test("does not include repo instructions section when no AGENTS.md exists", async () => {
      const prompt = await createSystemPrompt("/test/project");
      expect(prompt).not.toContain("Repository instructions");
    });
  });

  describe("createUserMessage", () => {
    test("init message contains initialization instructions", () => {
      const message = createUserMessage("init", "/test/project");
      expect(message).toContain("Initialize wiki documentation");
      expect(message).toContain(".wiki/quickstart.md");
      expect(message).toContain("discovery pass");
    });

    test("update message contains update instructions", () => {
      const message = createUserMessage("update", "/test/project");
      expect(message).toContain("Update the existing");
      expect(message).toContain("surgical");
      expect(message).toContain("discovery pass");
    });

    test("includes git context when provided", () => {
      const gitSummary = "abc123 First commit\ndef456 Second commit";
      const message = createUserMessage("init", "/test/project", gitSummary);
      expect(message).toContain("abc123 First commit");
    });

    test("falls back to not available when no git summary", () => {
      const message = createUserMessage("init", "/test/project");
      expect(message).toContain("not available");
    });
  });

  describe("getHelpText", () => {
    test("contains usage instructions", () => {
      const help = getHelpText();
      expect(help).toContain("--init");
      expect(help).toContain("--update");
      expect(help).toContain("--print");
      expect(help).toContain("--model");
      expect(help).toContain("--help");
    });

    test("contains environment variable documentation", () => {
      const help = getHelpText();
      expect(help).toContain("WIKI_OLLAMA_MODE");
      expect(help).toContain("WIKI_OLLAMA_API_KEY");
      expect(help).toContain("WIKI_MODEL");
      expect(help).toContain("WIKI_RECURSION_LIMIT");
    });

    test("contains configuration paths", () => {
      const help = getHelpText();
      expect(help).toContain("~/.wiki/config.json");
      expect(help).toContain(".wiki/config.json");
    });
  });
});