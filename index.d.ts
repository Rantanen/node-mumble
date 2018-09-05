import { EventEmitter } from "events"; 
import { Socket } from "net"; 
import { Writable, Readable } from "stream"; 
declare class Channel {
    /**
     * Single channel on the server.
     * @param data - Channel data.
     * @param client - Mumble client that owns the channel.
     */
    constructor(data: Object, client: MumbleClient);

    links: Channel[];

    children: Channel[];

    users: User[];

    id: number;

    name: string;

    join(): void;

    /**
     * 
     * @param message - The message to send.
     */
    sendMessage(message: string): void;

    /**
     * 
     * @param callback - Result callback
     */
    getPermissions(callback: Function): void;

    /**
     * 
     * @param name - New sub-channel name.
     * @param options - Channel options.
     */
    addSubChannel(name: string, options: Object): void;

    remove(): void;

}

declare class MumbleClient extends EventEmitter {
    /**
     * 
     * Instances should be created with Mumble.connect().
     * @param connection - The underlying connection.
     */
    constructor(connection: MumbleConnection);

    /**
     * 
     * The connection is considered `ready` when the server handshake has been
     * processed and the initial ping has been received.
     */
    ready: Boolean;

    /**
     * 
     * The connection object is used for the low level access to the Mumble
     * protocol. Most developers should find a higher level APIs for the
     * functionality on the {@link MumbleClient} class instead.
     */
    connection: MumbleConnection;

    rootChannel: Channel;

    user: User;

    /**
     * 
     * @returns Users connected to the server
     */
    users(): User[];

    /**
     * 
     * @param id - Channel ID to search for.
     * @returns The channel found or undefined.
     */
    channelById(id: number): Channel;

    /**
     * 
     * Every connected user has a session ID. The ID identifies the current
     * connection and will change when the user reconnects.
     * @param id - The session ID to search for.
     * @returns The user found or undefined.
     */
    userBySession(id: number): User;

    /**
     * 
     * User ID exists only on registered users. The ID will remain the same between
     * different sessions.
     * @param id - The user ID to search for.
     * @returns The user found or undefined.
     */
    userById(id: number): User;

    /**
     * 
     * @param name - Channel name to search for.
     * @returns The first channel found or undefined.
     */
    channelByName(name: string): Channel;

    /**
     * 
     * @param path - Channel path
     * @returns The channel found or undefined.
     */
    channelByPath(path: string): Channel;

    /**
     * 
     * @param name - User name to search for.
     * @returns The user found or undefined.
     */
    userByName(name: string): User;

    /**
     * 
     * @param callback -
     *        Will be called with all registered users once the query succeeded.
     */
    getRegisteredUsers(callback: Function): void;

    /**
     * 
     * @param sessionId -
     *        Single user session ID or an array of those.
     * @param options -
     *        Input stream options.
     * @returns Input stream
     */
    inputStreamForUser(sessionId: number | any[], options: Object): MumbleInputStream;

    /**
     * 
     * This method must be invoked to start the authentication handshake. Once the
     * handshake is done the client emits `initialized` event and the rest of the
     * functionality will be available.
     * @param name -
     *        Username. Ignored for registered users who will use the username
     *        registered with the certificate.
     * @param password -
     *        Optional password. Required if the username is in use and certificate
     *        isn't supplied.
     * @param tokens - list of ACL tokens to apply on connection
     */
    authenticate(name: string, password: string, tokens: string[]): void;

    /**
     * 
     * Previously a method with the same name was used to send raw Mumble protocol
     * messages.  Use {@link MumbleConnection#sendMessage} for that now.
     * @param message - The text to send.
     * @param recipients - Target users.
     * @param recipients.session - Session IDs of target users.
     * @param recipients.channel_id - Channel IDs of target channels.
     */
    sendMessage(message: string, recipients: (sendMessage_recipients)[]): void;

