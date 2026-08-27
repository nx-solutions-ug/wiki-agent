import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAgent, type RunOptions, type AgentEvent } from "../src/agent.js";
import type { LLMClient, LLMMessage, LLMResponse } from "../src/llm.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-agent-test-"));
}

describe("runAgent", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await tempDir();
    await mkdir(path.join(projectRoot, ".wiki"));
    await mkdir(path.join(projectRoot, ".github", "workflows"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("runs agent loop without tools and exits", async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        message: { content: "Hello from LLM", tool_calls: [] }
      })
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      maxIterations: 5,
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    expect(mockClient.chat).toHaveBeenCalledTimes(1);

    // Check that we got the assistant event
    expect(events).toContainEqual({ type: "assistant", content: "Hello from LLM" });

    // As there are no file changes, we expect it to exit with "Wiki is already current."
    expect(events).toContainEqual({ type: "done", summary: "Wiki is already current. No files changed." });
  });

  test("handles stream mode correctly", async () => {
    // create async generator for stream
    const stream = async function* () {
      yield { message: { content: "Hello " } };
      yield { message: { content: "World", tool_calls: [] } };
    };

    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue(stream())
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      stream: true,
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    expect(events).toContainEqual({ type: "assistant", content: "Hello " });
    expect(events).toContainEqual({ type: "assistant", content: "World" });
    expect(events).toContainEqual({ type: "done", summary: "Wiki is already current. No files changed." });
  });

  test("executes tool calls and loops", async () => {
    let callCount = 0;

    const mockClient: LLMClient = {
      chat: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            message: {
              content: "I will read a file",
              tool_calls: [
                {
                  id: "call_1",
                  function: {
                    name: "read_file",
                    arguments: { path: "test.md" }
                  }
                }
              ]
            }
          };
        }
        return {
          message: { content: "Done reading", tool_calls: [] }
        };
      })
    };

    // create a file for it to read
    await writeFile(path.join(projectRoot, "test.md"), "test content", "utf8");

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    expect(mockClient.chat).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: "tool", name: "read_file", result: "" });

    const toolEvent = events.find(e => e.type === "tool" && e.name === "read_file" && e.result !== "") as { type: "tool", name: string, result: string };
    expect(toolEvent).toBeDefined();
    expect(toolEvent.result).toContain("test content");
  });

  test("generates report and creates PR metadata for changed files", async () => {
    let callCount = 0;

    const mockClient: LLMClient = {
      chat: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            message: {
              content: "I will write a file",
              tool_calls: [
                {
                  id: "call_1",
                  function: {
                    name: "write_file",
                    arguments: { path: ".wiki/test.md", content: "test content" }
                  }
                }
              ]
            }
          };
        }
        return {
          message: { content: "Done", tool_calls: [] }
        };
      })
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    expect(events).toContainEqual({ type: "done", summary: "Agent run complete" });

    // verify .last-updated.json is NOT written
    await expect(readFile(path.join(projectRoot, ".wiki", ".last-updated.json"), "utf8")).rejects.toThrow();

    // verify written wiki file has frontmatter entries
    const testMd = await readFile(path.join(projectRoot, ".wiki", "test.md"), "utf8");
    expect(testMd).toContain("last_updated:");
    expect(testMd).toContain("updated_by:");
    expect(testMd).toContain("test content");

    const report = await readFile(path.join(projectRoot, ".wiki", ".last-update-report.md"), "utf8");
    expect(report).toContain("test.md");
    expect(report).toContain("Wiki Updated");

    const title = await readFile(path.join(projectRoot, ".wiki", ".last-update-title.txt"), "utf8");
    expect(title).toContain("docs: update wiki (1 new page)");
  });

  test("appends frontmatter for init command", async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        message: { content: "Done", tool_calls: [] }
      })
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "init",
      projectRoot,
      model: "test-model",
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    const agentsMd = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Wiki Agent");

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool",
      name: "append_agents_frontmatter"
    }));
  });

  test("handles API errors gracefully", async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockRejectedValue(new Error("API Error"))
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    expect(events).toContainEqual({ type: "error", message: "API Error" });
  });

  test("stops if max iterations reached", async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        message: {
          content: "Looping",
          tool_calls: [
            {
              id: "call_1",
              function: {
                name: "run_bash",
                arguments: { command: "echo test" }
              }
            }
          ]
        }
      })
    };

    const events: AgentEvent[] = [];
    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      maxIterations: 3, // Very low max iteration
      onEvent: (event) => events.push(event)
    };

    await runAgent(mockClient, options);

    // Called 3 times matching max iterations
    expect(mockClient.chat).toHaveBeenCalledTimes(3);
  });

  test("propagates updatedBy option to written wiki files and indexes", async () => {
    const mockClient: LLMClient = {
      chat: vi.fn()
        .mockResolvedValueOnce({
          message: {
            content: "Writing file",
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "write_file",
                  arguments: { path: ".wiki/mcp-page.md", content: "---\ntitle: MCP Page\n---\n# MCP Page\n" },
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          message: { content: "Done", tool_calls: [] },
        }),
    };

    const options: RunOptions = {
      command: "update",
      projectRoot,
      model: "test-model",
      updatedBy: "mcp-server",
    };

    await runAgent(mockClient, options);

    const pageContent = await readFile(path.join(projectRoot, ".wiki", "mcp-page.md"), "utf8");
    expect(pageContent).toContain("updated_by: mcp-server");
    expect(pageContent).toContain("last_updated:");

    const indexContent = await readFile(path.join(projectRoot, ".wiki", "index.md"), "utf8");
    expect(indexContent).toContain('updated_by: "mcp-server"');
    expect(indexContent).toContain("last_updated:");
  });
});
