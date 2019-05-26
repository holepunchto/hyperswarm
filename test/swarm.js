'use strict'
const { EventEmitter } = require('events')
const { test } = require('tap')
const { once, promisifyMethod, dhtBootstrap } = require('./util')
const hyperswarm = require('../swarm')
const net = require('net')

test('default ephemerality', async ({ is }) => {
  const swarm = hyperswarm()
  is(swarm.ephemeral, true)
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.ephemeral, true)
  swarm.destroy()
})

test('ephemeral option', async ({ is }) => {
  const swarm = hyperswarm({
    ephemeral: false
  })
  is(swarm.ephemeral, false)
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.ephemeral, false)
  swarm.destroy()
})

test('bootstrap option', async ({ is }) => {
  const { bootstrap, closeDht, port } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.bootstrapNodes.length, 1)
  is(swarm.network.discovery.dht.bootstrapNodes[0].port, port)
  swarm.destroy()
  closeDht()
})

test('emits listening event when bound', async ({ pass }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  swarm.listen()
  await once(swarm, 'listening')
  pass('event emitted')
  swarm.destroy()
  closeDht()
})

test('emits close event when destroyed', async ({ pass }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.destroy()
  await once(swarm, 'close')
  pass('event emitted')
  closeDht()
})

test('join - missing key', async ({ throws }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.join(), Error('key is required and must be a buffer'))
  throws(() => swarm.join('not a buffer.'), Error('key is required and must be a buffer'))
  swarm.destroy()
  closeDht()
})

test('join automatically binds', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  var bind = false
  swarm.network.bind = () => (bind = true)
  swarm.join(Buffer.from('key'))
  is(bind, true)
  swarm.destroy()
  closeDht()
})

test('join – emits error event when failing to bind', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const fauxError = Error('problem binding')
  swarm.network.bind = (cb) => process.nextTick(cb, fauxError)
  swarm.join(Buffer.from('key'))
  const err = await once(swarm, 'error')
  is(err, fauxError)
  swarm.destroy()
  closeDht()
})

test('join – default options', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  var lookupKey = null
  const key = Buffer.from('key')
  swarm.network.lookup = (key) => {
    lookupKey = key
    return new EventEmitter()
  }
  swarm.join(key)
  await once(swarm, 'listening') // wait for bind
  is(lookupKey, key)
  swarm.destroy()
  closeDht()
})

test('join - announce: false, lookup: true', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  var lookupKey = null
  const key = Buffer.from('key')
  swarm.network.lookup = (key) => {
    lookupKey = key
    return new EventEmitter()
  }
  swarm.join(key, { announce: false, lookup: true })
  await once(swarm, 'listening') // wait for bind
  is(lookupKey, key)
  swarm.destroy()
  closeDht()
})

test('join - announce: true, lookup: false', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  var announceKey = null
  var lookupBool = null
  const key = Buffer.from('key')
  swarm.network.announce = (key, { lookup }) => {
    announceKey = key
    lookupBool = lookup
    return new EventEmitter()
  }
  swarm.join(key, { announce: true, lookup: false })
  await once(swarm, 'listening') // wait for bind
  is(announceKey, key)
  is(lookupBool, false)
  swarm.destroy()
  closeDht()
})

test('join - announce: true, lookup: true', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  var announceKey = null
  var lookupBool = null
  const key = Buffer.from('key')
  swarm.network.announce = (key, { lookup }) => {
    announceKey = key
    lookupBool = lookup
    return new EventEmitter()
  }
  swarm.join(key, { announce: true, lookup: true })
  await once(swarm, 'listening') // wait for bind
  is(announceKey, key)
  is(lookupBool, true)
  swarm.destroy()
  closeDht()
})

test('join - announce: false, lookup: false', async ({ throws }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  throws(
    () => swarm.join(key, { announce: false, lookup: false }),
    Error('join options must enable lookup, announce or both, but not neither')
  )
  swarm.destroy()
  closeDht()
})

test('join - emits update event when topic updates', async ({ pass }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  const topic = new EventEmitter()
  swarm.network.lookup = () => topic
  swarm.join(key)
  await once(swarm, 'listening')
  process.nextTick(() => topic.emit('update'))
  await once(swarm, 'update')
  pass('event emitted')
  swarm.destroy()
  closeDht()
})

test('join - emits peer event when topic recieves peer', async ({ pass, is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.lookup = () => topic
  swarm.join(key)
  await once(swarm, 'listening')
  process.nextTick(() => {
    topic.emit('peer', fauxPeer)
  })
  const [ peer ] = await once(swarm, 'peer')
  pass('event emitted')
  is(peer, fauxPeer)
  swarm.destroy()
  closeDht()
})

test('leave - missing key', async ({ throws }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.leave(), Error('key is required and must be a buffer'))
  throws(() => swarm.leave('not a buffer.'), Error('key is required and must be a buffer'))
  swarm.destroy()
  closeDht()
})

test('leave destroys the topic for a given pre-existing key', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  const { lookup } = swarm.network
  var topicDestroyed = false
  var topic = null
  swarm.network.lookup = (key) => {
    return (topic = lookup.call(swarm.network, key))
  }
  swarm.join(key)
  await once(swarm, 'listening') // wait for bind
  const { destroy } = topic
  topic.destroy = () => {
    topicDestroyed = true
    return destroy.call(topic)
  }
  swarm.leave(key)
  is(topicDestroyed, true)
  swarm.destroy()
  closeDht()
})

test('leave does not throw when a given key was never joined', async ({ doesNotThrow }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  const key2 = Buffer.from('key2')
  swarm.join(key)
  await once(swarm, 'listening')
  doesNotThrow(() => swarm.leave(key2))
  swarm.destroy()
  closeDht()
})

test('joining the same topic twice will leave the topic before rejoining', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = Buffer.from('key')
  const { lookup } = swarm.network
  var topicDestroyed = false
  var topic = null
  swarm.network.lookup = (key) => {
    return (topic = lookup.call(swarm.network, key))
  }
  swarm.join(key)
  await once(swarm, 'listening')
  const { destroy } = topic
  swarm.network.bind = (cb) => cb()
  topic.destroy = () => {
    topicDestroyed = true
    return destroy.call(topic)
  }
  swarm.join(key)
  is(topicDestroyed, true)
  swarm.destroy()
  closeDht()
})

test('by default connects up to a maximum of MAX_PEERS_DEFAULT (16) peers')

test('maxPeers option controls maximum peers that a swarm will connect to')

test('after meeting maximum peers threshhold, allows new peers to be connected to when existing peer connections close')

test('retries connecting to peers that have closed')

test('retries connecting to peers that errored while connecting')

test('emits connection event when peer connects', async ({ is }) => {

})
test('emits connection event when connected to a peer', async ({ is }) => {

})

test('connect two peers')

test('connect to a peer with a plain TCP client', async ({ pass, same, is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  const { port } = swarm.address()
  const client = net.connect(port)
  const [ connection, info ] = await once(swarm, 'connection')
  pass('server connected')
  once(client, 'connect')
  pass('client connected')
  is(info.type, 'tcp')
  client.write('a')
  const [ data ] = await once(connection, 'data')
  same(data, Buffer.from('a'))
  connection.destroy()
  await once(connection, 'close')
  pass('server disconnected')
  await once(client, 'close')
  pass('client disconnected')
  swarm.destroy()
  await once(swarm, 'close')
  pass('swarm closed')
})
