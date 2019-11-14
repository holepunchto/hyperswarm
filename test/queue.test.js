'use strict'
const { test } = require('tap')
const { once, when, immediate, timeout } = require('nonsynchronous')
const { PassThrough } = require('stream')
const queue = require('../lib/queue')

test('add / shift', async ({ is, same }) => {
  const q = queue()

  q.add({ port: 8000, host: '127.0.0.1' })

  const { peer } = q.shift()

  same(peer, { port: 8000, host: '127.0.0.1' })
  is(q.shift(), null)
})

test('requeue', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })

  q.add({ port: 8080, host: '127.0.0.1' })

  const info = q.shift()

  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), false)

  q.destroy()
})

test('requeue forget unresponsive', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ],
    forget: { unresponsive: 100 }
  })

  q.add({ port: 8080, host: '127.0.0.1' })

  const info = q.shift()

  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), true)
  await once(q, 'readable')
  is(q.shift(), info)
  is(q.requeue(info), false)

  // Check that the info gets purged from the queue
  is(q._infos.size, 1)
  await timeout(200)
  is(q._infos.size, 0)

  q.destroy()
})

test('peers with same details are deduped', async ({ is, same }) => {
  const q = queue()

  // add once
  q.add({ port: 8000, host: '127.0.0.1' })

  // add twice
  q.add({ port: 8000, host: '127.0.0.1' })

  const { peer } = q.shift()

  same(peer, { port: 8000, host: '127.0.0.1' })
  is(q.shift(), null)
})

test('peers with same host/port but different topics are not deduped', async ({ same }) => {
  const q = queue()

  // add once
  q.add({ port: 8000, host: '127.0.0.1', topic: Buffer.from('hello') })

  // add twice
  q.add({ port: 8000, host: '127.0.0.1', topic: Buffer.from('world') })

  let { peer: peer1 } = q.shift()
  let { peer: peer2 } = q.shift()

  if (peer1.topic.equals(Buffer.from('world'))) {
    const tmp = peer2
    peer2 = peer1
    peer1 = tmp
  }

  same(peer1, { port: 8000, host: '127.0.0.1', topic: Buffer.from('hello') })
  same(peer2, { port: 8000, host: '127.0.0.1', topic: Buffer.from('world') })
})

test('peers with same host/port and different topics are deduped when multiplex: true', async ({ same, is }) => {
  const q = queue({ multiplex: true })

  // add once
  q.add({ port: 8000, host: '127.0.0.1', topic: Buffer.from('hello') })

  // add twice
  q.add({ port: 8000, host: '127.0.0.1', topic: Buffer.from('world') })

  const { peer } = q.shift()

  same(peer, { port: 8000, host: '127.0.0.1', topic: Buffer.from('hello') })
  is(q.shift(), null)
})

test('requeue after destroy', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  q.add({ port: 8080, host: '127.0.0.1' })
  const info = q.shift()
  q.destroy()
  is(q.requeue(info), false)
})

test('shift after destroy', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  q.add({ port: 8080, host: '127.0.0.1' })
  q.destroy()
  is(q.shift(), null)
})

test('add after destroy', async ({ doesNotThrow }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  q.destroy()
  doesNotThrow(() => q.add({ port: 8080, host: '127.0.0.1' }))
})

test('destroy after destroy', async ({ doesNotThrow }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  q.destroy()
  doesNotThrow(() => q.destroy())
})

test('add emits readable when queue is empty', async ({ pass }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  const until = when()
  q.once('readable', () => process.nextTick(until))
  q.add({ port: 8080, host: '127.0.0.1' })
  await until.done()
  pass('readable emitted')
  q.destroy()
})

test('add does not emit readable when queue is not empty', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  const until = when()
  q.once('readable', () => process.nextTick(until))
  q.add({ port: 8080, host: '127.0.0.1' })
  await until.done()
  var emitted = false
  q.once('readable', () => { emitted = true })
  q.add({ port: 8081, host: '127.0.0.1' })
  await immediate()
  is(emitted, false)
  q.destroy()
})

