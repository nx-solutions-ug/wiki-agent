# [1.18.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.17.1...v1.18.0) (2026-08-27)


### Features

* add last_updated and updated_by frontmatter to wiki files ([#148](https://github.com/nx-solutions-ug/wiki-agent/issues/148)) ([87f1ae2](https://github.com/nx-solutions-ug/wiki-agent/commit/87f1ae269735482f7daf383183dddae03d6ef563))

## [1.17.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.17.0...v1.17.1) (2026-08-18)


### Bug Fixes

* restore CLI entrypoint guard to prevent silent exit on import ([#140](https://github.com/nx-solutions-ug/wiki-agent/issues/140)) ([44dafc2](https://github.com/nx-solutions-ug/wiki-agent/commit/44dafc28a47981f319f77cd5bbee2355e2670fb8))

# [1.17.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.16.0...v1.17.0) (2026-08-18)


### Features

* add MCP server with streamable stdio transport and embeddings database ([#138](https://github.com/nx-solutions-ug/wiki-agent/issues/138)) ([ec30bd0](https://github.com/nx-solutions-ug/wiki-agent/commit/ec30bd01347cb694657c5588c617fbc99805235a))

# [1.16.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.15.1...v1.16.0) (2026-08-07)


### Features

* **tui:** expose all provider config options in interactive setup ([8d9e19b](https://github.com/nx-solutions-ug/wiki-agent/commit/8d9e19b448c6ae1607f611361ff6778866cefcaf))

## [1.15.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.15.0...v1.15.1) (2026-08-07)


### Bug Fixes

* **issue-121:** document OpenAI-compatible provider in README ([#123](https://github.com/nx-solutions-ug/wiki-agent/issues/123)) ([754ea78](https://github.com/nx-solutions-ug/wiki-agent/commit/754ea78b70dd655878db9071d4d1088ed54ba420)), closes [#120](https://github.com/nx-solutions-ug/wiki-agent/issues/120)

# [1.15.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.14.0...v1.15.0) (2026-08-07)


### Features

* add openai compatible provider support ([#120](https://github.com/nx-solutions-ug/wiki-agent/issues/120)) ([ab3d5bc](https://github.com/nx-solutions-ug/wiki-agent/commit/ab3d5bc7d9352545bd7d9088d36e229e579a73c8))

# [1.14.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.13.2...v1.14.0) (2026-07-28)


### Bug Fixes

* include APPROVED state in review thread dedup filter ([2396774](https://github.com/nx-solutions-ug/wiki-agent/commit/239677429a6ae29ad5d0b27efc0dbf76cd6aa0cc))


### Features

* add eyes reaction to /omp trigger comments ([28ced37](https://github.com/nx-solutions-ug/wiki-agent/commit/28ced37c1ff7b7d0975b308bd13636ebf9325c5a))

## [1.13.2](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.13.1...v1.13.2) (2026-07-28)


### Bug Fixes

* resolve review threads and approve PR when all findings addressed ([c2ba538](https://github.com/nx-solutions-ug/wiki-agent/commit/c2ba538b134e4b078a2580f0fd4128bd5bee5fe7))

## [1.13.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.13.0...v1.13.1) (2026-07-27)


### Bug Fixes

* **omp:** ensure /omp PR commands commit and push changes ([#96](https://github.com/nx-solutions-ug/wiki-agent/issues/96)) ([a98a157](https://github.com/nx-solutions-ug/wiki-agent/commit/a98a1570faf79756bb062affb111c7ffe4d6547c)), closes [nx-solutions-ug/chronova#637](https://github.com/nx-solutions-ug/chronova/issues/637)

# [1.13.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.12.4...v1.13.0) (2026-07-27)


### Features

* append wiki-agent section to AGENTS.md/CLAUDE.md on --init ([f0c5d6a](https://github.com/nx-solutions-ug/wiki-agent/commit/f0c5d6a0c0545a5ef917bf07e91d8a5f46f8926b))

## [1.12.4](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.12.3...v1.12.4) (2026-07-27)


### Bug Fixes

* stop leaking agent planning prose into reports; untrack run metadata files ([2e45dd6](https://github.com/nx-solutions-ug/wiki-agent/commit/2e45dd65e92ef4654b800ff43d5ecf292f70f822)), closes [#94](https://github.com/nx-solutions-ug/wiki-agent/issues/94)

## [1.12.3](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.12.2...v1.12.3) (2026-07-27)


### Bug Fixes

* harden thinking-tag regex for case-insensitivity and nesting ([631b469](https://github.com/nx-solutions-ug/wiki-agent/commit/631b46995b634100236af3219621409a11bd69df))
* strip reasoning/thinking tags from generated wiki content ([a7b24c4](https://github.com/nx-solutions-ug/wiki-agent/commit/a7b24c4ab581feda11e5152049458599916984ca)), closes [#79](https://github.com/nx-solutions-ug/wiki-agent/issues/79)

## [1.12.2](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.12.1...v1.12.2) (2026-07-27)


### Bug Fixes

* **index:** propagate frontmatter errors and bound concurrency ([61c132e](https://github.com/nx-solutions-ug/wiki-agent/commit/61c132e7a90d23173634ccb391461f2e3ca46180))


### Performance Improvements

* **index:** parallelize and chunk directory synchronization ([64d5a5c](https://github.com/nx-solutions-ug/wiki-agent/commit/64d5a5c83e4c9703d82c150da4e8052be9796878))
* **index:** parallelize directory synchronization ([39ebbbf](https://github.com/nx-solutions-ug/wiki-agent/commit/39ebbbf6cdb8c86126436158c04c4fe376af2174))

## [1.12.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.12.0...v1.12.1) (2026-07-26)


### Bug Fixes

* update actions/checkout to v7 in vouch-manage workflow ([b5c41cf](https://github.com/nx-solutions-ug/wiki-agent/commit/b5c41cf630146497dda44d994f0f202b6ca0fba1))

# [1.12.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.11.1...v1.12.0) (2026-07-26)


### Features

* add lightweight vouch system for PR gating via discussions ([d9f582d](https://github.com/nx-solutions-ug/wiki-agent/commit/d9f582dddff7daf29677f07f3b80000bbc1a5878))

## [1.11.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.11.0...v1.11.1) (2026-07-26)


### Bug Fixes

* **issue-76:** prevent stream-log.py from crashing on non-dict args or non-string text ([f2e7293](https://github.com/nx-solutions-ug/wiki-agent/commit/f2e72937fd175bd51fad4f2ea156bf0cbaa31464))

# [1.11.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.10.0...v1.11.0) (2026-07-26)


### Features

* reflect actual wiki changes in staging PR title and commit message ([1cd3393](https://github.com/nx-solutions-ug/wiki-agent/commit/1cd33934c5de8761766485060f54a16d32c34eab))

# [1.10.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.9.1...v1.10.0) (2026-07-25)


### Features

* add concurrency control to wiki update workflow ([afc5f89](https://github.com/nx-solutions-ug/wiki-agent/commit/afc5f89bcd73b52ba448bbf89bc5aa5652384174))

## [1.9.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.9.0...v1.9.1) (2026-07-24)


### Bug Fixes

* crop banner to 3:1 ratio for better README display ([1a7b2f0](https://github.com/nx-solutions-ug/wiki-agent/commit/1a7b2f0c1c27e77b5cc3b1ebf8dc9636ba778ec2))

# [1.9.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.8.1...v1.9.0) (2026-07-24)


### Features

* add FLUX 2 Max generated README banner ([4895dc1](https://github.com/nx-solutions-ug/wiki-agent/commit/4895dc16b84a286f7bd2a5bb1cc24ca86d8b4ade))

## [1.8.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.8.0...v1.8.1) (2026-07-22)


### Bug Fixes

* add omp configurations ([9c19ac8](https://github.com/nx-solutions-ug/wiki-agent/commit/9c19ac869d7d1a1262b47bf7a05eb34c21a9988e))

# [1.8.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.7.1...v1.8.0) (2026-07-21)


### Features

* **cli:** add --version flag and display version in help banner ([c93327a](https://github.com/nx-solutions-ug/wiki-agent/commit/c93327a2cfd1254209d84c1bb501f420a7bf9e18))

## [1.7.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.7.0...v1.7.1) (2026-07-21)


### Bug Fixes

* **tui:** show correct version from package.json instead of hardcoded 0.1.0 ([7003a09](https://github.com/nx-solutions-ug/wiki-agent/commit/7003a09e9ace692a340d263fb8eefaf7b2cdb092))

# [1.7.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.5...v1.7.0) (2026-07-21)


### Features

* **gh-tool:** allow pr close/comment on stale wiki staging PRs ([2346351](https://github.com/nx-solutions-ug/wiki-agent/commit/23463519075e26db150eb11177ebedbbdfe9ef71)), closes [#tool](https://github.com/nx-solutions-ug/wiki-agent/issues/tool)

## [1.6.5](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.4...v1.6.5) (2026-07-21)


### Bug Fixes

* **agent:** add setup-node and GH_TOKEN to generated workflow template ([b1832d2](https://github.com/nx-solutions-ug/wiki-agent/commit/b1832d233a1ae97f01361828f6fde8a58cea9faf))

## [1.6.4](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.3...v1.6.4) (2026-07-21)


### Bug Fixes

* **ci:** bump node-version to 25 in update-wiki workflow ([3b329a8](https://github.com/nx-solutions-ug/wiki-agent/commit/3b329a8a048a998221078fb9ef954107058e2987))

## [1.6.3](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.2...v1.6.3) (2026-07-21)


### Bug Fixes

* **flatten-wiki:** detect wiki-flatten bin name in CLI entrypoint ([a2b1fd4](https://github.com/nx-solutions-ug/wiki-agent/commit/a2b1fd481242c8faaf91dcf30303175e9074c2b9))

## [1.6.2](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.1...v1.6.2) (2026-07-21)


### Bug Fixes

* **ci:** pass GH_TOKEN to wiki --update for gh CLI authentication ([8a7fc7c](https://github.com/nx-solutions-ug/wiki-agent/commit/8a7fc7ccbe285d8524506227a25ad8052589a689))

## [1.6.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.6.0...v1.6.1) (2026-07-21)


### Bug Fixes

* **ci:** add setup-node step to update-wiki workflow ([b8051d9](https://github.com/nx-solutions-ug/wiki-agent/commit/b8051d9c28955e9d6c7e1d07c03b485b04baf110))

# [1.6.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.5.1...v1.6.0) (2026-07-21)


### Features

* **tools:** add read-only gh CLI tool with staging PR staleness check ([01e294b](https://github.com/nx-solutions-ug/wiki-agent/commit/01e294b3c4378d21723cf5b19b02b06579887881))

## [1.5.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.5.0...v1.5.1) (2026-07-21)


### Bug Fixes

* **flatten-wiki:** strip YAML frontmatter before publishing to GitHub Wiki ([ec8a2b8](https://github.com/nx-solutions-ug/wiki-agent/commit/ec8a2b86a178f6a6ab3de64d1c28aeb117b46cb0))

# [1.5.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.4.0...v1.5.0) (2026-07-20)


### Features

* install wiki-agent via bun instead of cloning+building ([705eeae](https://github.com/nx-solutions-ug/wiki-agent/commit/705eeaecc936419c20a5e68932cfa56c866059df))

# [1.4.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.3.1...v1.4.0) (2026-07-20)


### Features

* flatten .wiki/ to GitHub Wiki format before publishing ([3358b3e](https://github.com/nx-solutions-ug/wiki-agent/commit/3358b3eace6753fe689214eb9ab5c8f24d446ff0))

## [1.3.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.3.0...v1.3.1) (2026-07-20)


### Bug Fixes

* push directly to wiki master instead of PR ([1074928](https://github.com/nx-solutions-ug/wiki-agent/commit/107492836d67f0825707189e500cef1741f3a5c2))

# [1.3.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.2.2...v1.3.0) (2026-07-20)


### Features

* gate wiki tab publish behind --wiki flag ([4932155](https://github.com/nx-solutions-ug/wiki-agent/commit/49321554b909e4b5ca45f2f2d825898c96136d90))

## [1.2.2](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.2.1...v1.2.2) (2026-07-20)


### Bug Fixes

* protect wiki clone .git from rsync --delete ([8916fbd](https://github.com/nx-solutions-ug/wiki-agent/commit/8916fbd882722f68da0bea186bda7ae1f7d2fbcb))

## [1.2.1](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.2.0...v1.2.1) (2026-07-20)


### Bug Fixes

* drop stray OpenWiki reference in update prompt ([434ee61](https://github.com/nx-solutions-ug/wiki-agent/commit/434ee61b27a4cd847c8759d870410021f9a3c4aa))

# [1.2.0](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.1.4...v1.2.0) (2026-07-20)


### Features

* publish wiki to the GitHub Wiki tab via wiki.git PR ([94a1743](https://github.com/nx-solutions-ug/wiki-agent/commit/94a1743d77718696bbe51c42cf735effbf257d33))

## [1.1.4](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.1.3...v1.1.4) (2026-07-18)


### Bug Fixes

* publish under [@chronova](https://github.com/chronova) scope (npm org nx-solutions-ug does not exist) ([6aec0cc](https://github.com/nx-solutions-ug/wiki-agent/commit/6aec0cc8fbfc6214bdcaebf2a8b8fe630edf8132))

## [1.1.3](https://github.com/nx-solutions-ug/wiki-agent/compare/v1.1.2...v1.1.3) (2026-07-18)


### Bug Fixes

* grant id-token:write permission for npm OIDC trusted publishing ([86bec14](https://github.com/nx-solutions-ug/wiki-agent/commit/86bec14a32817943a9bf3d6753f1b5ff9cd0053e))

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
