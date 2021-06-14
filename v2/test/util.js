'use strict'
const net = require('net')
const UTP = require('utp-native')
const dht = require('@hyperswarm/dht')
const { once } = require('nonsynchronous')

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
    closeDht (...others) {
      let missing = 1

      for (const n of others) {
        missing++
        n.destroy(done)
      }
      done()

      function done () {
        if (--missing) return
        node.destroy()
      }
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
