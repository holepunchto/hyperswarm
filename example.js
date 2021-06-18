const Swarm = require('.')

start()

async function start () {
  const swarm1 = new Swarm({ seed: Buffer.alloc(32).fill(4) })
  const swarm2 = new Swarm({ seed: Buffer.alloc(32).fill(5) })

  console.log('SWARM 1 KEYPAIR:', swarm1.keyPair)
  console.log('SWARM 2 KEYPAIR:', swarm2.keyPair)

  swarm1.on('connection', function (connection, info) {
    console.log('swarm 1 got a server connection:', connection.remotePublicKey, connection.publicKey, connection.handshakeHash)
    connection.on('error', err => console.error('1 CONN ERR:', err))
    // Do something with `connection`
    // `info` is a PeerInfo object
  })
  swarm2.on('connection', function (connection, info) {
    console.log('swarm 2 got a client connection:', connection.remotePublicKey, connection.publicKey, connection.handshakeHash)
    connection.on('error', err => console.error('2 CONN ERR:', err))
  })

  const key = Buffer.alloc(32).fill(7)

  const discovery1 = swarm1.join(key)
  await discovery1.flushed() // Wait for the first lookup/annnounce to complete.

  swarm2.join(key)

  // await swarm2.flush()
  // await discovery.destroy() // Stop lookup up and announcing this topic.
}
