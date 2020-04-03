/// <reference types="node" />
import { EventEmitter } from 'events';
import { Socket } from 'net';
import { Duplex } from 'stream';

declare class PeerInfo extends EventEmitter {
    /**
    * The priority the peer has when trying to reconnect. Is an integer between 0 and 5. 5 meaning the highest priority and 0 meaning the lowest.
    */
    priority: number;
    /** A number indicating the state of the peer.
    * @todo explain thow the binary status works
    */
    status: number;
    /** The number of times we already tried to reconnect to the peer. After 3 retries all attempts to reconnect will we blocked until the queue forget time has passed. This number gets reset to 0 when a successful connection has been made. */
    retries: number;
    /**
    * Object describing the peer. Will be null if client === false
    * @todo Implement proper type
    */
    peer: any;
    /** If true, the connection was initiated by this node. */
    client: boolean;
    /** The stream we can use to communicate with the remote peer. */
    stream: Duplex;
    duplicate: this;
    /** The list of topics associated with this connection (when multiplex: true) */
    topics: Array<Buffer>;
    private index;
    private queue;
    constructor(peer: any, queue: any);

    /** Wether the peer is prioritised or not */
    get prioritised(): boolean;
    /** The type of connection to the peer */
    get type(): 'tcp' | 'utp';
    /** If the peer is behind a firewall */
    get firewalled(): boolean;
    /** If the peer is banned */
    get banned(): boolean;
    /** Use this method to deduplicate connections.
    * When two swarms both announce and do lookups on the same topic you'll get duplicate connections between them (one client connection and one server connection each).
    * If you exchange some sort of peer id between them you can use this method to make Hyperswarm deduplicate those connection (ie drop one of them deterministically).
    * If it returns true then this current connection was dropped due to deduplication and is auto removed. Only call this once per connection.
    */
    deduplicate(remoteId: Buffer, localId: Buffer): any;
    /** Call this to make the swarm backoff reconnecting to this peer. Can be called multiple times to backoff more. */
    backoff(): boolean;
    /** Tell Hyperswarm wether to reconnect to the peer if connection is lostr or not. */
    reconnect(shouldReconnect: boolean): void;
    /** Call this to ban this peer. Makes the swarm stop connecting to it. */
    ban(): void;
    /** Call this to destroy the peer instance. Destroys the stream. */
    destroy(err: Error): void;
    /** @todo mark as active? */
    active(val: boolean): void;
    /** */
    private requeue(): number;
    /** */
    private connected(stream: Duplex, isTCP: boolean): void;
    /** */
    private disconnected(): void;
    /** */
    private topic(topic: Buffer): void;
    /** */
    private update(): boolean;
}

interface SwarmOptions {
    /**
    * Optionally overwrite the default set of bootstrap servers
    * Each string has to be a valid IPv4 address followed by a port like so:
    *
    * `127.0.0.1:5001`
    */
    bootstrap?: Array<string>;
    /**
    * Set to false if this is a long running instance on a server
    * When running in ephemeral mode you don't join the DHT but just
    * query it instead. If unset, or set to a non-boolean (default undefined)
    * then the node will start in short-lived (ephemeral) mode and switch
    * to long-lived (non-ephemeral) mode after a certain period of uptime
    */
    ephemeral?: boolean;
    /** total amount of peers that this peer will connect to */
    maxPeers?: number;
    /**
    * Set et to a number to restrict the amount of server socket
    * based peer connections, unrestricted by default.
    * setting to 0 is the same as Infinity, to disallowe server
    * connections set to -1
    */
    maxServerSockets?: number;
    /**
    * set to a number to restrict the amount of client sockets
    * based peer connections, unrestricted by default.
    */
    maxClientSockets?: number;
    /** apply a filter before connecting to the peer */
    validatePeer?: (peer: any) => boolean;
    /** Set to false to hide the local Address on the network */
    announceLocalAddress?: boolean;
    /** configure peer management behaviour */
    queue?: {
        /**
        * an array of backoff times, in millieconds
        * every time a failing peer connection is retried
        * it will wait for specified milliseconds based on the
        * retry count, until it reaches the end of the requeue
        * array at which time the peer is considered unresponsive
        * and retry attempts cease
        */
        requeue?: Array<number>;
        /**
        * configure when to forget certain peer characteristics
        * and treat them as fresh peer connections again
        */
        forget?: {
            /**
            * how long to wait before forgetting that a peer
            * has become unresponsive
            */
            unresponsive?: number;
            /**
            * how long to wait before fogetting that a peer has been banned
            */
            banned?: number;
        };
        /** attempt to reuse existing connections between peers across multiple topics */
        multiplex?: boolean;
    };
}
interface TopicStatus {
    announce: boolean;
    lookup: boolean;
}

