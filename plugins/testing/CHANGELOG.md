# Changelog

## [1.0.0](https://github.com/jcouball/agent-plugins/compare/testing-v0.2.1...testing-v1.0.0) (2026-10-23)


### ⚠ BREAKING CHANGES

* **testing:** a shared context that sets subject or described_instance is now a violation. Base Rules 16 to 25 are renumbered 17 to 26; the other skills cite base rules by subject and are unaffected.
* **testing:** an integration spec that asserts a message pattern on an exception whose message embeds the command line is now a violation; it asserts on the exit status and the tool's error output instead.

### Features

* **testing:** Add a shared rule on what a shared context holds ([45e767a](https://github.com/jcouball/agent-plugins/commit/45e767a1af605f0812b7ace53f0712f37de4359f)), closes [#61](https://github.com/jcouball/agent-plugins/issues/61)
* **testing:** Let a parser spec assert the parsed result exactly ([9d895d4](https://github.com/jcouball/agent-plugins/commit/9d895d4fd90a70e62fd5945363f2fa382c68b9e2)), closes [#56](https://github.com/jcouball/agent-plugins/issues/56)
* **testing:** Say how a review treats violations in specs the change did not touch ([14d63df](https://github.com/jcouball/agent-plugins/commit/14d63df69dcd886e0ac5148cf30d75a7dba1ed30)), closes [#55](https://github.com/jcouball/agent-plugins/issues/55)
* **testing:** Say when a class-family convention wins over a standards rule ([0466039](https://github.com/jcouball/agent-plugins/commit/0466039bf40f198c2544d08ccac7d8046bc98130)), closes [#53](https://github.com/jcouball/agent-plugins/issues/53)


### Bug Fixes

* **testing:** Check a wrapped failure by status and output when the message embeds the call ([04e4fb3](https://github.com/jcouball/agent-plugins/commit/04e4fb3b28bbb496146f118c572c2020af86d889)), closes [#54](https://github.com/jcouball/agent-plugins/issues/54)
* **testing:** Let a backward-compatible alias spec assert that it is its target ([6923e00](https://github.com/jcouball/agent-plugins/commit/6923e0011157285b34f1083912ee742c193cda90)), closes [#59](https://github.com/jcouball/agent-plugins/issues/59)
* **testing:** Say that an integration example never sleeps, and what it does instead ([bcdf585](https://github.com/jcouball/agent-plugins/commit/bcdf5854452a5048c750b9f5c4f8d4523a047985)), closes [#60](https://github.com/jcouball/agent-plugins/issues/60)

## [0.2.1](https://github.com/jcouball/agent-plugins/compare/testing-v0.2.0...testing-v0.2.1) (2026-10-13)


### Features

* **testing:** Add the tdd-refactor-step skill ([13d7d93](https://github.com/jcouball/agent-plugins/commit/13d7d93aefb378a0d9b87c3b808c530b26c26a64))
* **testing:** Add the test-debugging skill ([2f2a940](https://github.com/jcouball/agent-plugins/commit/2f2a94020dd129eec4176a5c3af1314d5174756a))

## [0.2.0](https://github.com/jcouball/agent-plugins/compare/testing-v0.1.0...testing-v0.2.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* **testing:** the unit test school is no longer an override point. A project override that chose sociable unit tests is no longer honored, and its specs are held to the solitary rules on stubbing.

### Features

* **testing:** Add the RSpec base, unit, and integration standards ([b8bd815](https://github.com/jcouball/agent-plugins/commit/b8bd815eeef0157c8adc7d4def634dd5a5bfcb8f))
* **testing:** Cover modules, Rails components, and system specs ([3cefab3](https://github.com/jcouball/agent-plugins/commit/3cefab358a335384ae0e6b071b55ecc216f88564))
* **testing:** Define the coverage run and cover Rails framework-bound specs ([e17b100](https://github.com/jcouball/agent-plugins/commit/e17b100ef1d422b5e98701a296f4a046c516b90a))
* **testing:** Give the testing-guide skill a runnable override search ([04232dc](https://github.com/jcouball/agent-plugins/commit/04232dc7d81fbbdc13121ac384bcea7cf1002252))
* **testing:** Open each standards skill with what its specs prove ([8987750](https://github.com/jcouball/agent-plugins/commit/8987750c25d4dc501fabed9b3c4d5ef06a682c24))


### Bug Fixes

* **testing:** Document only solitary unit tests ([5ac1ae4](https://github.com/jcouball/agent-plugins/commit/5ac1ae4823447a3c74db0a4324a06118f81e96e9))
* **testing:** Run data objects and private helpers for real in unit specs ([95f5724](https://github.com/jcouball/agent-plugins/commit/95f57249c4184bdf8274272d9cecf2a995af1635))


### Other Changes

* **testing:** Add a plugin README that points people to the rules ([54a2f72](https://github.com/jcouball/agent-plugins/commit/54a2f72b4307d31f70295f5a077a256afdb880a3))

## 0.1.0 (2026-09-22)


### Features

* **testing:** Add the testing plugin with the testing guide ([598eb57](https://github.com/jcouball/agent-plugins/commit/598eb578031cf24d73fdfbd69d417c8d5e37db26))
