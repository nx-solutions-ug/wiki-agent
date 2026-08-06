import { describe, expect, it, vi } from "vitest";
import { OllamaAdapter } from "../src/llm.js";

describe("OllamaAdapter", () => {
  it("streams chunks and retains tool call id", async () => {
    const stream = async function* () {
      yield { message: { content: "", tool_calls: [{ function: { name: "test_tool", arguments: { arg: 1 } } }] } };
      yield { message: { content: "", tool_calls: [{ function: { name: "test_tool", arguments: { arg: 1, arg2: 2 } } }] } };
    };

    const mockOllama = {
      chat: vi.fn().mockResolvedValue(stream()),
    };

    const adapter = new OllamaAdapter(mockOllama as any);
    const result = await adapter.chat({ model: "test", messages: [], stream: true });

    const chunks = [];
    for await (const chunk of result as any) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0].message.tool_calls[0].id).toEqual(chunks[1].message.tool_calls[0].id);
    expect(chunks[0].message.tool_calls[0].function.arguments).toEqual({ arg: 1 });
  });

  it("handles non-streaming responses correctly", async () => {
    const mockOllama = {
      chat: vi.fn().mockResolvedValue({
        message: {
          content: "test",
          tool_calls: [
             { function: { name: "test_tool", arguments: { arg: 1 } } }
          ]
        }
      }),
    };

    const adapter = new OllamaAdapter(mockOllama as any);
    const result = await adapter.chat({ model: "test", messages: [], stream: false }) as any;

    expect(result.message.content).toEqual("test");
    expect(result.message.tool_calls[0].function.name).toEqual("test_tool");
    expect(result.message.tool_calls[0].id).toMatch(/^call_/);
  });
});
