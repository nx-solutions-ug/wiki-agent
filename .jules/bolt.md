## 2024-03-24 - Ink/React TUI Re-render Bottleneck
**Learning:** The Ink TUI uses React, and when rendering a stream of events from an LLM, mutating an object reference and forcing a re-render of the array caused all past `EventLine` components to re-render constantly. `React.memo` solves this, but it REQUIRES the underlying array state updates to be immutable (`{...last, text: last.text + event.content}`).
**Action:** When optimizing React/Ink lists for streaming LLM responses, combine `React.memo` with strict immutable state updates for the active row.

## 2024-11-20 - System Tools & Default Exclusions
**Learning:** System tools like `grep` and `find` (unlike code-aware tools like `rg` or `ast-grep`) do not respect `.gitignore` by default. Invoking them without explicit exclusions on the project root causes them to deeply traverse massive directories like `node_modules` or `.git`, resulting in severe performance bottlenecks (unnecessary disk I/O and processing).
**Action:** Whenever invoking system file-traversal tools in the codebase, always hardcode explicit exclusions for known massive/generated directories (e.g. `--exclude-dir=node_modules`, `--exclude-dir=.git`, `--exclude-dir=dist`, `--exclude-dir=.wiki`).

## 2024-11-21 - File Reading Overhead
**Learning:** Loading the entire contents of a file into a single string in memory via `readFile` (e.g. `const content = await readFile(filePath, "utf8"); content.split("\n")`) just to return a specific small range of lines using an `offset` and `limit` creates major performance bottlenecks on large files (e.g., massive JSON blobs, minified JS or CSV dumps). This bloats memory usage unnecessarily and places significant pressure on garbage collection.
**Action:** When creating tools that return slices of files, always implement them defensively for massive files by using a stream based approach, e.g., with `createReadStream` and `node:readline`. This allows to lazily loop line-by-line and crucially, call `.destroy()` on the stream the exact moment the `limit` is met to halt disk I/O instantly.
## 2024-05-18 - [Optimize Tool Lookup]
**Learning:** Re-creating arrays of configuration data inside hot loops like command execution causes significant overhead via allocations and GC pressure.
**Action:** Use a `Map` structure to memoize tool sets by project root and lookup tool definitions in O(1) time.
## 2024-05-18 - [Add Invalidation and Testing to Tool Caching]
**Learning:** Even internal cache structures designed for performance optimizations should be properly tested and have invalidation mechanisms to avoid leaking state across tests or environments.
**Action:** Exported `_toolsCache` and `clearToolsCache` to test the internal caching behavior of `executeTool`.

## 2024-05-16 - Pre-calculate arrays outside tight loops
**Learning:** Mapping over arrays inside a tight execution loop forces repeated array allocations and iterations, drastically impacting performance.
**Action:** When working in tight loops (like the `runAgent` loop calling chat completion), extract static map operations (e.g. `tools.map(t => t.definition)`) to a variable outside the loop.
