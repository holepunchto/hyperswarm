const tape = require('tape')
const queue = require('../lib/queue')

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

  const info = q.shift()

  t.same(info.peer, { port: 8001, host: '127.0.0.1' })
  t.same(q.shift(), null)

  t.end()
})

tape('requeue', function (t) {
  const q = queue({
    requeue: [ 100, 200, 300 ]
  })

  q.add({ port: 8080, host: '127.0.0.1' })

  const info = q.shift()

  t.same(q.requeue(info), true)
  q.once('readable', function () {
    t.same(q.shift(), info)
    t.same(q.requeue(info), true)
    q.once('readable', function () {
      t.same(q.shift(), info)
      t.same(q.requeue(info), true)
      q.once('readable', function () {
        t.same(q.shift(), info)
        t.same(q.requeue(info), false)
        q.destroy()
        t.end()
      })
    })
  })
})
