import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { VERSION } from "../src/version.ts";

describe("version", () => {
  test("VERSION matches package.json", async () => {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  test("VERSION is not the stale 0.1.0", () => {
    expect(VERSION).not.toBe("0.1.0");
  });
});