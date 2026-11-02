// Preloaded into a script under test with `node --import`, to change the fetch
// it gets from Node, since the script reads it from Node and a test has no
// other way in. FAKE_FETCH_STATUS makes fetch answer every request with
// that status, so a download fails without reaching the network. FAKE_FETCH_HANG
// makes fetch never answer, while keeping the process alive, so a test can send
// a signal to a script that is waiting on the network.

const { FAKE_FETCH_HANG, FAKE_FETCH_STATUS } = process.env

if (FAKE_FETCH_HANG) {
  globalThis.fetch = () =>
    new Promise(() => {
      setInterval(() => {}, 1000)
    })
}

if (FAKE_FETCH_STATUS) globalThis.fetch = async () => ({ ok: false, status: Number(FAKE_FETCH_STATUS) })