/**
* This class is the Hyperswarm Class
*
*/
declare class Hyperswarm extends EventEmitter {
    /** Is true if the Hyperswarm Instance has been destroyed */
    destroyed: boolean;
    prioritisedInflight: number;
    /** The number of active client sockets */
    clientSockets: number;
    /** The number of active server sockets */
    serverSockets: number;
    /** The number of peers we'Re connected with */
    peers: number;
    /** The maximum number of peers we can have */
    maxPeers: number;
    /** The maximum number of serverSockets we can have */
    maxServerSockets: number;
    /** The maximum number of clientSockets we can have */
    maxClientSockets: number;
    /** If we're open to ceonnection */
    open: boolean;
    /** A Set that contains all the open Sockets we have right now. Can be interated over to send a message to each peer */
    connections: Set<Socket>;
    /** The function that gets used to validate new peers before we connect to them*/
    validatePeer: SwarmOptions['validatePeer'];
    /** @internal */
    network: any;
    /** @internal */
    private kStatus;
    /** @internal */
    private kFlush;
    /** @internal */
    private kQueue;

    constructor(options?: SwarmOptions);

    on(event:string, listener:any):this;
    on(event: 'connection', listener: (socket: Socket, peerInfo: PeerInfo) => void): this;
    on(event: 'disconnection', listener: (socket: Socket, peerInfo: PeerInfo) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'updated', listener: (topic: Buffer) => void): this;
    on(event: 'peer-rejected', listener: (peer: any) => void): this;
    on(event: 'peer', listener: (peer: any) => void): this;
    on(event: 'join', listener: (topic: Buffer, status: TopicStatus) => void): this;
    on(event: 'leave', listener: (topic: Buffer) => void): this;

    /**
    * Returns your local Address.
    */
    address(): {
        host: string;
        port: number;
        family: 'IPv4' | 'IPv6'
    };
    /**
    * Returns an object indicating wheather a topic is being announced or performing a lookup, or null if the topic is unknown
    */
    status(key: Buffer): TopicStatus | null;
    /**
    * Returnes you public Ipv4 address as other peers would see it.
    */
    remoteAddress(): {
        host: string;
        port: number;
    } | null;
    /**
    * Return wether or not the network can be UDP holepunched
    */
    holepunchable(): boolean;
    /**
    * instructs the swarm to listen on the given port.
    */
    listen(port?: number, onlisten?: ( err:Error ) => void ): void;
    /**
    * Join the swarm for a given topic. This will cause peers to be discovered for the topic. Connections will automatically be created to those peers.
    */
    join(key: Buffer, opts?: TopicStatus, onjoin?: ( err:Error | undefined | null, join: { maxLength:number }) => void ): void;
    /**
    * Leave the swarm for the given topic.
    */
    leave(topic: Buffer, onleave?: () => void): void;
    /**
    * @todo: create Description or mark as private
    */
    flush(cb: (err?: Error) => void): void;
    private kLeave;
    /**
    * Establish a connection to the given peer. You usually won't need to use this function, because hyperswarm connects to found peers automatically.
    */
    connect(peer: any, onconnect?: ( socket:Socket, isTCP:boolean ) => void ): void;
    /**
    * @todo create Description
    */
    connectivity( cb: ( err:Error, connectivity: { bound:boolean, bootstrapped:boolean, holepunched:boolean }) => void): void;
    /**
    * This method destroys the swarm closing all connections to peers.
    */
    destroy( ondestroy?: () => void ): void;
    private kDrain;
    private kIncrPeerCount;
    private kDecrPeerCount;
}
export default function hyperswarm( options?: SwarmOptions ): Hyperswarm;
export { Hyperswarm }
