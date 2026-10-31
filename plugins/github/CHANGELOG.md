# Changelog

## [3.2.0](https://github.com/jcouball/agent-plugins/compare/github-v3.1.0...github-v3.2.0) (2026-10-31)


### Features

* **github:** Audit the default GITHUB_TOKEN permissions in check-repo-config ([91660ab](https://github.com/jcouball/agent-plugins/commit/91660ab0d88b663bf044ff29a55e16e44ea7fe7c)), closes [#83](https://github.com/jcouball/agent-plugins/issues/83)
* **github:** Move the check-repo-config procedure into a tested script ([ccdd7aa](https://github.com/jcouball/agent-plugins/commit/ccdd7aa9c9e4a46239eff5ca098fcd9b9c160521)), closes [#86](https://github.com/jcouball/agent-plugins/issues/86) [#90](https://github.com/jcouball/agent-plugins/issues/90)


### Bug Fixes

* **github:** Let check-repo-config.mjs finish writing before it exits ([0a78f10](https://github.com/jcouball/agent-plugins/commit/0a78f1070f08abb3269018c6039f35562d47493f)), closes [#115](https://github.com/jcouball/agent-plugins/issues/115)
* **github:** Re-read the Actions token after a PUT until it matches ([bd20799](https://github.com/jcouball/agent-plugins/commit/bd207996ee5478a47141184d7db40134dcab9bc8)), closes [#91](https://github.com/jcouball/agent-plugins/issues/91)
* **github:** Read whether Actions is enabled before auditing the token default ([5eb8360](https://github.com/jcouball/agent-plugins/commit/5eb8360d5dba9e06a5be73df991ddb226d6272f8)), closes [#88](https://github.com/jcouball/agent-plugins/issues/88)
* **github:** Say when git is missing instead of when it is not in a repository ([30ea2ba](https://github.com/jcouball/agent-plugins/commit/30ea2bae354ae103ea6dbdd6f2d3ce6da5087832))


### Other Changes

* **github:** Check the marker counts guidance reports in the unit test ([6b44070](https://github.com/jcouball/agent-plugins/commit/6b44070034f97e61d4251bc9344173709cfcbc26))
* **github:** Cover the audit, apply and baseline branches that are left ([0709e33](https://github.com/jcouball/agent-plugins/commit/0709e33c10eeb1de0ac5a30772dec5b52b7a72d4))
* **github:** Cover the blocks of apply, audit, baseline and glob that no test ran ([0d02ff4](https://github.com/jcouball/agent-plugins/commit/0d02ff46c4ece92ba0a62090bc551a7e0654638b))
* **github:** Cover the gh runner and api() through their interfaces ([c94468a](https://github.com/jcouball/agent-plugins/commit/c94468a8ba3d357111131355dc5f935e7370588e))
* **github:** Cover the read module's failure and fallback branches ([6982151](https://github.com/jcouball/agent-plugins/commit/698215114eb8708a98ae6932bebefe4e865c7090))
* **github:** Drop checks and fallbacks that no input can reach ([bad1500](https://github.com/jcouball/agent-plugins/commit/bad15004779f95c2279e835fffecea6b6947f2fd))
* **github:** Drop fallbacks for shapes the read module rules out ([fb3f1b3](https://github.com/jcouball/agent-plugins/commit/fb3f1b370e3b7dd8289ed24c615b1e5b7a2f80a0))
* **github:** Drop two fallbacks the gh runner can never take ([024f0c9](https://github.com/jcouball/agent-plugins/commit/024f0c927b38d9715269717b5d4d513329a8e49f))
* **github:** Link git into the missing-gh test's PATH ([03728de](https://github.com/jcouball/agent-plugins/commit/03728ded82d170612243a1c27c9d89f49fa593dd))
* **github:** Read the stack of an unexpected error without a fallback ([31f2e3f](https://github.com/jcouball/agent-plugins/commit/31f2e3f45a34156fd463f6600579f8b43b4a36db))
* **github:** Run check-repo-config.mjs against a fake gh executable ([645d2e5](https://github.com/jcouball/agent-plugins/commit/645d2e5eb08aca38fec7d1e3c5c69e81b120c6ef))
* **github:** Run check-repo-config.mjs's main unconditionally ([8bcd0fa](https://github.com/jcouball/agent-plugins/commit/8bcd0fa7f27b8e837198d0d049543980df3e5b59))
* **github:** Vendor js-yaml 5.5.0 byte for byte ([c0dc69b](https://github.com/jcouball/agent-plugins/commit/c0dc69ba9d64ad0e6c6a5506bdfa3816aa06c87c))

## [3.1.0](https://github.com/jcouball/agent-plugins/compare/github-v3.0.0...github-v3.1.0) (2026-08-30)


### Features

* **github:** Add the address-pr-feedback-iteratively skill ([074e4fb](https://github.com/jcouball/agent-plugins/commit/074e4fbb96195a181a98b9c049255d163b68209d))
* **github:** Audit repo config and agent guidance against a baseline ([dc418a0](https://github.com/jcouball/agent-plugins/commit/dc418a034089b1afee6a1bc407b630602e70543b))

## [3.0.0](https://github.com/jcouball/agent-plugins/compare/github-v2.1.0...github-v3.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **github:** rename the resolve-pr-feedback skill to address-pr-feedback

### Features

* **github:** Rename the resolve-pr-feedback skill to address-pr-feedback ([9d7afcc](https://github.com/jcouball/agent-plugins/commit/9d7afcc97c0c126518006e34360b3e1599eddee9))

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
