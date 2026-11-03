const b4a = require('b4a')
const KeyIndex = require('./key-index')

module.exports = class ConnectionSet {
  constructor() {
    this._byPublicKey = new KeyIndex()
  }

  // Walks backwards so deleting the current connection mid-iteration skips nothing
  *[Symbol.iterator]() {
    const values = this._byPublicKey.values
    for (let i = values.length - 1; i >= 0; i--) {
      if (i < values.length) yield values[i]
    }
  }

  get size() {
    return this._byPublicKey.size
  }

  has(publicKey) {
    return this._byPublicKey.has(toBuffer(publicKey))
  }

  get(publicKey) {
    return this._byPublicKey.get(toBuffer(publicKey))
  }

  add(connection) {
    this._byPublicKey.set(connection.remotePublicKey, connection)
  }

  delete(connection) {
    const existing = this._byPublicKey.get(connection.remotePublicKey)
    if (existing !== connection) return
    this._byPublicKey.delete(connection.remotePublicKey)
  }
}

function toBuffer(b) {
  return typeof b === 'string' ? b4a.from(b, 'hex') : b
}
