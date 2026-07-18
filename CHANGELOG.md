## [1.1.2](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.1.1...v1.1.2) (2026-07-18)


### Bug Fixes

* add homepage and author metadata for npm package listing ([3372d1b](https://github.com/nx-solutions-ug/wiki-agent/commit/3372d1b5a0ba815c0d8ad757c5f7c465513eba33))

## [1.1.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.1.0...v1.1.1) (2026-07-18)


### Bug Fixes

* correct stale default model hint in credentials setup ([59cdcbb](https://github.com/nx-solutions-ug/wiki-agent/commit/59cdcbb05d5e4743f6166a4f426d8dc368b70b57))

# [1.1.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.0.1...v1.1.0) (2026-07-18)


### Features

* skip PR on metadata-only wiki changes and document per-file changes ([05452da](https://github.com/nx-solutions-ug/wiki-agent/commit/05452daca2ccd2fec9b6c43367e06cd6863d8b32))

## [1.0.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.0.0...v1.0.1) (2026-07-18)


### Bug Fixes

* normalize package.json for npm publish (bin path, repo url) ([f8290ef](https://github.com/nx-solutions-ug/wiki-agent/commit/f8290efd66cb5ea385b6495cf502cfc7da918580))

# 1.0.0 (2026-07-18)


### Bug Fixes

* always refresh workflow file + use timestamp-based branch names ([40f99b8](https://github.com/nx-solutions-ug/wiki-agent/commit/40f99b82ade803ec35e6124bc0a6cbfdae6b424e))
* correct cloud host to https://ollama.com and use bun for packing ([22e0c82](https://github.com/nx-solutions-ug/wiki-agent/commit/22e0c82e8ef3e06d6dc00ad205da6e13c6f1e5a6))
* **deps:** update dependency ink to v7 ([d23e2cb](https://github.com/nx-solutions-ug/wiki-agent/commit/d23e2cbdde0676a7f76a27e32803ea06a78d153e))
* **deps:** update dependency marked to v18 ([db28ffc](https://github.com/nx-solutions-ug/wiki-agent/commit/db28ffca02409da332d5d3d507316ea18d80c1b6))
* ensure GITHUB_OUTPUT heredoc delimiter is on its own line ([8d04b26](https://github.com/nx-solutions-ug/wiki-agent/commit/8d04b26919f8de7aaad0399920443691ddb71603))
* pass generated app token to create-pull-request in workflow template ([4ff9658](https://github.com/nx-solutions-ug/wiki-agent/commit/4ff9658527fd4e9ce2357c1a73cc33bab897ace6))
* publish under nx-solutions-ug/wiki-agent ([73eb843](https://github.com/nx-solutions-ug/wiki-agent/commit/73eb843f631f0127acf4a23092f4d3966369a421))
* restore WIKI AGENT banner in help text ([13b78c1](https://github.com/nx-solutions-ug/wiki-agent/commit/13b78c1f3e6dcdb5b0fe0981185980c2f4e66ac9))
* separate assistant prose from tool output in headless and TUI ([ed3b70e](https://github.com/nx-solutions-ug/wiki-agent/commit/ed3b70e6b9a606771acbdb70c0e1b2f33d059d1a))
* show only tool call markers in TUI instead of streaming results ([1b14b26](https://github.com/nx-solutions-ug/wiki-agent/commit/1b14b2672f3d8844a137ff098a7afe127c280b76)), closes [#1](https://github.com/nx-solutions-ug/wiki-agent/issues/1) [#2](https://github.com/nx-solutions-ug/wiki-agent/issues/2)
* trim help banner to spell only WIKI ([9c1443c](https://github.com/nx-solutions-ug/wiki-agent/commit/9c1443ca1b77c4aec7e3d8d0ebb9f6845bb09bb9))
* update GitHub Actions to latest versions ([f0cf6f5](https://github.com/nx-solutions-ug/wiki-agent/commit/f0cf6f50c024ddebb6072474c2f26e41bb327c64))
* use APP_ID and APP_PRIVATE_KEY secrets (no WIKI_ prefix) ([08f9393](https://github.com/nx-solutions-ug/wiki-agent/commit/08f9393c58cf2644c68e842045e9a8ea08e26857))


### Features

* add explicit read instruction and positive tests for AGENTS.md/CLAUDE.md ([32f7c91](https://github.com/nx-solutions-ug/wiki-agent/commit/32f7c91a8fb75c14870afc6fee9e6a29249885cc))
* block self-invocation of wiki CLI from execute tool ([850f462](https://github.com/nx-solutions-ug/wiki-agent/commit/850f46227006dd11e48a92dc57299ad7093a423a))
* create .github/workflows/update-wiki.yml on --init ([94e9b74](https://github.com/nx-solutions-ug/wiki-agent/commit/94e9b742f3d0af90cf7be098f418e9e129d48ec1))
* create .wiki/.last-updated.json with timestamp after each run ([9a455aa](https://github.com/nx-solutions-ug/wiki-agent/commit/9a455aa15b017175d29733393d05e9cef5a0f82b))
* create a new PR each run with wiki/update-${unix-timestamp} branch ([35b5c0d](https://github.com/nx-solutions-ug/wiki-agent/commit/35b5c0d3297b9d7b9224400508050e250a85fc77))
* default cloud model to kimi-k2.7-code ([c542633](https://github.com/nx-solutions-ug/wiki-agent/commit/c542633e26d21baaeb65b644164fe9750a0ab5d1))
* default to assistant-prose-only output, add --verbose for full log ([0f55120](https://github.com/nx-solutions-ug/wiki-agent/commit/0f55120ee9e0ddb0bea86a7cd750ad95d02746e3))
* generate change report for PR body + github-app-token support ([78c74a5](https://github.com/nx-solutions-ug/wiki-agent/commit/78c74a59a5b86197d9f58b7f90db7d47b3070599))
* read and acknowledge AGENTS.md/CLAUDE.md from repo root ([d052e04](https://github.com/nx-solutions-ug/wiki-agent/commit/d052e045d49b66f3b8faa039dd56b667c525bfb7))
* restrict agent to read-only git and add ast-grep tools ([3c4db5b](https://github.com/nx-solutions-ug/wiki-agent/commit/3c4db5bf1d920aacfb71f02ede2edb1eb65cb3ed))
* skip all file writes and PR creation when wiki is already current ([dd51076](https://github.com/nx-solutions-ug/wiki-agent/commit/dd51076b73c0677f60258aaec6c46316f30d875e))
* standalone Ollama-only documentation agent ([ef61add](https://github.com/nx-solutions-ug/wiki-agent/commit/ef61add04ac501fabe1c626d367574683d53123c))
