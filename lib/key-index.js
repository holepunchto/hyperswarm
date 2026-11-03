const b4a = require('b4a')

// Maps 32-byte public keys to values without converting them to strings.
// Rows are dense (keys[i] -> values[i]); the open-addressed slot table holds
// row + 1 in the low bits and a hash fingerprint in the upper bits, so most
// probe misses never touch the key.
const ROW_BITS = 24
const ROW_MASK = (1 << ROW_BITS) - 1
const MAX_ROWS = ROW_MASK - 1
const MIN_SLOTS = 16

// Keys come from the network, so the hash is seeded per process to keep probe chains unpredictable
const SEED_A = (Math.random() * 0x100000000) >>> 0
const SEED_B = (Math.random() * 0x100000000) >>> 0

module.exports = class KeyIndex {
  constructor() {
    this.keys = []
    this.values = []
    this._slots = new Uint32Array(MIN_SLOTS)
    this._mask = MIN_SLOTS - 1
  }

  get size() {
    return this.keys.length
  }

  has(key) {
    return this._find(key, hash(key)) !== -1
  }

  get(key) {
    const i = this._find(key, hash(key))
    return i === -1 ? undefined : this.values[(this._slots[i] & ROW_MASK) - 1]
  }

  set(key, value) {
    const h = hash(key)
    const i = this._find(key, h)

    if (i !== -1) {
      this.values[(this._slots[i] & ROW_MASK) - 1] = value
      return
    }

    if (this.keys.length >= MAX_ROWS) throw new Error('KeyIndex is full')
    if (2 * (this.keys.length + 1) > this._slots.length) this._grow()

    this.keys.push(key)
    this.values.push(value)
    this._insert(h, this.keys.length)
  }

  delete(key) {
    const i = this._find(key, hash(key))
    if (i === -1) return false

    const row = (this._slots[i] & ROW_MASK) - 1
    this._remove(i)

    // Swap the last row into the hole and repoint its slot
    const last = this.keys.length - 1
    if (row !== last) {
      const lastKey = this.keys[last]
      this._slots[this._find(lastKey, hash(lastKey))] = slot(hash(lastKey), row + 1)
      this.keys[row] = lastKey
      this.values[row] = this.values[last]
    }

    this.keys.pop()
    this.values.pop()
    return true
  }

  _find(key, h) {
    const slots = this._slots
    const mask = this._mask
    const fp = h >>> ROW_BITS

    for (let i = h & mask; ; i = (i + 1) & mask) {
      const s = slots[i]
      if (s === 0) return -1
      if (s >>> ROW_BITS === fp && b4a.equals(this.keys[(s & ROW_MASK) - 1], key)) return i
    }
  }

  _insert(h, ref) {
    const slots = this._slots
    const mask = this._mask
    let i = h & mask
    while (slots[i] !== 0) i = (i + 1) & mask
    slots[i] = slot(h, ref)
  }

  // Backward-shift deletion keeps probe chains intact without tombstones
  _remove(i) {
    const slots = this._slots
    const mask = this._mask

    for (let j = (i + 1) & mask; slots[j] !== 0; j = (j + 1) & mask) {
      const home = hash(this.keys[(slots[j] & ROW_MASK) - 1]) & mask
      // Move j into the hole at i unless its home lies cyclically in (i, j]
      if ((j > i && (home <= i || home > j)) || (j < i && home <= i && home > j)) {
        slots[i] = slots[j]
        i = j
      }
    }

    slots[i] = 0
  }

  _grow() {
    this._slots = new Uint32Array(this._slots.length * 2)
    this._mask = this._slots.length - 1
    for (let row = 0; row < this.keys.length; row++) {
      this._insert(hash(this.keys[row]), row + 1)
    }
  }
}

function slot(h, ref) {
  return ((h & ~ROW_MASK) | ref) >>> 0
}

function hash(key) {
  // Mix all 32 bytes so keys sharing a prefix still spread out
  let h = SEED_A
  for (let i = 0; i < 32; i += 4) {
    let w = key[i] | (key[i + 1] << 8) | (key[i + 2] << 16) | (key[i + 3] << 24)
    w = Math.imul(w, 0xcc9e2d51)
    w = (w << 15) | (w >>> 17)
    h ^= Math.imul(w, 0x1b873593)
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= SEED_B
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
