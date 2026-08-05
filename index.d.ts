// Type declarations for the holepunchto/hyperswarm public API.
/// <reference types="node" />

import type HyperDHT from 'hyperdht'

/**
 * `opts`
 */
export interface HyperswarmOptions {
  /** A unique, 32-byte, random seed that can be used to deterministically generate the key pair. */
  seed?: any
  relayThrough?: any
  /** A Noise keypair that will be used to listen/connect on the DHT. Defaults to a new key pair. */
  keyPair?: any
  /** The maximum number of peer connections to allow. */
  maxPeers?: any
  maxClientConnections?: any
  maxServerConnections?: any
  maxParallel?: any
  /** A sync function of the form `remotePublicKey => (true|false)`. If true, the connection will be rejected. Defaults to allowing all connections. */
  firewall?: any
  /** A DHT instance. Defaults to a new instance. */
  dht?: HyperDHT
  bootstrap?: any
  nodes?: any
  port?: any
  deferRandomPunch?: any
  randomPunchInterval?: any
  handshakeClearWait?: any
  backoffs?: any
  jitter?: any
}

/**
 * `opts`
 */
export interface HyperswarmJoinOptions {
  /** Accept server connections for this topic by announcing yourself to the DHT. Defaults to `true`. */
  server?: any
  /** Actively search for and connect to discovered servers. Defaults to `true`. */
  client?: any
  /** Set the max number of peers to connect to when joining the topic. Defaults to `Infinity`. */
  limit?: any
}

export interface HyperswarmDestroyOptions {
  force?: any
}

/**
 * `opts`
 */
export interface HyperswarmLogOptions {
  /** A logging function, which defaults to a noop function. */
  log?: any
}

export interface PeerDiscoveryRefreshOptions {
  client?: any
  server?: any
}

export class Hyperswarm {
  /**
   * Construct a new Hyperswarm instance.
   * @param opts - `opts`
   */
  constructor(opts?: HyperswarmOptions)

  keyPair: any

  /**
   * A hyperdht instance. Useful if you want lower-level control over Hyperswarm's networking.
   */
  dht: HyperDHT

  server: any

  destroyed: boolean

  suspended: boolean

  maxPeers: any

  maxClientConnections: any

  maxServerConnections: any

  maxParallel: any

  relayThrough: any

  /**
   * Number that indicates connections in progress.
   */
  connecting: number

  /**
   * A set of all active client/server connections.
   */
  connections: any

  /**
   * A Map containing all connected peers, of the form: `(Noise public key hex string) -> PeerInfo object`.
   */
  peers: any

  explicitPeers: any

  listening: any

  stats: any

  /**
   * Get the PeerDiscovery object associated with the topic, if it exists.
   * @param key - Topic.
   */
  status(key: Buffer): PeerDiscovery | null

  /**
   * Explicitly start listening for incoming connections. This will be called internally after the first `join`, so it rarely needs to be called manually.
   */
  listen(): Promise<any>

  /**
   * Start discovering and connecting to peers sharing a common topic. As new peers are connected to, they will be emitted from the swarm as `connection` events.
   * @param topic - Must be a 32-byte Buffer.
   * @param opts - `opts`
   * @returns A PeerDiscovery object.
   */
  join(topic: Buffer, opts?: HyperswarmJoinOptions): PeerDiscovery

  /**
   * Stop discovering peers for the given topic. Will not close any existing connections.
   * @param topic - Must be a 32-byte Buffer.
   */
  leave(topic: Buffer): Promise<any>

  /**
   * Establish a direct connection to a known peer.
   * @param noisePublicKey - Must be a 32-byte Buffer.
   */
  joinPeer(noisePublicKey: Buffer): void

  /**
   * Stop attempting direct connections to a known peer. Will not destroy an already-established connection.
   * @param noisePublicKey - Must be a 32-byte Buffer.
   */
  leavePeer(noisePublicKey: Buffer): void

  /**
   * Wait for any pending DHT announces, and for the swarm to connect to any pending peers.
   */
  flush(): Promise<any>

  clear(): Promise<any>

  destroy(opts?: HyperswarmDestroyOptions): Promise<any>

  /**
   * Suspend the swarm: disconnect all peers, suspend server listening, and stop discovery of new peers. Useful for suspending when the runtime suspends to pause networking.
   * @param opts - `opts`
   */
  suspend(opts?: HyperswarmLogOptions): Promise<any>

  /**
   * Resume a suspended swarm, refreshing discovery of new peers and servers. Useful for reannouncing to the DHT and reconnecting to peers when the runtime resumes.
   * @param opts - `opts`
   */
  resume(opts?: HyperswarmLogOptions): Promise<any>

  topics(): any

  /**
   * Emitted whenever the swarm connects to a new peer. `socket` is an end-to-end (Noise) encrypted Duplex stream. `peerInfo` is a PeerInfo instance.
   */
  on(event: 'connection', listener: (socket: any, peerInfo: PeerInfo) => void): this
  /**
   * Emitted when internal values are changed, useful for user interfaces. For example: emitted when `swarm.connecting` or `swarm.connections` changes.
   */
  on(event: 'update', listener: () => void): this
  /**
   * Emitted when a peer gets banned. `err` is an error object describing the reason for the ban (e.g. firewalled).
   */
  on(event: 'ban', listener: (peerInfo: PeerInfo, err: any) => void): this
}

declare class PeerDiscovery {
  /**
   * Wait until the topic has been fully announced to the DHT. This method is only relevant in server mode. When `flushed()` has completed, the server will be available to the network.
   */
  flushed(): Promise<any>

  /**
   * Update the PeerDiscovery configuration, optionally toggling client and server modes. This will also trigger an immediate re-announce of the topic, when the PeerDiscovery is in server mode.
   */
  refresh(opts?: PeerDiscoveryRefreshOptions): Promise<any>

  /**
   * Stop discovering peers for the given topic. Will not close any existing connections.
   */
  destroy(): Promise<any>
}

declare class PeerInfo {
  /**
   * The peer's Noise public key.
   */
  publicKey: any

  /**
   * An Array of topics that this Peer is associated with -- `topics` will only be updated when the Peer is in client mode.
   */
  topics: any

  /**
   * If true, the swarm will rapidly attempt to reconnect to this peer.
   */
  prioritized: any

  /**
   * Ban or unban the peer. Banning will prevent any future reconnection attempts, but it will not close any existing connections.
   */
  ban(banStatus?: boolean): any
}

export default Hyperswarm
