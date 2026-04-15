exports.timeout = function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.waitFor = async function waitFor(fn, timeout = 2000, interval = 20) {
  const started = Date.now()

  while (!fn()) {
    if (Date.now() - started > timeout) {
      throw new Error('Timed out waiting for test condition')
    }

    await exports.timeout(interval)
  }
}

exports.flushConnections = async function (swarm) {
  await swarm.flush()
  await Promise.all(Array.from(swarm.connections).map((e) => e.flush()))
  await new Promise((resolve) => setImmediate(resolve))
}
