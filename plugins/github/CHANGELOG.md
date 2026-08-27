# Changelog

## [2.1.0](https://github.com/jcouball/agent-plugins/compare/github-v2.0.0...github-v2.1.0) (2026-08-27)


### Features

* **github:** Fall back to a same-named skill file in override lookup ([00bf138](https://github.com/jcouball/agent-plugins/commit/00bf13848f8b8924959c742b9a7af0dc4d4cd716))
* **github:** Read project-local overrides in rebase ([3213795](https://github.com/jcouball/agent-plugins/commit/3213795d5690f6d37f61f9af84f7bf059f1e0542))

## [2.0.0](https://github.com/jcouball/agent-plugins/compare/github-v1.1.1...github-v2.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **github:** rename the resolve-feedback skill to resolve-pr-feedback

### Features

* **github:** Read project-local overrides in resolve-pr-feedback ([3fb88e8](https://github.com/jcouball/agent-plugins/commit/3fb88e8100cbad26c501612797eb448fa2814ded))
* **github:** Rename the resolve-feedback skill to resolve-pr-feedback ([4ebe562](https://github.com/jcouball/agent-plugins/commit/4ebe56229851c7ed2c00beb00e818c7b5bbb8a15))


### Bug Fixes

* **resolve-feedback:** Keep step 8 code blocks out of the ordered list ([c713741](https://github.com/jcouball/agent-plugins/commit/c71374177e28c33c8930d681296d62aeeb4a1373))

## [1.1.1](https://github.com/jcouball/agent-plugins/compare/github-v1.1.0...github-v1.1.1) (2026-08-26)


### Bug Fixes

* **resolve-feedback:** Match Copilot's real suppressed-comments markers ([d3922be](https://github.com/jcouball/agent-plugins/commit/d3922bef1c70aa92056e0a19b6a4c2aafe561be0))
* **resolve-feedback:** Request the Copilot re-review with gh ([fc03e42](https://github.com/jcouball/agent-plugins/commit/fc03e4263f6d43fc6fb57758ff0bcecd01785242))

## [1.1.0](https://github.com/jcouball/agent-plugins/compare/github-v1.0.0...github-v1.1.0) (2026-08-25)


### Features

* **github:** Vendor rebase from ruby-git ([2712806](https://github.com/jcouball/agent-plugins/commit/2712806782f7c2b3f1d05414edaf41236c4c9156))


### Other Changes

* **github:** Generalize rebase for any project ([b7426c1](https://github.com/jcouball/agent-plugins/commit/b7426c1ddab9415b6093642543da6f7cdfa7aac4))
