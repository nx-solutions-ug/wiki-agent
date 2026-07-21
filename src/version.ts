import { createRequire } from "node:module";

// Read the version from package.json so the TUI and CLI stay in sync
// with releases without a hardcoded string to update.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const VERSION: string = pkg.version;