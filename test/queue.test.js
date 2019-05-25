'use strict'
const { test } = require('tap')
const { once } = require('./util')
const queue = require('../lib/queue')

test('basic queue', async ({ is, same }) => {
  const q = queue()

  // add once
  q.add({ port: 8000, host: '127.0.0.1' })

  // add twice
  q.add({ port: 8000, host: '127.0.0.1' })

  const { peer } = q.shift()

  same(peer, { port: 8000, host: '127.0.0.1' })
  is(q.shift(), null)

  q.add({ port: 8001, host: '127.0.0.1' })

  const info = q.shift()

  same(info.peer, { port: 8001, host: '127.0.0.1' })
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
