'use strict'

module.exports = peer => new PeerInfo(peer)

const PROVEN = 0b1
const RECONNECT = 0b10
const BANNED = 0b100
const ACTIVE = 0b1000
const TRIED = 0b10000
const FIREWALLED = 0b100000

const BANNED_OR_ACTIVE = BANNED | ACTIVE
const ACTIVE_OR_TRIED = ACTIVE | TRIED

class PeerInfo {
  constructor (peer) {
    this.priority = (peer && peer.local) ? 3 : 2
    this.status = RECONNECT | FIREWALLED
    this.retries = 0
    this.peer = peer || null
    this.client = peer !== null
    this.stream = null

    this._index = 0
  }

  get type () {
    return this.status & FIREWALLED ? 'utp' : 'tcp'
  }

  get firewalled () {
    return !!(this.status & FIREWALLED)
  }

  reconnect (val) {
    if (val) this.status |= RECONNECT
    else this.status &= ~RECONNECT
  }

  active (val) {
    if (val) this.status |= ACTIVE_OR_TRIED
    else this.status &= ~ACTIVE
  }

  connected (stream, isTCP) {
    if (isTCP) this.status &= ~FIREWALLED
    this.status |= PROVEN
    this.stream = stream
    this.retries = 0
    if (this.status & BANNED) this.ban()
  }

  disconnected () {
    this.stream = null
  }

  update () {
    if (this.status & BANNED_OR_ACTIVE) return false
    if (this.retries > 3) return false
    this.priority = priority(this)
    return true
  }

  ban () {
    this.destroy(new Error('Peer was banned'))
  }

  destroy (err) {
    this.status |= BANNED
    if (this.stream && !this.stream.destroyed) this.stream.destroy(err)
    this.disconnected()
  }

  requeue () {
    if (this.status & BANNED) return -1
    if (!(this.status & RECONNECT)) return -1
    if (this.retries >= 3) return -1
    return this.retries++
  }
}

function priority (info) {
  if ((info.status & TRIED) && !(info.status & PROVEN)) return 0
  if (info.retries === 3) return 1
  if (info.retries === 2) return 4
  if (info.retries === 1) return 5
  return (info.peer && info.peer.local) ? 3 : 2
}
