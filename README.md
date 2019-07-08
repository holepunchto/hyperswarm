# hyperswarm

A high-level API for finding and connecting to peers who are interested in a "topic."

```
npm install hyperswarm
```

## Usage

```js
const hyperswarm = require('hyperswarm')
const crypto = require('crypto')

const swarm = hyperswarm()

// look for peers listed under this topic
const topic = crypto.createHash('sha256')
  .update('my-hyperswarm-topic')
  .digest()

swarm.join(topic, {
  lookup: true, // find & connect to peers
  announce: true // optional- announce self as a connection target
})

swarm.on('connection', (socket, details) => {
  console.log('new connection!', details)

  // you can now use the socket as a stream, eg:
  // process.stdin.pipe(socket).pipe(process.stdout)
})
```

## API

#### `swarm = hyperswarm([options])`

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
  // total amount of peers that this peer will connect to
  maxPeers: 24,
  // set to a number to restrict the amount of server socket
  // based peer connections, unrestricted by default.
  // setting to 0 is the same as Infinity, to disallowe server
  // connections set to -1
  maxServerSockets: Infinity,
  // set to a number to restrict the amount of client sockets
  // based peer connections, unrestricted by default.
  maxClientSockets: Infinity,
  // configure peer management behaviour 
  queue = {
    // an array of backoff times, in millieconds
    // every time a failing peer connection is retried
    // it will wait for specified milliseconds based on the
    // retry count, until it reaches the end of the requeue
    // array at which time the peer is considered unresponsive
    // and retry attempts cease
    requeue = [ 1000, 5000, 15000 ],
    // configure when to forget certain peer characteristics
    // and treat them as fresh peer connections again
    forget = {
      // how long to wait before forgetting that a peer
      // has become unresponsive
      unresponsive: 7500,
      // how long to wait before fogetting that a peer 
      // has been banned
      banned: Infinity
    }
  }
}
```

#### `swarm.join(topic[, options])`

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

#### `swarm.leave(topic)`

Leave the swarm for the given topic.

 - `topic`. Buffer. The identifier of the peer-group to delist from. Must be 32 bytes in length.

#### `swarm.connect(peer, (err, socket, details) => {})`

Establish a connection to the given peer. You usually won't need to use this function, because hyperswarm connects to found peers automatically.

 - `peer`. The object emitted by the `'peer'` event.
 - `cb`. Function.
   - `err`. Error.
   - `socket`. The established TCP or UTP socket.
   - `details`. Object describing the connection.
     - `type`. String. Should be either `'tcp'` or `'utp'`.
     - `client`. Boolean. If true, the connection was initiated by this node.
     - `peer`. Object describing the peer. (Will be the same object that was passed into this method.)

#### `swarm.on('connection', (socket, details) => {})`

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

#### `swarm.on('peer', (peer) => {})`

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

#### `swarm.on('updated', (key) => {})`

Emitted once a discovery cycle for a particular topic has completed. The topic can be identified by the `key` property of the emitted object. After this event the peer will wait for period of between 5 and 10 minutes before looking for new peers on that topic again.

#### `swarm.on('join', (key, opts) => {})`

Once a topic has been sucessfully joined this event is emitted with the key for the joined topic and the options object that was passed to join for this particular key.

#### `swarm.on('leave', (key) => {})`

Emitted with the relevant topics key, when a topic has been succesfully left.