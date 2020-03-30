'use strict'
const net = require('net')
const UTP = require('utp-native')
const dht = require('@hyperswarm/dht')
const { once, promisifyMethod } = require('nonsynchronous')

async function dhtBootstrap () {
  const node = dht({
    bootstrap: [],
    ephemeral: true
  })
  node.listen()
  await once(node, 'listening')
  const { port } = node.address()
  return {
    port,
    bootstrap: [`127.0.0.1:${port}`],
    async closeDht (...nodes) {
      for (const n of nodes) {
        promisifyMethod(n, 'destroy')
        await n.destroy()
      }
      node.destroy()
      await once(node, 'close')
    }
  }
}

function validSocket (s) {
  if (!s) return false
  return (s instanceof net.Socket) || (s._utp && s._utp instanceof UTP)
}

module.exports = {
  dhtBootstrap,
  validSocket
}
