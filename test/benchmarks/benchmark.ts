import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const projectRoot = process.cwd();

async function loadRepoInstructionsSeq(projectRoot: string): Promise<string | null> {
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const content = await readFile(path.join(projectRoot, filename), "utf8");
      return content.trim();
    } catch {
    }
  }
  return null;
}

async function loadRepoInstructionsPar(projectRoot: string): Promise<string | null> {
  const [agents, claude] = await Promise.allSettled([
    readFile(path.join(projectRoot, "AGENTS.md"), "utf8"),
    readFile(path.join(projectRoot, "CLAUDE.md"), "utf8")
  ]);

  if (agents.status === "fulfilled") {
    return agents.value.trim();
  }
  if (claude.status === "fulfilled") {
    return claude.value.trim();
  }
  return null;
}

async function run() {
  const iter = 10000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    await loadRepoInstructionsSeq(projectRoot);
    await loadRepoInstructionsPar(projectRoot);
  }

  let start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsSeq(projectRoot);
  }
  let end = performance.now();
  console.log("Sequential (AGENTS.md exists): " + (end - start).toFixed(2) + "ms");

  start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsPar(projectRoot);
  }
  end = performance.now();
  console.log("Parallel (AGENTS.md exists): " + (end - start).toFixed(2) + "ms");

  // Move AGENTS.md to simulate only CLAUDE.md existing
  const fs = require("node:fs");
  fs.renameSync("AGENTS.md", "AGENTS.md.bak");
  fs.writeFileSync("CLAUDE.md", "test content");

  start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsSeq(projectRoot);
  }
  end = performance.now();
  console.log("Sequential (CLAUDE.md exists): " + (end - start).toFixed(2) + "ms");

  start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsPar(projectRoot);
  }
  end = performance.now();
  console.log("Parallel (CLAUDE.md exists): " + (end - start).toFixed(2) + "ms");

  // Simulate neither existing
  fs.renameSync("CLAUDE.md", "CLAUDE.md.bak");

  start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsSeq(projectRoot);
  }
  end = performance.now();
  console.log("Sequential (Neither exists): " + (end - start).toFixed(2) + "ms");

  start = performance.now();
  for (let i = 0; i < iter; i++) {
    await loadRepoInstructionsPar(projectRoot);
  }
  end = performance.now();
  console.log("Parallel (Neither exists): " + (end - start).toFixed(2) + "ms");

  // Restore
  fs.renameSync("AGENTS.md.bak", "AGENTS.md");
  fs.unlinkSync("CLAUDE.md.bak");
}

run();
