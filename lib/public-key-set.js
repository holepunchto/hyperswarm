module.exports = class PublicKeySet {
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

  set (publicKey, obj) {
    this._byPublicKey.set(publicKey.toString('hex'), obj)
  }

  delete (publicKey, obj) {
    const keyString = publicKey.toString('hex')
    const existing = this._byPublicKey.get(keyString)
    if (existing !== obj) return
    this._byPublicKey.delete(keyString)
  }
}
