## 2024-03-24 - Ink/React TUI Re-render Bottleneck
**Learning:** The Ink TUI uses React, and when rendering a stream of events from an LLM, mutating an object reference and forcing a re-render of the array caused all past `EventLine` components to re-render constantly. `React.memo` solves this, but it REQUIRES the underlying array state updates to be immutable (`{...last, text: last.text + event.content}`).
**Action:** When optimizing React/Ink lists for streaming LLM responses, combine `React.memo` with strict immutable state updates for the active row.

## 2024-11-20 - System Tools & Default Exclusions
**Learning:** System tools like `grep` and `find` (unlike code-aware tools like `rg` or `ast-grep`) do not respect `.gitignore` by default. Invoking them without explicit exclusions on the project root causes them to deeply traverse massive directories like `node_modules` or `.git`, resulting in severe performance bottlenecks (unnecessary disk I/O and processing).
**Action:** Whenever invoking system file-traversal tools in the codebase, always hardcode explicit exclusions for known massive/generated directories (e.g. `--exclude-dir=node_modules`, `--exclude-dir=.git`, `--exclude-dir=dist`, `--exclude-dir=.wiki`).

## 2024-11-21 - File Reading Overhead
**Learning:** Loading the entire contents of a file into a single string in memory via `readFile` (e.g. `const content = await readFile(filePath, "utf8"); content.split("\n")`) just to return a specific small range of lines using an `offset` and `limit` creates major performance bottlenecks on large files (e.g., massive JSON blobs, minified JS or CSV dumps). This bloats memory usage unnecessarily and places significant pressure on garbage collection.
**Action:** When creating tools that return slices of files, always implement them defensively for massive files by using a stream based approach, e.g., with `createReadStream` and `node:readline`. This allows to lazily loop line-by-line and crucially, call `.destroy()` on the stream the exact moment the `limit` is met to halt disk I/O instantly.

## 2024-05-18 - Safe UTF-8 decoding across chunk boundaries
**Learning:** When optimizing file reading by reading in small byte chunks (e.g., via `fs.promises.open`), naive `buffer.toString("utf8")` is unsafe as it can split and corrupt multi-byte UTF-8 characters across chunk boundaries.
**Action:** Always use `StringDecoder` from `node:string_decoder` which correctly buffers partial multi-byte sequences until the next chunk provides the remaining bytes.
