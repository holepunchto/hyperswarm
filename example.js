const network = require('./')
const crypto = require('crypto')

const net = network()

const k = crypto.createHash('sha256')
  .update(process.argv[2])
  .digest()

net.on('connection', function (socket, info) {
  console.log('new connection!', info)
  process.stdin.pipe(socket).pipe(process.stdout)
})

const announcing = process.argv.indexOf('--announce') > -1

net.join(k, {
  announce: announcing,
  lookup: !announcing
})

process.once('SIGINT', function () {
  console.log('Shutting down ...')
  net.discovery.destroy()
  net.discovery.on('close', function () {
    process.exit()
  })
})
