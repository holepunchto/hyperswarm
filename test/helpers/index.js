exports.timeout = function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.flushConnections = function (swarm) {
  return Promise.all(Array.from(swarm.connections).map(e => e.flush()))
}