    /**
     * 
     * @param userid -
     *        Optional user session ID. Defines the user whose audio the stream will
     *        handle. If omitted the stream will output mixed audio.
     * @returns - Output stream that can be used to stream the audio out.
     */
    outputStream(userid: number): MumbleOutputStream;

    /**
     * 
     * @param options - Input stream options.
     * @returns - Input stream for streaming audio to the server.
     */
    inputStream(options: Object): MumbleInputStream;

    /**
     * 
     * @deprecated We should add "findByPath" method instead which can be used to
     *             retrieve `Channel` instance.
     * @param path - Path to join.
     */
    joinPath(path: string): void;

    /**
     * 
     * Consider using the streams.
     * @param chunk - 16bitLE PCM buffer of voice audio.
     */
    sendVoice(chunk: Buffer): void;

    disconnect(): void;

}

declare interface sendMessage_recipients {
    /**
     * Session IDs of target users.
     */
    session: number[];
    /**
     * Channel IDs of target channels.
     */
    channel_id: number[];
}

declare class MumbleConnection extends EventEmitter {
    /**
     * Mumble connection
     * @param socket - SSL socket connected to the server.
     * @param options - Connection options.
     */
    constructor(socket: Socket, options: Object);

    /**
     * Send the static init information
     */
    initialize(): void;

    /**
     * Authenticate the user
     * @param name - Username
     * @param password - User password
     * @param tokens - Access tokens
     */
    authenticate(name: string, password: string, tokens: string[]): void;

    /**
     * Send a protocol message
     * @param type Message type ID
     * @param data Message data
     */
    sendMessage(type: string, data: Object): void;

    /**
     * Returns a new output stream for audio.
     * @param userSession Optional user session ID. If omitted the output stream will receive
     *        the mixed audio output for all users.
     * @param noEmptyFrames Enable or disable emitting empty frames for silence.
     * @returns Output stream.
     */
    outputStream(userSession: number, noEmptyFrames: boolean): MumbleOutputStream;

    /**
     * Returns a new input stream for audio.
     * @param options - Input stream options
     * @returns Input stream.
     */
    inputStream(options: Object): MumbleInputStream;

    /**
     * Join a channel specified by a Mumble URL
     * @param path - Path to join.
     */
    joinPath(path: string): void;

    /**
     * Send voice data to the server.
     * 
     * TODO: Add a flush timeout to flush remaining audio data if
     * the buffer contains remnant data.
     * @param chunk - PCM audio data in 16bit unsigned LE format.
     * @param whisperTarget - Optional whisper target ID.
     */
    sendVoice(chunk: Buffer, whisperTarget: number): void;

    /**
     * 
     * @param frame - Voice frame.
     *        The buffer must be the size of a one frame.
     *        Use sendVoice to send arbitrary length buffers.
     * @param whisperTarget - Optional whisper target ID. Defaults to null.
     * @param voiceSequence -
     *        Voice packet sequence number. Required when multiplexing several audio
     *        streams to different users.
     * @returns Frames sent
     */
    sendVoiceFrame(frame: Buffer, whisperTarget?: number, voiceSequence?: number): Buffer;

    /**
     * 
     * @param packets - Encoded frames.
     * @param codec - Audio codec number for the packets.
     * @param whisperTarget - Optional whisper target ID. Defaults to null.
     * @param voiceSequence -
     *        Voice packet sequence number. Required when multiplexing several audio
     *        streams to different users.
     * @returns Amount of frames sent.
     */
    sendEncodedFrame(packets: Buffer, codec: number, whisperTarget?: number, voiceSequence?: number): number;

    /**
     * Disconnects the client from Mumble
     */
    disconnect(): void;

}

/**
 * Encodes the version to an uint8 that can be sent to the server for version-exchange
 * @param major - Major version.
 * @param minor - Minor version.
 * @param patch - Patch number.
 * @returns 32-bit encoded version number.
 */
declare function encodeVersion(major: number, minor: number, patch: number): number;

