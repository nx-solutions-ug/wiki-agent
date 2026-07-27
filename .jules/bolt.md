## 2024-03-24 - Ink/React TUI Re-render Bottleneck
**Learning:** The Ink TUI uses React, and when rendering a stream of events from an LLM, mutating an object reference and forcing a re-render of the array caused all past `EventLine` components to re-render constantly. `React.memo` solves this, but it REQUIRES the underlying array state updates to be immutable (`{...last, text: last.text + event.content}`).
**Action:** When optimizing React/Ink lists for streaming LLM responses, combine `React.memo` with strict immutable state updates for the active row.
