'use strict'
const { inspect } = require('util')
const hyperswarm = require('./')
const crypto = require('crypto')
const swarm = hyperswarm({
  announceLocalAddress: true
})

if (!process.argv[2]) { throw Error('node example.js <topic-key>') }

const key = crypto.createHash('sha256')
  .update(process.argv[2])
  .digest()

swarm.connectivity((err, capabilities) => {
  console.log('network capabilities', capabilities, err || '')
})

swarm.join(key, {
  announce: true,
  lookup: true
}, function () {
  console.log('fully joined...')
})

swarm.on('connection', function (socket, info) {
  const {
    priority,
    status,
    retries,
    peer,
    client
  } = info
  console.log('new connection!', `
    priority: ${priority}
    status: ${status}
    retries: ${retries}
    client: ${client}
    peer: ${!peer ? peer : `
      ${inspect(peer, { indentationLvl: 4 }).slice(2, -2)}
    `}
  `)

  if (client) process.stdin.pipe(socket)
  else socket.pipe(process.stdout)
})
