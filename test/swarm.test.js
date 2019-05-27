'use strict'
const { EventEmitter } = require('events')
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once, done, promisifyMethod, whenifyMethod, dhtBootstrap, validSocket, timeout } = require('./util')
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
  const swarm = hyperswarm()
  swarm.listen()
  await once(swarm, 'listening')
  pass('event emitted')
  swarm.destroy()
})

test('emits close event when destroyed', async ({ pass }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.destroy()
  await once(swarm, 'close')
  pass('event emitted')
})

test('join - missing key', async ({ throws }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.join(), Error('key is required and must be a buffer'))
  throws(() => swarm.join('not a buffer.'), Error('key is required and must be a buffer'))
  swarm.destroy()
})

test('join automatically binds', async ({ is }) => {
  const swarm = hyperswarm()
  var bind = false
  swarm.network.bind = () => (bind = true)
  swarm.join(Buffer.from('key'))
  is(bind, true)
  swarm.destroy()
})

test('join – emits error event when failing to bind', async ({ is }) => {
  const swarm = hyperswarm()
  const fauxError = Error('problem binding')
  swarm.network.bind = (cb) => process.nextTick(cb, fauxError)
  swarm.join(Buffer.from('key'))
  const err = await once(swarm, 'error')
  is(err, fauxError)
  swarm.destroy()
})

test('join – default options', async ({ is }) => {
  const swarm = hyperswarm()
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
})

test('join - announce: false, lookup: true', async ({ is }) => {
  const swarm = hyperswarm()
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
})

test('join - announce: false, lookup: false', async ({ throws }) => {
  const swarm = hyperswarm()
  const key = Buffer.from('key')
  throws(
    () => swarm.join(key, { announce: false, lookup: false }),
    Error('join options must enable lookup, announce or both, but not neither')
  )
  swarm.destroy()
})

test('join - emits update event when topic updates', async ({ pass }) => {
  const swarm = hyperswarm()
  const key = Buffer.from('key')
  const topic = new EventEmitter()
  swarm.network.lookup = () => topic
  swarm.join(key)
  await once(swarm, 'listening')
  process.nextTick(() => topic.emit('update'))
  await once(swarm, 'update')
  pass('event emitted')
  swarm.destroy()
})

test('join - emits peer event when topic recieves peer', async ({ pass, is }) => {
  const swarm = hyperswarm()
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
})

test('join - announce: true, lookup: false', async ({ is, fail }) => {
  const swarm = hyperswarm()
  var announceKey = null
  const key = Buffer.from('key')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.announce = (key) => {
    announceKey = key
    return topic
  }
  swarm.join(key, { announce: true, lookup: false })
  await once(swarm, 'listening')
  swarm.once('peer', () => {
    fail('peers should not be emitted when lookup is false')
  })
  process.nextTick(() => {
    topic.emit('peer', fauxPeer)
  })
  is(announceKey, key)
  swarm.destroy()
})

test('join - announce: true, lookup: true', async ({ is }) => {
  const swarm = hyperswarm()
  var announceKey = null
  const key = Buffer.from('key')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.announce = (key) => {
    announceKey = key
    return topic
  }
  swarm.join(key, { announce: true, lookup: true })
  await once(swarm, 'listening')
  process.nextTick(() => {
    topic.emit('peer', fauxPeer)
  })
  const [ peer ] = await once(swarm, 'peer')
  is(peer, fauxPeer)
  is(announceKey, key)
  swarm.destroy()
})

test('leave - missing key', async ({ throws }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.leave(), Error('key is required and must be a buffer'))
  throws(() => swarm.leave('not a buffer.'), Error('key is required and must be a buffer'))
  swarm.destroy()
})

test('leave destroys the topic for a given pre-existing key', async ({ is }) => {
  const swarm = hyperswarm()
  const key = Buffer.concat([Buffer.alloc(20), Buffer.from('key1')])
  const key2 = Buffer.concat([Buffer.alloc(20), Buffer.from('key2')])
  const { lookup } = swarm.network
  var topicDestroyed = false
  var topic = null
  swarm.network.lookup = (key) => {
    return (topic = lookup.call(swarm.network, key))
  }
  swarm.join(key2)
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
})

test('leave does not throw when a given key was never joined', async ({ doesNotThrow }) => {
  const swarm = hyperswarm()
  const key = Buffer.from('key1')
  const key2 = Buffer.from('key2')
  swarm.join(key)
  await once(swarm, 'listening')
  doesNotThrow(() => swarm.leave(key2))
  swarm.destroy()
})

