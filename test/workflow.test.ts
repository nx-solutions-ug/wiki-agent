import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWorkflowFile } from "../src/workflow.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-workflow-test-"));
}

describe("createWorkflowFile", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await tempDir();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("generates workflow with wiki publish steps when wikiPublish is true", async () => {
    await createWorkflowFile(projectRoot, true);

    const content = await readFile(
      path.join(projectRoot, ".github", "workflows", "update-wiki.yml"),
      "utf8",
    );

    expect(content).toContain("run: wiki --update --print --verbose --wiki");
    expect(content).toContain("WIKI_PROVIDER_MODE");
    expect(content).toContain("WIKI_PROVIDER_API_KEY");
    expect(content).toContain("name: Detect wiki initialization");
    expect(content).toContain("name: Publish to wiki repo");
    expect(content).toContain("name: Create wiki staging snapshot pull request");
  });

  test("generates workflow without wiki publish steps when wikiPublish is false", async () => {
    await createWorkflowFile(projectRoot, false);

    const content = await readFile(
      path.join(projectRoot, ".github", "workflows", "update-wiki.yml"),
      "utf8",
    );

    expect(content).toContain("run: wiki --update --print --verbose");
    expect(content).not.toContain("--wiki\n");
    expect(content).toContain("WIKI_PROVIDER_MODE");
    expect(content).toContain("WIKI_PROVIDER_API_KEY");
    expect(content).not.toContain("name: Detect wiki initialization");
    expect(content).not.toContain("name: Publish to wiki repo");
    expect(content).toContain("name: Create wiki staging snapshot pull request");
  });
});
