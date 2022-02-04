const HashMap = require('turbo-hash-map')

module.exports = class ConnectionSet {
  constructor () {
    this._byPublicKey = new HashMap()
  }

  [Symbol.iterator] () {
    return this._byPublicKey.values()
  }

  get size () {
    return this._byPublicKey.size
  }

  has (publicKey) {
    return this._byPublicKey.has(publicKey)
  }

  get (publicKey) {
    return this._byPublicKey.get(publicKey)
  }

  add (connection) {
    this._byPublicKey.set(connection.remotePublicKey, connection)
  }

  delete (connection) {
    const existing = this._byPublicKey.get(connection.remotePublicKey)
    if (existing !== connection) return
    this._byPublicKey.delete(connection.remotePublicKey)
  }
}
