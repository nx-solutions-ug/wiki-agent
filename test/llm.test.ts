import { describe, expect, it, vi } from "vitest";
import { OpenAIAdapter } from "../src/llm.js";
import type OpenAI from "openai";

describe("OpenAIAdapter", () => {
  it("streams chunks and accumulates tool calls", async () => {
    const stream = async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_123", function: { name: "test_tool" } }] } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"arg' } }] } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '": 1}' } }] } }] };
      yield { choices: [{ delta: { content: "test" } }] };
    };

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(stream()),
        },
      },
    };

    const adapter = new OpenAIAdapter(mockOpenAI as unknown as OpenAI);
    const result = await adapter.chat({ model: "test", messages: [], stream: true });

    const chunks = [];
    for await (const chunk of result) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2); // One for content, one for final tool_calls
    expect(chunks[0]).toEqual({ message: { content: "test" } });
    expect(chunks[1]).toEqual({
      message: {
        tool_calls: [
          { id: "call_123", function: { name: "test_tool", arguments: { arg: 1 } } },
        ],
      },
    });
  });

  it("streams chunks where name arrives later", async () => {
    const stream = async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_456" }] } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "delayed_tool" } }] } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"arg": 2}' } }] } }] };
    };

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue(stream()),
        },
      },
    };

    const adapter = new OpenAIAdapter(mockOpenAI as unknown as OpenAI);
    const result = await adapter.chat({ model: "test", messages: [], stream: true });

    const chunks = [];
    for await (const chunk of result) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      message: {
        tool_calls: [
          { id: "call_456", function: { name: "delayed_tool", arguments: { arg: 2 } } },
        ],
      },
    });
  });

  it("handles non-streaming responses correctly", async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: "test",
                tool_calls: [
                   { id: "call_123", function: { name: "test_tool", arguments: { arg: 1 } } }
                ]
              }
            }]
          }),
        },
      },
    };

    const adapter = new OpenAIAdapter(mockOpenAI as unknown as OpenAI);
    const result = await adapter.chat({ model: "test", messages: [], stream: false });

    expect(result).toEqual({
      message: {
        content: "test",
        tool_calls: [
          { id: "call_123", function: { name: "test_tool", arguments: { arg: 1 } } },
        ],
      },
    });
  });
});
