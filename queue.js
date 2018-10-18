const spq = require('shuffled-priority-queue')

/*

  priorities: [
    REDISCOVERED_PEER, (or proven failed >2 times in a row)
    PROVEN_PEER_FAILED_TWICE,
    DISCOVERED_REMOTE_PEER,
    DISCOVERED_LOCAL_PEER,
    PROVEN_PEER_FAILED,
    PROVEN_PEER,
    SUPER_PEER
  ]

  peer = {
    priority: {n}
    retries: 0,
    status: TCP_ONLY | PROVEN | BANNED
    peer,
  }

*/

const TCP_ONLY = 0b0001
const PROVEN = 0b0010
const BANNED = 0b0100
const ACTIVE = 0b1000
const BANNED_OR_ACTIVE = BANNED | ACTIVE
const NOT_ACTIVE = ~ACTIVE

exports = module.exports = () => new PeerQueue()
exports.PROVEN = PROVEN
exports.TCP_ONLY = TCP_ONLY

class PeerQueue {
  constructor () {
    this._queue = spq()
    this._map = new Map()
  }
  
  add (peer) {
    const id = peer.host + ':' + peer.port
    const prev = this._map.get(id)

    if (prev) {
      if (prev.status & BANNED_OR_ACTIVE || this._queue.has(prev)) return
      prev.priority = 0
      this._queue.add(prev)
      return
    }

    const item = {
      priority: peer.local ? 3 : 2,
      retries: 0,
      status: peer.local ? TCP_ONLY : 0,
      peer,
      _index: 0
    }

    this._map.set(id, item)
    this._queue.add(item)
  }

  ban (peer) {
    const id = peer.host + ':' + peer.port
    const prev = this._map.get(id)

    if (prev) {
      prev.status |= BANNED
      this._queue.remove(prev)
      return
    }

    this._map.set(id, {
      priority: 0,
      retries: 0,
      status: BANNED,
      peer,
      _index: 0
    })
  }

  remove (peer) {
    const id = peer.host + ':' + peer.port
    const prev = this._map.get(id)
    if (!prev) return
    this._map.delete(id)
    this._queue.remove(prev)
  }

  requeue (item) {
    if (item.status & BANNED) return
    item.status &= NOT_ACTIVE
    item.priority = priority(item)
    this._queue.add(item)
  }

  shift () {
    const item = this._queue.shift()
    if (item) item.status |= ACTIVE
    return item
  }
}

function priority (item) {
  if (!(item.status & PROVEN) || (item.status & BANNED)) return 0
  if (item.retries === 3) return 1
  if (item.retries === 2) return 4
  if (item.retries === 1) return 5
  return 0
}
