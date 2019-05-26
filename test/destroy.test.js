'use strict'
const { test } = require('tap')
const { once, promisifyMethod } = require('./util')
const hyperswarm = require('../')

test('listening and destroy', async ({ pass, is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  pass('swarm is listening')
  is(typeof swarm.address().port, 'number')
  swarm.destroy()
  await once(swarm, 'close')
})

test('listening and destroy twice', async ({ pass, is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  pass('swarm is listening')
  is(typeof swarm.address().port, 'number')
  swarm.destroy()
  swarm.destroy()
  await once(swarm, 'close')
})

test('destroy right away', async ({ pass, doesNotThrow }) => {
  const swarm = hyperswarm()
  doesNotThrow(() => swarm.destroy())
  const swarm2 = hyperswarm()
  promisifyMethod(swarm2, 'destroy')
  await swarm2.destroy()
  pass('closed')
})

test('destroy right away after listen', async ({ pass }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  await once(swarm, 'close')
  pass('closed')
})
