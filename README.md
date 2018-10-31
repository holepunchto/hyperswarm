# @hyperswarm/network

A high-level API for finding and connecting to peers who are interested in a "topic."

```
npm install @hyperswarm/network
```

## Usage

```js
const network = require('@hyperswarm/network')
const crypto = require('crypto')

const net = network()

// look for peers listed under this topic
const topic = crypto.createHash('sha256')
  .update('my-hyperswarm-topic')
  .digest()

net.join(topic, {
  lookup: true, // find & connect to peers
  announce: true // optional- announce self as a connection target
})

net.on('connection', (socket, details) => {
  console.log('new connection!', details)

  // you can now use the socket as a stream, eg:
  // process.stdin.pipe(socket).pipe(process.stdout)
})
```

## API

#### `net = network([options])`

Create a new network instance

Options include:

```js
{
  // Optionally overwrite the default set of bootstrap servers
  bootstrap: [addresses],
  // Set to false if this is a long running instance on a server
  // When running in ephemeral mode (default) you don't join the
  // DHT but just query it instead.
  ephemeral: true,
  // Pass in your own udp/utp socket
  socket: (a udp or utp socket)
}
```

#### `net.join(topic[, options])`

Join the swarm for the given topic. This will cause peers to be discovered for the topic (`'peer'` event). Connections will automatically be created to those peers (`'connection'` event).

The `announce` and `lookup` parameters should be set according to your process' expected behavior and lifetime. If your process is:

 - Joining the topic temporarily, set `lookup: true` and `announce: false`.
 - Joining the topic for a long time, set both `lookup: true` and `announce: true`.
 - Joining the topic and likely to receive a lot of connections (e.g. it runs persistently in the cloud) then set `lookup: false` and `announce: true`.

Parameters:

 - `topic`. Buffer. The identifier of the peer-group to list under. Must be 32 bytes in length.
 - `options`. Object.
   - `announce`. Boolean. List this peer under the the topic as a connectable target? Defaults to false.
   - `lookup`. Boolean. Look for peers in the topic and attempt to connect to them? If `announce` is false, this automatically becomes true.

#### `net.leave(topic)`

Leave the swarm for the given topic.

 - `topic`. Buffer. The identifier of the peer-group to delist from. Must be 32 bytes in length.

#### `net.connect(peer, (err, socket, details) => {})`

Establish a connection to the given peer. You usually won't need to use this function, because hyperswarm connects to found peers automatically.

 - `peer`. The object emitted by the `'peer'` event.
 - `cb`. Function.
   - `err`. Error.
   - `socket`. The established TCP or UTP socket.
   - `details`. Object describing the connection.
     - `type`. String. Should be either `'tcp'` or `'utp'`.
     - `client`. Boolean. If true, the connection was initiated by this node.
     - `peer`. Object describing the peer. (Will be the same object that was passed into this method.)

#### `net.on('connection', (socket, details) => {})`

A new connection has been created. You should handle this event by using the socket.

 - `socket`. The established TCP or UTP socket.
 - `details`. Object describing the connection.
   - `type`. String. Should be either `'tcp'` or `'utp'`.
   - `client`. Boolean. If true, the connection was initiated by this node.
   - `peer`. Object describing the peer. Will be null if `client === false`.
     - `port`. Number.
     - `host`. String. The IP address of the peer.
     - `local`. Boolean. Is the peer on the LAN?
     - `referrer`. Object. The address of the node that informed us of the peer.
       - `port`. Number.
       - `host`. String. The IP address of the referrer.
       - `id`. Buffer.
     - `topic`. Buffer. The identifier which this peer was discovered under.

#### `net.on('peer', (peer) => {})`

A new peer has been discovered on the network and has been queued for connection.

 - `peer`. Object describing the peer.
   - `port`. Number.
   - `host`. String. The IP address of the peer.
   - `local`. Boolean. Is the peer on the LAN?
   - `referrer`. Object. The address of the node that informed us of the peer.
     - `port`. Number.
     - `host`. String. The IP address of the referrer.
     - `id`. Buffer.
   - `topic`. Buffer. The identifier which this peer was discovered under.

#### `net.on('update', () => {})`

TODO describe this
