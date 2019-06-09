'use strict'
const net = require('net')
const UTP = require('utp-native')
const dht = require('@hyperswarm/dht')
const { once } = require('nonsynchronous')

async function dhtBootstrap () {
  const node = dht()
  await once(node, 'listening')
  const { port } = node.address()
  return {
    port,
    bootstrap: [`127.0.0.1:${port}`],
    closeDht: () => node.destroy()
  }
}

function validSocket (s) {
  if (!s) return false
  return (s instanceof net.Socket) || (s._utp && s._utp instanceof UTP)
}
validSocket.TCP = net.Socket
validSocket.UTP = UTP

module.exports = {
  dhtBootstrap,
  validSocket
}