declare class MumbleConnectionManager {
    /**
     * 
     * A connection tool to decouple connecting to the server
     * from the module itself.
     * 
     * The URL specified to the connection manager the Mumble server address.
     * It can be either host with optional port specified with `host:port`
     * or then the full `mumble://`.
     * @param url - Mumble server address.
     * @param options - TLS options.
     */
    constructor(url: string, options: Object);

    /**
     * 
     * Connects to the Mumble server provided in the constructor
     * @param done Connection callback receiving {@link MumbleClient}.
     */
    connect(done: ConnectionCallback): void;

}

/**
 * 
 * @param err - An error of one occured
 * @param client - The mumble client for the connection
 */
declare type ConnectionCallback = (err: Error | null, client: MumbleClient)=>void;

/**
 * Error class for delivering server errors.
 * @param name - Error type name.
 * @param data - Error data.
 */
declare function MumbleError(name: string, data: Object): void;

declare class MumbleInputStream extends Writable {
    /**
     * 
     * The stream implements the `WritableStream` interface.
     * 
     * The input data format can be specified with the constructor options. The
     * final audio will be converted to mono 16-bit PCM at 48 kHz.
     * 
     * Currently the packets are sent to murmur in 10ms packets. The sample rate
     * should be such that it can divide the audio to packets of that size.
     * @param connection Mumble connection to write to
     * @param options - Stream options.
     * @param options.sampleRate - Input sample rate. Defaults to 48000.
     * @param options.channels - Input channels. Defaults to 1.
     * @param options.gain - Volume multiplier. Defaults to 1.
     */
    constructor(connection: MumbleConnection, options?: undefined_options);

    close(): void;

    /**
     * 
     * @param gain - New gain value.
     */
    setGain(gain: number): void;

}

declare interface undefined_options {
    /**
     * Input sample rate. Defaults to 48000.
     */
    sampleRate: number;
    /**
     * Input channels. Defaults to 1.
     */
    channels: number;
    /**
     * Volume multiplier. Defaults to 1.
     */
    gain: number;
}

declare class MumbleOutputStream extends Readable {
    /**
     * 
     * The stream implements the `ReadableStream` interface
     * 
     * The output data will be 16-bit PCM at 48 kHz. There's no options to resample
     * it like there are for the InputStream.
     * @param connection - Mumble connection to read from.
     * @param sessionId - User session ID.
     * @param options - Stream options.
     */
    constructor(connection: MumbleConnection, sessionId: number, options: Object);

    close(): void;

    /**
     * ReadableStream _read implementation
     * 
     * This method is called by the ReadableStream when it requests more data.
     * @param size Number of bytes to read
     */
    _read(size: number): void;

}

declare class MumbleSocket {
    /**
     * Mumble network protocol wrapper for an SSL socket
     * @param socket SSL socket to be wrapped.
     *        The socket must be connected to the Mumble server.
     */
    constructor(socket: Socket);

    /**
     * Handle incoming data from the socket
     * @param data Incoming data buffer
     */
    receiveData(data: Buffer): void;

    /**
     * Queue a reader callback for incoming data.
     * @param length The amount of data this callback expects
     * @param callback The data callback
     */
    read(length: number, callback: Function): void;

    /**
     * Write message into the socket
     * @param buffer Message to write
     */
    write(buffer: Buffer): void;

    /**
     * Close the socket
     */
    end(): void;

}

declare class User {
    /**
     * Single user on the server.
     * @param data - User data.
     * @param client - Mumble client that owns this user.
     */
    constructor(data: Object, client: MumbleClient);

    /**
     * 
     * @param channel - Channel name or a channel object
     */
    moveToChannel(channel: Channel | string): void;

    /**
     * 
     * @param comment - The new comment
     */
    setComment(comment: string): void;

    /**
     * 
     * @param isSelfDeaf - The new self deafened state
     */
    setSelfDeaf(isSelfDeaf: boolean): void;

