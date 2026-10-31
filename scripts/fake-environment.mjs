// Preloaded into a script under test with `node --import`, to change what
// Node itself reports to it, since the script reads these from Node and a test
// has no other way in. FAKE_FETCH_STATUS makes fetch answer every request with
// that status, so a download fails without reaching the network, and
// FAKE_PLATFORM makes os.platform() return that name.

import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'

const { FAKE_FETCH_STATUS, FAKE_PLATFORM } = process.env

if (FAKE_FETCH_STATUS) globalThis.fetch = async () => ({ ok: false, status: Number(FAKE_FETCH_STATUS) })

if (FAKE_PLATFORM) {
  os.platform = () => FAKE_PLATFORM
  // A named import of a built-in module is a copy made at load time, so the
  // change has to be published to it.
  syncBuiltinESMExports()
}
