'use strict'

const peerInfo = require('../lib/peer-info')
const { test } = require('tap')

test('basic peer info', async ({ is }) => {
  const info = peerInfo()

  is(info.firewalled, true)
  is(info.priority, 2)
  is(info.update(), true)
  is(info.priority, 2)

  info.active(true)
  info.active(false)

  is(info.requeue(), 0)
  is(info.update(), true)
  is(info.priority, 0)

  info.active(true)
  info.connected()

  is(info.update(), false)

  info.disconnected()
  info.active(false)

  is(info.requeue(), 0)
  is(info.update(), true)
  is(info.priority, 5)
  is(info.requeue(), 1)
  is(info.update(), true)
  is(info.priority, 4)
  is(info.requeue(), 2)
  is(info.update(), true)
  is(info.priority, 1)
  is(info.requeue(), -1)
})
