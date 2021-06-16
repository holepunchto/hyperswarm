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
    return this._byPublicKey.has(publicKey.toString('hex'))
  }

  get (publicKey) {
    return this._byPublicKey.get(publicKey.toString('hex'))
  }

  add (connection) {
    this._byPublicKey.set(connection.remotePublicKey.toString('hex'), connection)
  }

  delete (connection) {
    const keyString = connection.remotePublicKey.toString('hex')
    const existing = this._byPublicKey.get(keyString)
    if (existing !== connection) return
    this._byPublicKey.delete(keyString)
  }
}