test('remove peer', async ({ is, same }) => {
  const q = queue()
  q.add({ port: 8000, host: '127.0.0.1' })
  q.remove({ port: 8000, host: '127.0.0.1' })
  is(q.shift(), null)
})

test('remove peer destroys peer info object', async ({ is }) => {
  const q = queue()
  q.add({ port: 8000, host: '127.0.0.1' })
  const info = q.shift()
  q.add({ port: 8000, host: '127.0.0.1' })
  var destroyed = false
  info.destroy = () => { destroyed = true }
  q.remove({ port: 8000, host: '127.0.0.1' })
  is(q.shift(), null)
  is(destroyed, true)
})

test('remove peer that does not exist', async ({ same, doesNotThrow }) => {
  const q = queue()
  q.add({ port: 8000, host: '127.0.0.1' })
  doesNotThrow(() => q.remove({ port: 8001, host: '127.0.0.1' }))
  const { peer } = q.shift()
  same(peer, { port: 8000, host: '127.0.0.1' })
})

test('remove after destroy', async ({ is, same }) => {
  const q = queue()
  q.add({ port: 8000, host: '127.0.0.1' })
  const info = q.shift()
  q.add({ port: 8000, host: '127.0.0.1' })
  var infoDestroyed = false
  info.destroy = () => { infoDestroyed = true }
  q.destroy()
  q.remove({ port: 8000, host: '127.0.0.1' })
  // false because we desroyed the queue
  // so it will never call destroy on the peer info
  is(infoDestroyed, false)
})

test('add after peer destroyed', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })

  q.add({ port: 8080, host: '127.0.0.1' })

  const info = q.shift()
  info.destroy()

  q.add({ port: 8080, host: '127.0.0.1' })

  is(q.shift(), null)

  q.destroy()
})

test('reqeue after peer destroyed', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })
  q.add({ port: 8080, host: '127.0.0.1' })
  const info = q.shift()
  var emitted = false
  q.requeue(info)
  q.emit = (evt) => {
    if (evt === 'readable') emitted = true
  }
  await timeout(100) // first tick (pending -> next)
  info.destroy()
  await timeout(100) // second tick (next passed to _fn (_push))
  is(q.shift(), null)
  is(emitted, false)
  q.destroy()
})

test('requeue intervals', async ({ is }) => {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })

  q.add({ port: 8080, host: '127.0.0.1' })
  q.add({ port: 8081, host: '127.0.0.1' })
  const info = q.shift()
  const info2 = q.shift()

  is(q.requeue(info), true)
  is(q.requeue(info2), true)
  is(q.shift(), null)
  await timeout(100)
  is(q.shift(), null)
  await timeout(100) // takes two ticks to push a batch
  // using a set because the output order of shift
  // is random when priorities are equal
  const infos = new Set([q.shift(), q.shift()])
  is(infos.has(info2), true)
  is(infos.has(info), true)
  is(q.requeue(info), true)
  is(q.shift(), null)
  // sets info2 retries to 0, so requeuing
  // for info2 will occur at the first interval
  // whereas info will requeue at the second interval
  info2.connected(PassThrough())
  is(q.requeue(info2), true)
  await timeout(200)
  // we get info2 here because we connected (so retries = 0)
  // the 0 interval is 100 but it takes two ticks to process
  // a batch - which is 200ms. 200ms is also the interval
  // of the second interval the above timeout also counts
  // as the first tick of the second requeue interval
  is(q.shift(), info2)
  is(q.shift(), null)
  info2.disconnected(PassThrough())
  info2.connected(PassThrough()) // set to 0 retries again
  is(q.requeue(info2), true)
  await timeout(200)
  // do not need to use a set here, because info2
  // will be higher priority than info, because its
  // retry count is lower.
  is(q.shift(), info2)
  is(q.shift(), info)
  is(q.requeue(info), true)
  is(q.shift(), null)
  await timeout(300)
  is(q.shift(), null)
  await timeout(300)
  is(q.shift(), info)
  is(q.requeue(info), false)
  q.destroy()
})
