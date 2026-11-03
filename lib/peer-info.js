const { EventEmitter } = require('events')
const unslab = require('unslab')

const MIN_CONNECTION_TIME = 15000

const VERY_LOW_PRIORITY = 0
const LOW_PRIORITY = 1
const NORMAL_PRIORITY = 2
const HIGH_PRIORITY = 3
const VERY_HIGH_PRIORITY = 4

// Topic ids below this live in a small integer, the rest in a sorted id list
const INLINE_TOPICS = 30

module.exports = class PeerInfo extends EventEmitter {
  constructor({ publicKey, relayAddresses }) {
    super()

    this.publicKey = unslab(publicKey)
    this.relayAddresses = relayAddresses

    this.reconnecting = true
    this.proven = false
    this.connectedTime = -1
    this.disconnectedTime = 0
    this.banned = false
    this.tried = false
    this.explicit = false
    this.waiting = false
    this.forceRelaying = false

    // Set by the Swarm
    this.queued = false
    this.client = false
    this.topics = [] // TODO: remove on next major (check with mafintosh for context)

    this.attempts = 0
    this.priority = NORMAL_PRIORITY

    // Used by shuffled-priority-queue
    this._index = 0

    // Used for flush management
    this._flushTick = 0

    // Used for topic multiplexing, keyed by swarm topic id
    this._topicBits = 0
    this._topicSpill = null
    this._topicSpillLength = 0
  }

  get server() {
    return !this.client
  }

  get prioritized() {
    return this.priority >= NORMAL_PRIORITY
  }

  _getPriority() {
    const peerIsStale = this.tried && !this.proven
    if (peerIsStale || this.attempts > 3) return VERY_LOW_PRIORITY
    if (this.attempts === 3) return LOW_PRIORITY
    if (this.attempts === 2) return HIGH_PRIORITY
    if (this.attempts === 1) return VERY_HIGH_PRIORITY
    return NORMAL_PRIORITY
  }

  _connected() {
    this.proven = true
    this.connectedTime = Date.now()
  }

  _disconnected() {
    this.disconnectedTime = Date.now()
    if (this.connectedTime > -1) {
      if (this.disconnectedTime - this.connectedTime >= MIN_CONNECTION_TIME) this.attempts = 0 // fast retry
      this.connectedTime = -1
    }
    this.attempts++
  }

  _deprioritize() {
    this.attempts = 3
  }

  _reset() {
    this.client = false
    this.proven = false
    this.tried = false
    this.attempts = 0
  }

  _updatePriority() {
    if (this.explicit && this.attempts > 3) this._deprioritize()
    if (this.banned || this.queued || this.attempts > 3) return false
    this.priority = this._getPriority()
    return true
  }

  _topic(topic, id) {
    if (id < INLINE_TOPICS) {
      const bit = 1 << id
      if ((this._topicBits & bit) !== 0) return
      this._topicBits |= bit
    } else if (!this._spillTopic(id)) {
      return
    }

    this.topics.push(topic)
    this.emit('topic', topic)
  }

  // Inserts id into the sorted spill list, returns false if it was already there
  _spillTopic(id) {
    let spill = this._topicSpill
    const length = this._topicSpillLength

    let lo = 0
    let hi = length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (spill[mid] < id) lo = mid + 1
      else hi = mid
    }
    if (lo < length && spill[lo] === id) return false

    if (spill === null || length === spill.length) {
      const grown = new Uint32Array(spill === null ? 4 : 2 * spill.length)
      if (spill !== null) grown.set(spill)
      spill = this._topicSpill = grown
    }

    spill.copyWithin(lo + 1, lo, length)
    spill[lo] = id
    this._topicSpillLength = length + 1
    return true
  }

  reconnect(val) {
    this.reconnecting = !!val
  }

  ban(val) {
    this.banned = !!val
  }

  shouldGC() {
    return !(this.banned || this.queued || this.explicit || this.waiting)
  }
}
