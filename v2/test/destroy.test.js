'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once, promisifyMethod } = require('nonsynchronous')
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

test('address after destroy', async ({ throws }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  throws(() => swarm.address(), Error('swarm has been destroyed'))
})

test('listen after destroy', async ({ throws }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  throws(() => swarm.listen(), Error('swarm has been destroyed'))
})

test('join after destroy', async ({ throws }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  throws(() => {
    const key = randomBytes(32)
    swarm.join(key)
  }, Error('swarm has been destroyed'))
})

test('connect after destroy', async ({ throws }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  throws(() => {
    const peer = {
      host: '127.0.0.1',
      port: 8080
    }
    swarm.connect(peer, () => {})
  }, Error('swarm has been destroyed'))
})

test('connectivity after destroy', async ({ throws }) => {
  const swarm = hyperswarm()
  swarm.listen()
  swarm.destroy()
  throws(() => {
    swarm.connectivity(() => {})
  }, Error('swarm has been destroyed'))
})
