module.exports = class DHT {
  constructor () {
    throw new Error(
      'Hyperswarm/DHT is not supported in browsers, please pass a dht-relay instance to Hyperswarm constructor'
    )
  }
}
