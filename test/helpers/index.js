exports.timeout = function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.flushConnections = async function (swarm) {
  await swarm.flush()
  return Promise.all(Array.from(swarm.connections).map(e => e.flush()))
}
