const tape = require('tape')
const queue = require('../queue')

tape('basic queue', function (t) {
  const q = queue()

  // add once
  q.add({ port: 8000, host: '127.0.0.1' })

  // add twice
  q.add({ port: 8000, host: '127.0.0.1' })

  const { peer } = q.shift()

  t.same(peer, { port: 8000, host: '127.0.0.1' })
  t.same(q.shift(), null)

  q.add({ port: 8001, host: '127.0.0.1' })

  const item = q.shift()

  t.same(item.peer, { port: 8001, host: '127.0.0.1' })
  t.same(q.shift(), null)

  q.requeue(item)
  t.same(q.shift(), item)

  t.end()
})

tape('ban peer', function (t) {
  t.end()
})
