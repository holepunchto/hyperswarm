const b4a = require('b4a')

module.exports = class ConnectionSet {
  constructor () {
    this._byPublicKey = new Map()
  }

  [Symbol.iterator] () {
    return this._byPublicKey.values()
  }

  get size () {
    return this._byPublicKey.size
  }

  has (publicKey) {
    return this._byPublicKey.has(b4a.toString(publicKey, 'hex'))
  }

  get (publicKey) {
    return this._byPublicKey.get(b4a.toString(publicKey, 'hex'))
  }

  add (connection) {
    this._byPublicKey.set(b4a.toString(connection.remotePublicKey, 'hex'), connection)
  }

  delete (connection) {
    const keyString = b4a.toString(connection.remotePublicKey, 'hex')
    const existing = this._byPublicKey.get(keyString)
    if (existing !== connection) return
    this._byPublicKey.delete(keyString)
  }
}
