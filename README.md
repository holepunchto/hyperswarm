# hyperswarm

### [See the full API docs at docs.holepunch.to](https://docs.holepunch.to/building-blocks/hyperswarm)

A high-level API for finding and connecting to peers who are interested in a "topic."

## Installation
```
npm install hyperswarm
```

## Usage
```js
const Hyperswarm = require('hyperswarm')

const swarm1 = new Hyperswarm()
const swarm2 = new Hyperswarm()

swarm1.on('connection', (conn, info) => {
  // swarm1 will receive server connections
  conn.write('this is a server connection')
  conn.end()
})

swarm2.on('connection', (conn, info) => {
  conn.on('data', data => console.log('client got message:', data.toString()))
})

const topic = Buffer.alloc(32).fill('hello world') // A topic must be 32 bytes
const discovery = swarm1.join(topic, { server: true, client: false })
await discovery.flushed() // Waits for the topic to be fully announced on the DHT

swarm2.join(topic, { server: false, client: true })
await swarm2.flush() // Waits for the swarm to connect to pending peers.

// After this point, both client and server should have connections
```

## Hyperswarm API

#### `const swarm = new Hyperswarm(opts = {})`
Construct a new Hyperswarm instance.

`opts` can include:
* `keyPair`: A Noise keypair that will be used to listen/connect on the DHT. Defaults to a new key pair.
* `seed`: A unique, 32-byte, random seed that can be used to deterministically generate the key pair.
* `maxPeers`: The maximum number of peer connections to allow.
* `firewall`: A sync function of the form `remotePublicKey => (true|false)`. If true, the connection will be rejected. Defaults to allowing all connections.
* `dht`: A DHT instance. Defaults to a new instance.

#### `swarm.connecting`
Number that indicates connections in progress.

#### `swarm.connections`
A set of all active client/server connections.

#### `swarm.peers`
A Map containing all connected peers, of the form: `(Noise public key hex string) -> PeerInfo object`

See the [`PeerInfo`](https://github.com/holepunchto/hyperswarm/blob/v3/README.md#peerinfo-api) API for more details.

#### `swarm.dht`
A [`hyperdht`](https://github.com/holepunchto/hyperdht) instance. Useful if you want lower-level control over Hyperswarm's networking.

#### `swarm.on('connection', (socket, peerInfo) => {})`
Emitted whenever the swarm connects to a new peer.

`socket` is an end-to-end (Noise) encrypted Duplex stream

`peerInfo` is a [`PeerInfo`](https://github.com/holepunchto/hyperswarm/blob/v3/README.md#peerinfo-api) instance

#### `swarm.on('update', () => {})`
Emitted when internal values are changed, useful for user interfaces.

For example: emitted when `swarm.connecting` or `swarm.connections` changes.

#### `const discovery = swarm.join(topic, opts = {})`
Start discovering and connecting to peers sharing a common topic. As new peers are connected to, they will be emitted from the swarm as `connection` events.

`topic` must be a 32-byte Buffer
`opts` can include:
* `server`: Accept server connections for this topic by announcing yourself to the DHT. Defaults to `true`.
* `client`: Actively search for and connect to discovered servers. Defaults to `true`.

Returns a [`PeerDiscovery`](https://github.com/holepunchto/hyperswarm/blob/v3/README.md#peerdiscovery-api) object.

#### Clients and Servers
In Hyperswarm, there are two ways for peers to join the swarm: client mode and server mode. If you've previously used Hyperswarm v2, these were called "lookup" and "announce", but we now think "client" and "server" are more descriptive.

When you join a topic as a server, the swarm will start accepting incoming connections from clients (peers that have joined the same topic in client mode). Server mode will announce your keypair to the DHT, so that other peers can discover your server. When server connections are emitted, they are not associated with a specific topic -- the server only knows it received an incoming connection.

When you join a topic as a client, the swarm will do a query to discover available servers, and will eagerly connect to them. As with server mode, these connections will be emitted as `connection` events, but in client mode they __will__ be associated with the topic (`info.topics` will be set in the `connection` event).

#### `await swarm.leave(topic)`
Stop discovering peers for the given topic.

`topic` must be a 32-byte Buffer

If a topic was previously joined in server mode, `leave` will stop announcing the topic on the DHT. If a topic was previously joined in client mode, `leave` will stop searching for servers announcing the topic.

`leave` will __not__ close any existing connections.

#### `swarm.joinPeer(noisePublicKey)`
Establish a direct connection to a known peer.

`noisePublicKey` must be a 32-byte Buffer

As with the standard `join` method, `joinPeer` will ensure that peer connections are reestablished in the event of failures.

#### `swarm.leavePeer(noisePublicKey)`
Stop attempting direct connections to a known peer.

`noisePublicKey` must be a 32-byte Buffer

If a direct connection is already established, that connection will __not__ be destroyed by `leavePeer`.

#### `const discovery = swarm.status(topic)`
Get the [`PeerDiscovery`](https://github.com/holepunchto/hyperswarm/blob/v3/README.md#peerdiscovery-api) object associated with the topic, if it exists.

#### `await swarm.listen()`
Explicitly start listening for incoming connections. This will be called internally after the first `join`, so it rarely needs to be called manually.

#### `await swarm.flush()`
Wait for any pending DHT announces, and for the swarm to connect to any pending peers (peers that have been discovered, but are still in the queue awaiting processing).

Once a `flush()` has completed, the swarm will have connected to every peer it can discover from the current set of topics it's managing.

`flush()` is not topic-specific, so it will wait for every pending DHT operation and connection to be processed -- it's quite heavyweight, so it could take a while. In most cases, it's not necessary, as connections are emitted by `swarm.on('connection')` immediately after they're opened.  

## PeerDiscovery API

`swarm.join` returns a `PeerDiscovery` instance which allows you to both control discovery behavior, and respond to lifecycle changes during discovery.

#### `await discovery.flushed()`
Wait until the topic has been fully announced to the DHT. This method is only relevant in server mode. When `flushed()` has completed, the server will be available to the network.

#### `await discovery.refresh({ client, server })`
Update the `PeerDiscovery` configuration, optionally toggling client and server modes. This will also trigger an immediate re-announce of the topic, when the `PeerDiscovery` is in server mode.

#### `await discovery.destroy()`
Stop discovering peers for the given topic. 

If a topic was previously joined in server mode, `leave` will stop announcing the topic on the DHT. If a topic was previously joined in client mode, `leave` will stop searching for servers announcing the topic.

## PeerInfo API

`swarm.on('connection', ...)` emits a `PeerInfo` instance whenever a new connection is established.

There is a one-to-one relationship between connections and `PeerInfo` objects -- if a single peer announces multiple topics, those topics will be multiplexed over a single connection.

#### `peerInfo.publicKey`
The peer's Noise public key.

#### `peerInfo.topics`
An Array of topics that this Peer is associated with -- `topics` will only be updated when the Peer is in client mode.

#### `peerInfo.prioritized`
If true, the swarm will rapidly attempt to reconnect to this peer.

#### `peerInfo.ban()`
Ban the peer. This will prevent any future reconnection attempts, but it will __not__ close any existing connections.

## License
MIT
