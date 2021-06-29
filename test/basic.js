const { test } = require('./helpers')
const { timeout } = require('nonsynchronous')
const Hyperswarm = require('..')

const CONNECTION_TIMEOUT = 100
const BACKOFFS = [
  100,
  200,
  300
]
const MAX_JITTER = 50

test('one server, one client - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  swarm2.on('connection', () => {
    t.pass('swarm2 got a client connection')
  })

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { server: true, client: false }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  await destroyAll(swarm1, swarm2)
})

test('two servers - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const s1Connected = timeoutPromise()
  const s2Connected = timeoutPromise()

  swarm1.on('connection', () => s1Connected.resolve())
  swarm2.on('connection', () => s2Connected.resolve())

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  try {
    await Promise.all([s1Connected, s2Connected])
    t.pass('connection events fired successfully')
  } catch {
    t.fail('connection events did not fire')
  }

  await destroyAll(swarm1, swarm2)
})

test('one server, one client - single reconnect', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })

  const reconnected = timeoutPromise(BACKOFFS[2] + MAX_JITTER)

  let disconnected = false
  swarm2.on('connection', (conn) => {
    if (!disconnected) {
      disconnected = true
      reconnected.reset()
      conn.destroy()
      return
    }
    reconnected.resolve()
  })

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  try {
    await reconnected
    t.pass('client got a second connection')
  } catch {
    t.fail('client did not get a second connection')
  }

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('one server, one client - maximum reconnects', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
    info.proven = false // Simulate a failing peer
    info.attempts = connections
    conn.destroy()
  })

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout((BACKOFFS[2] + MAX_JITTER) * 4)
  t.same(connections, 3, 'client saw 3 retries')

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('one server, one client - banned peer does not reconnect', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
    info.ban(true)
    conn.destroy()
  })

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout((BACKOFFS[2] + MAX_JITTER) * 2) // Wait for 2 long backoffs
  t.same(connections, 1, 'banned peer was not retried')

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('two servers, two clients - simple deduplication', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: MAX_JITTER })

  let s1Connections = 0
  let s2Connections = 0

  swarm1.on('connection', () => s1Connections++)
  swarm2.on('connection', () => s2Connections++)

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  await timeout(250) // 250 ms will be enough for all connections to trigger

  t.same(s1Connections, 1)
  t.same(s2Connections, 1)

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('one server, two clients - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })
  const swarm3 = new Hyperswarm({ bootstrap })

  const s1Connected = timeoutPromise()
  const s2Connected = timeoutPromise()
  const s3Connected = timeoutPromise()

  swarm1.on('connection', () => s1Connected.resolve())
  swarm2.on('connection', () => s2Connected.resolve())
  swarm3.on('connection', () => s3Connected.resolve())

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
  swarm3.join(topic, { server: false, client: true })

  await swarm2.flush()
  await swarm3.flush()

  try {
    await Promise.all([s1Connected, s2Connected, s3Connected])
    t.pass('connection events fired successfully')
  } catch {
    t.fail('connection events did not fire')
  }

  await destroyAll(swarm1, swarm2, swarm3)
})

function destroyAll (...args) {
  return Promise.all(args.map(a => a.destroy()))
}

function timeoutPromise (ms = CONNECTION_TIMEOUT) {
  let res = null
  let rej = null
  let timer = null

  let p = new Promise((resolve, reject) => {
    res = resolve
    rej = reject
  })
  p.resolve = res
  p.reject = rej
  p.reset = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => p.reject(new Error('Timed out')), ms)
  }

  p.reset()
  return p
}
