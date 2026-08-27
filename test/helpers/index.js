const DHT = require('hyperdht')

exports.timeout = function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

exports.flushConnections = async function (swarm) {
  await swarm.flush()
  await Promise.all(Array.from(swarm.connections).map((e) => e.flush()))
  await new Promise((resolve) => setImmediate(resolve))
}

exports.createDHT = function createDHT(bootstrap) {
  return new DHT({ bootstrap, host: '127.0.0.1' })
}
