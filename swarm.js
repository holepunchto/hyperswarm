'use strict'
const peerInfo = require('./lib/peer-info')
const { EventEmitter } = require('events')
const guts = require('@hyperswarm/guts')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const { bootstrap, ephemeral } = opts
    this.network = guts({
      bootstrap,
      ephemeral,
      bind: () => {
        this.emit('listening')
      },
      socket: (socket, isTCP) => {
        const info = peerInfo(null)
        info.connected(socket, isTCP)
        this.emit('connection', socket, info)
      },
      close: () => {
        this.emit('close')
      }
    })
  }
  address () {
    return this.network.address()
  }
  listen (port, cb) {
    this.network.bind(port, cb)
  }

  destroy (cb) {
    this.network.close(cb)
  }
}

module.exports.Swarm = Swarm