test('joining the same topic twice will leave the topic before rejoining', async ({ is }) => {
  const swarm = hyperswarm()
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
})

test('connect to a swarm with a plain TCP client', async ({ pass, same, is }) => {
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

test('connect two peers directly', async ({ is }) => {
  const swarm1 = hyperswarm()
  const swarm2 = hyperswarm()
  swarm1.listen()
  await once(swarm1, 'listening')

  whenifyMethod(swarm2, 'connect')
  const peer = {
    host: '127.0.0.1',
    port: swarm1.address().port
  }
  swarm2.connect(peer, (err, socket, isTcp) => {
    is(err, null)
    is(validSocket(socket), true)
    is(typeof isTcp, 'boolean')
  })

  await swarm2.connect[done]

  swarm1.destroy()
  swarm2.destroy()
})

test('connect two peers using join (announcing peer and lookup peer)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: false
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: false,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  peer1.destroy()
  peer2.destroy()
  closeDht()
})

test('connect two peers using join (announcing peer and announcing + lookup peer)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: false
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: true,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  peer1.destroy()
  peer2.destroy()
  closeDht()
})

test('connect two peers using join (both announcing + lookup peers)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: true
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: true,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  peer1.destroy()
  peer2.destroy()
  closeDht()
})

test('emits connection event upon connecting to a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ peer ] = await once(swarm2, 'peer')
  const [ socket, info ] = await once(swarm2, 'connection')
  is(validSocket(socket), true)
  is(info.peer, peer)
  is(info.client, true)
  swarm1.leave(key)
  swarm2.leave(key)
  swarm1.destroy()
  swarm2.destroy()
  closeDht()
})

test('emits connection event upon being connected to by a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ socket, info ] = await once(swarm1, 'connection')
  is(validSocket(socket), true)
  is(info.peer, null)
  is(info.client, false)
  swarm1.leave(key)
  swarm2.leave(key)
  swarm1.destroy()
  swarm2.destroy()
  closeDht()
})

test('connects up to a maximum amount of peers', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  const swarms = []
  const { maxClientSockets } = swarm // default amount of maxClientSockets is 16
  for (var i = 0; i < maxClientSockets; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }

  swarm.join(key, {
    announce: false,
    lookup: true
  })
  is(swarm.clientSockets, 0)
  await once(swarm, 'listening')
  for (var c = 0; c < maxClientSockets; c++) {
    await once(swarm, 'connection')
  }
  is(swarm.clientSockets, maxClientSockets)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow time for a potential connection event
  is(swarm.clientSockets, maxClientSockets)
  swarm2.destroy()
  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
    s.destroy()
  }
  closeDht()
})

test('maxClientSockets option controls maximum amount of peers that can be connected to', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap, maxClientSockets: 9 })
  const key = randomBytes(32)
  const swarms = []

  const { maxClientSockets } = swarm
  is(maxClientSockets, 9)
  for (var i = 0; i < maxClientSockets; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }

  swarm.join(key, {
    announce: false,
    lookup: true
  })
  is(swarm.clientSockets, 0)
  await once(swarm, 'listening')
  for (var c = 0; c < maxClientSockets; c++) {
    await once(swarm, 'connection')
  }
  is(swarm.clientSockets, maxClientSockets)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow ample time for a potential connection event
  is(swarm.clientSockets, maxClientSockets)
  swarm2.destroy()
  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
    s.destroy()
  }
  closeDht()
})

test('maxServerSockets option controls maximum incoming peers connections', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap, maxServerSockets: 9 })
  const key = randomBytes(32)
  swarm.join(key, {
    announce: true,
    lookup: false
  })
  const swarms = []
  await once(swarm, 'listening')
  const { maxServerSockets } = swarm
  is(maxServerSockets, 9)
  for (var i = 0; i < maxServerSockets; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await once(s, 'listening')
    await once(swarm, 'connection')
  }

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => fail('connection should not be emitted after max peers is reached'))
  await timeout(150) // allow time for a potential connection event
  swarm2.destroy()
  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
    s.destroy()
  }
  closeDht()
})

test('maxClientSockets defaults to 16', async ({ is }) => {
  const swarm = hyperswarm()
  const { maxClientSockets } = swarm
  is(maxClientSockets, 16)
  swarm.destroy()
})

test('maxServerSockets defaults to Infinity', async ({ is }) => {
  const swarm = hyperswarm()
  const { maxServerSockets } = swarm
  is(maxServerSockets, Infinity)
  swarm.destroy()
})
