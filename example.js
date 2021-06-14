const Swarm = require('.')

start()

async function start () {
  const swarm = new Swarm({ seed: Buffer.alloc(32).fill(1) })
  swarm.on('connection', function (connection, info) {
    // Do something with `connection`
    // `info` is a PeerInfo object
  })

  const key = Buffer.alloc(32).fill(2)
  const discovery = swarm.join(key)
  // discovery.refresh({ server: true })
  await discovery.flushed() // Wait for the first lookup/annnounce to complete.
  // await discovery.destroy() // Stop lookup up and announcing this topic.
  // console.log('DESTROY FINISHED')
}