    /**
     * 
     * @param isSelfMute - The new self muted state
     */
    setSelfMute(isSelfMute: boolean): void;

    /**
     * 
     * @param reason - The reason to kick the user for.
     */
    kick(reason?: string): void;

    /**
     * 
     * @param reason - The reason to ban the user for.
     */
    ban(reason?: string): void;

    /**
     * 
     * @param message - The message to send.
     */
    sendMessage(message: string): void;

    /**
     * 
     * @param noEmptyFrames True to cut the output stream during silence. If the output stream
     *        isn't cut it will keep emitting zero-values when the user isn't
     *        talking.
     * @returns Output stream.
     */
    outputStream(noEmptyFrames?: boolean): MumbleOutputStream;

    /**
     * 
     * @returns Input stream.
     */
    inputStream(): MumbleInputStream;

    /**
     * 
     * @returns True if the user can talk.
     */
    canTalk(): boolean;

    register(): void;

    /**
     * 
     * @returns True if the user can hear.
     */
    canHear(): boolean;

    /**
     * 
     * @returns _true_ if the user is registered.
     */
    isRegistered(): boolean;

    /**
     * 
     * Session ID is present for all users. The ID specifies the current user
     * session and will change when the user reconnects.
     * @see User#id
     */
    session: number;

    name: string;

    /**
     * 
     * User ID is specified only for users who are registered on the server.
     * The user ID won't change when the user reconnects.
     * @see User#session
     */
    id: number;

    mute: boolean;

    deaf: boolean;

    /**
     * 
     * The user will be suppressed by the server if they don't have permissions
     * to speak on the current channel.
     */
    suppress: boolean;

    selfMute: boolean;

    selfDeaf: boolean;

    hash: string;

    recording: boolean;

    prioritySpeaker: boolean;

    channel: Channel;

}

/**
 * 
 * @see
 * @param i - Integer to convert
 * @returns Varint encoded number
 */
declare function toVarint(i: number): Buffer;

/**
 * 
 * @see
 * @param b - Varint to convert
 * @returns Decoded integer
 */
declare function fromVarint(b: Buffer): number;

/**
 * 
 * @param permissionFlags - Permission bit flags
 * @returns Permission object with the bit flags decoded.
 */
declare function readPermissions(permissionFlags: number): Object;

/**
 * 
 * @param permissionObject - Permissions object
 * @returns Permission bit flags
 */
declare function writePermissions(permissionObject: Object): number;

/**
 * Applies gain to the audio frame. Modifies the frame.
 * @param frame - Audio frame with 16-bit samples.
 * @param gain - Multiplier for each sample.
 * @returns The audio frame passed in.
 */
declare function applyGain(frame: Buffer, gain: number): Buffer;

/**
 * Downmixes multi-channel frame to mono.
 * @param frame - Multi-channel audio frame.
 * @param channels - Number of channels.
 * @returns Downmixed audio frame.
 */
declare function downmixChannels(frame: Buffer, channels: number): Buffer;

/**
 * 
 * The resampling is done by duplicating samples every now and then so it's not
 * the best quality. Also the source/target rate conversion must result in a
 * whole number of samples for the frame size.
 * @param frame - Original frame
 * @param sourceRate - Original sample rate
 * @param targetRate - Target sample rate
 * @returns New resampled buffer.
 */
declare function resample(frame: Buffer, sourceRate: number, targetRate: number): Buffer;

/**
 * 
 * Assuming both source and target Bit depth are multiples of eight, this
 * function rescales the frame. E.g. it can be used to make a 16 Bit audio
 * frame of an 8 Bit audio frame.
 * @param frame - Original frame
 * @param sourceDepth - Original Bit depth
 * @param sourceUnsigned - whether the source values are unsigned
 * @param sourceBE - whether the source values are big endian
 * @returns Rescaled buffer.
 */
declare function rescaleToUInt16LE(frame: Buffer, sourceDepth: number, sourceUnsigned: Boolean, sourceBE: Boolean): Buffer;

