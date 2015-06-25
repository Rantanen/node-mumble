
"use strict";

var jitter = require('jitterbuffer');
var CeltEncoder = require('celt').CeltEncoder;
var OpusEncoder = require('node-opus').OpusEncoder;
var MumbleSocket = require('./MumbleSocket');
var MumbleOutputStream = require('./MumbleOutputStream');
var MumbleInputStream = require('./MumbleInputStream');
var Messages = require('./MumbleMessageMap');
var util = require('./util');
var DIR = util.dir;
var TRACE = util.trace;
var WARN = util.warn;

var EventEmitter = require('events').EventEmitter;

/**
 * Mumble connection
 *
 * @param socket SSL socket connected to the server.
 **/
var MumbleConnection = function (socket, options) {
    var self = this;
    this.socket = new MumbleSocket(socket);
    this.options = options;
    socket.on('close', this.disconnect.bind( this ) );

    // Set up the encoders we use for encoding our audio.
    this.opusEncoder = new OpusEncoder( this.SAMPLING_RATE );
    this.celtEncoder = new CeltEncoder( this.SAMPLING_RATE, this.FRAME_SIZE );

    this.currentEncoder = this.opusEncoder;
    this.codec = MumbleConnection.codec.Opus;

    // Set up the ping loop.
    this.pingInterval = setInterval(function () { self._ping(); }, 1000);

    // Member fields.
    this.channels = {};
    this.users = {};
    this.packetBuffer = new Buffer( this.FRAME_SIZE * 2 );
    this.voiceBuffer = [];
    this.voiceBufferLength = 0;
    this.voiceSequence = 0;
    this.authSent = false;

    this.lastProcess = Date.now();
    this.processInterval = setInterval( this._processAudio.bind( this ), this.FRAME_LENGTH );

    // Initialize the debug files if we specified MUMBLE_FILEOUT option.
    if( process.env.MUMBLE_FILEOUT ) {
        var fs = require('fs');
        var fname = process.env.MUMBLE_FILEOUT;
        this.out_pcm = fs.createWriteStream( fname + "_out.pcm" );
        this.out_celt = fs.createWriteStream( fname + "_out.celt" );
        this.in_celt = fs.createWriteStream( fname + "_in.celt" );
        this.in_jitter_celt = fs.createWriteStream( fname + "_in_jitter.celt" );
    }

    // Start waiting for the init messages.
    this.initPending = [ 'ServerSync','ServerConfig' ];

    // Start queueing for a message prefix.
    this._waitForPrefix(this);
};
MumbleConnection.prototype = Object.create( EventEmitter.prototype );

MumbleConnection.codec = { Celt: 0, Opus: 4 };
MumbleConnection.codecValues = {};
Object.keys( MumbleConnection.codec ).forEach( function( k ) {
    MumbleConnection.codecValues[ MumbleConnection.codec[ k ] ] = k;
});

MumbleConnection.prototype.SAMPLING_RATE = 48000;
MumbleConnection.prototype.FRAME_SIZE = 48000 / 100;
MumbleConnection.prototype.FRAME_LENGTH = 10;

/**
 * Encodes the version to an uint8 that can be sent to the server for version-exchange
 **/
function encodeVersion(major, minor, patch) {
    return ((major & 0xffff) << 16) |  // 2 bytes major
        ((minor & 0xff) << 8) |  // 1 byte minor
        (patch & 0xff); // 1 byte patch
}

/**
 * Send the static init information
 **/
MumbleConnection.prototype.initialize = function () {
    this.sendMessage('Version', { version: encodeVersion(1, 2, 7), release: 'Node.js-client', os: 'Node.js', os_version: process.version });
};

MumbleConnection.prototype.setBitrate = function( bitrate ) {
    this.celtEncoder.setBitrate( bitrate );
    this.opusEncoder.setBitrate( bitrate );
};

/**
 * Authenticate the user
 *
 * @param name Username
 **/
MumbleConnection.prototype.authenticate = function( name, password ) {
    this.sendMessage('Authenticate', {
        username: name,
        password: password,
        opus: true,
        celt_versions: this.options.celtVersions || util.celtVersions.default
    });
    this.authSent = true;
};

/**
 * Send a protocol message
 *
 * @param type Message type ID
 * @param data Message data
 **/
MumbleConnection.prototype.sendMessage = function (type, data) {
    DIR( data );

    // Look up the message schema by type and serialize the data into protobuf format.
    var msg = Messages.buildPacket(type, data);
    var packet = msg.toBuffer();

    // Create the prefix.
    var prefix = new Buffer(6);
    prefix.writeUInt16BE(Messages.idByName[type], 0);
    prefix.writeUInt32BE(packet.length, 2);

    this.emit( 'protocol-out', { type: type, message: data  });

    // Write the message.
    this.socket.write(prefix);
    this.socket.write(packet);
};

/**
 * Returns a new output stream for audio.
 *
 * @param userSession int
 *      Optional user session ID. If omitted the output stream will receive
 *      the mixed audio output for all users.
 **/
MumbleConnection.prototype.outputStream = function ( userSession, noEmptyFrames ) {
    if(typeof userSession === "boolean") {  // To make it possible to create an OutputStream without empty frames without having to specify a session id
        userSession = undefined;
        noEmptyFrames = userSession;
    }
    var stream = new MumbleOutputStream( this, userSession , { noEmptyFrames : noEmptyFrames });
    return stream;
};

/**
 * Returns a new input stream for audio.
 *
 * @param {Object} options - Input stream options
 **/
MumbleConnection.prototype.inputStream = function ( options ) {
    var stream = new MumbleInputStream( this, options );
    return stream;
};

/**
 * Join a channel specified by a Mumble URL
 *
 * @param url Mumble URL
 **/
MumbleConnection.prototype.joinPath = function ( path ) {

    var channel = this.rootChannel;
    for( var i in path ) {
        if( path[i] === '' ) { continue; }
        var segment = decodeURIComponent( path[i] );
        var nextChannel = this._findChannel( channel.channel_id, segment, true );
        if( nextChannel === null ) { WARN( 'Path not found!' ); break; }
        channel = nextChannel;
    }

    // Send a new user state to update the current channel.
    this.sendMessage( 'UserState', { session: this.sessionId, actor: this.sessionId, channel_id: channel.channel_id });
};

/**
 * Send voice data to the server.
 *
 * TODO: Add a flush timeout to flush remaining audio data if
 *       the buffer contains remnant data.
 *
 * @param {Buffer} packet - PCM audio data in 16bit unsigned LE format.
 * @param {Number} whisperTarget - Optional whisper target ID.
 **/
MumbleConnection.prototype.sendVoice = function ( chunk, whisperTarget ) {

    // Add the chunk to the queue.
    this.voiceBuffer.push( chunk );
    this.voiceBufferLength += chunk.length;

    // Send voice packets as long as we got full packet buffers to encode.
    while( this.voiceBufferLength >= this.packetBuffer.length ) {

        // Fill the packet buffer.
        var written = 0;
        while( written < this.packetBuffer.length ) {
            this.voiceBuffer[0].copy( this.packetBuffer, 0 );
            written = written + this.voiceBuffer[0].length;

            if( written > this.packetBuffer.length ) {
                // voiceBuffer had more data than the packet buffer could hold.
                // Slice the extra off the start of the voice buffer.

                var writtenBefore = written - this.voiceBuffer[0].length;
                var writtenFromThis = this.packetBuffer.length - writtenBefore;

                this.voiceBuffer[0] = this.voiceBuffer.slice( writtenFromThis );
                this.voiceBufferLength = this.voiceBufferLength - writtenFromThis;
            } else {
                // Voice buffer was written completely. Remove it from the buffers.
                this.voiceBufferLength = this.voiceBufferLength - this.voiceBuffer[0].length;
                this.voiceBuffer.splice(0,1);
            }
        }

        this.sendVoiceFrame( this.packetBuffer, whisperTarget );
    }

    // Write debug information if we got a debug file.
    if( this.out_pcm ) { this.out_pcm.write( this.packetBuffer ); }
};


/**
 * @summary Send a voice frame.
 *
 * @param {Buffer} frame - Voice frame.
 *      The buffer must be the size of a one frame.
 *      Use sendVoice to send arbitrary length buffers.
 * @param {Number} [whisperTarget] - Optional whisper target ID. Defaults to null.
 * @param {Number} [voiceSequence] -
 *      Voice packet sequence number. Required when multiplexing several audio
 *      streams to different users.
 **/
MumbleConnection.prototype.sendVoiceFrame = function( frame, whisperTarget, voiceSequence ) {
    if( this.initPending ) { throw new Error( 'Wait for "initialized" event before attempting to send audio.' ); }

    // If frame is empty, we got nothing to send.
    if( frame.length === 0 ) { return; }

    // Grab the encoded buffer.
    var encoded = this.currentEncoder.encode( frame );

    // Send the raw packets.
    var frames = this.sendEncodedFrame( encoded, this.codec, whisperTarget, voiceSequence );

    // Write debug information if we got a debug file.
    if( this.out_celt ) { this.out_celt.write( encoded ); }

    return frames;
};

/**
 * @summary Send encoded voice frames.
 *
 * @param {Buffer} packet - Encoded frame.
 * @param {Number} codec - Audio codec number for the packets.
 * @param {Number} [whisperTarget] - Optional whisper target ID. Defaults to null.
 * @param {Number} [voiceSequence] -
 *      Voice packet sequence number. Required when multiplexing several audio
 *      streams to different users.
 **/
MumbleConnection.prototype.sendEncodedFrame = function ( packets, codec, whisperTarget, voiceSequence ) {
    // If the parameter was a single buffer, turn it into an array.
    if( packets instanceof Buffer ) {
        packets = [ packets ];
    }

    var type = codec === MumbleConnection.codec.Opus ? 4 : 0;
    var target = whisperTarget || 0; // Default to talking
    var typetarget = type << 5 | target;

    // Resolve the sequence number and convert it to varint for the header.
    if( typeof voiceSequence !== 'number' )
        voiceSequence = this.voiceSequence;
    var sequenceVarint = util.toVarint( voiceSequence );

    // Client side voice header.
    var voiceHeader = new Buffer( 1 + sequenceVarint.length );
    voiceHeader[0] = typetarget;
    sequenceVarint.value.copy( voiceHeader, 1, 0 );

    // Gather the audio frames.
    var frames = [];
    var framesLength = 0;
    for( var i = 0; i < packets.length; i++ ) {
        var packet = packets[i];

        // Construct the header based on the codec type.
        var header;
        if( codec === MumbleConnection.codec.Opus ) {

            // Opus header
            if( packet.length > 0x1FFF ) {
                throw new TypeError( "Audio frame too long! Opus max length " + 0x1FFF + " bytes." );
            }

            // TODO: Figure out how to support termiantor bit.
            var headerValue = packet.length;
            var headerVarint = util.toVarint( headerValue );
            header = headerVarint.value;

        } else {

            // Celt
            if( packet.length > 127 ) {
                throw new TypeError( "Audio frame too long! Celt max length 127 bytes." );
            }

            // If this isn't the last frame, set the terminator bit as 1.
            // This signals there are more audio frames after this one.
            var terminator = ( i === packets.length - 1 );
            header = new Buffer([ packet.length | ( terminator ? 0 : 0x10 ) ]);
        }

        var frame = new Buffer( header.length + packet.length );
        header.copy( frame, 0 );

        // Copy the packet to the remaining bits.
        packet.copy( frame, header.length );

        // Push the frame to the list.
        frames.push( frame );
        framesLength += frame.length;
        voiceSequence++;
    }

    // UDP tunnel prefix.
    var prefix = new Buffer(6);
    prefix.writeUInt16BE( Messages.idByName.UDPTunnel, 0 );
    prefix.writeUInt32BE( voiceHeader.length + framesLength, 2 );
    this.socket.write(prefix);

    // Write the voice header
    this.socket.write(voiceHeader);

    // Write the frames.
    for( var f in frames ) { this.socket.write( frames[f] ); }

    // The local voice sequence should track the highest voice sequence number
    // sent out.
    if( voiceSequence > this.voiceSequence ) {
        this.voiceSequence = voiceSequence;
    }

    return frames.length;
};

/**
 * Disconnects the client from Mumble
 */
MumbleConnection.prototype.disconnect = function() {
    clearInterval( this.pingInterval );
    this.emit('disconnect');
    this.socket.end();
    this.removeAllListeners();
};

/**
 * Process incoming message
 *
 * @private
 *
 * @param type Message type ID
 * @param data Message data
 **/
MumbleConnection.prototype._processData = function (type, data) {

    // Check whether this is an UDP packet or a protobuf message.
    if( Messages.nameById[ type ] === 'UDPTunnel' ) {

        // This is an UDP packet.
        this._onUDPTunnel( data );

    } else {

        // Protobuf message, deserialize and process.
        var msg = Messages.decodePacket(type, data);
        this._processMessage( type, msg );

    }
};

/**
 * Process incoming protobuf message
 *
 * @private
 *
 * @param type Message type ID
 * @param msg Message
 **/
MumbleConnection.prototype._processMessage = function( type, msg ) {

    // Check whether we have a handler for this or not.
    if( !this[ "_on" + Messages.nameById[ type ] ] ) {
        TRACE( "Unhandled message:" + Messages.nameById[type] );
        TRACE( Messages.nameById[ type ] );
        TRACE( msg );
    } else {

        // Handler found -> delegate.
        this[ "_on" + Messages.nameById[ type ] ]( msg );

    }

    // Check initialization state.
    if( this.initPending ) {
        var initIndex = this.initPending.indexOf( Messages.nameById[ type ] );
        if( initIndex !== -1 ) { this.initPending.splice( initIndex, 1 ); }

        if( this.initPending.length === 0 ) {
            this.initialize();
            TRACE('Mumble connection initialized.');
            this.initPending = null;
            this.emit( 'initialized', this );
        }
    }

    var handlerName = Messages.nameById[ type ];
    handlerName = handlerName.replace(
        /^([A-Z][A-Z]*?)(?=([A-Z]?[a-z])|$)/g,
        function( match, $1 ) {
            return $1.toLowerCase();
        });

    this.emit( handlerName, msg );
    this.emit( 'protocol-in', {
        handler: handlerName,
        type: Messages.nameById[ type ],
        message: msg });
};

/**
 * Handle codecVersion message
 *
 * @private
 *
 * @param msg Codec message
 **/
MumbleConnection.prototype._onCodecVersion = function( codecVersion ) {
    if( codecVersion.opus ) {
        this.currentEncoder = this.opusEncoder;
        this.codec = MumbleConnection.codec.Opus;
    } else {
        this.currentEncoder = this.celtEncoder;
        this.codec = MumbleConnection.codec.Celt;
    }
};

/**
 * Handle ping message
 *
 * @private
 *
 * @param msg Ping message
 **/
MumbleConnection.prototype._onPing = function () {
    // Just to get rid of "Unhandled message" spam on Ping
    // TODO: Add disconnect on ping timeout.
};

/**
 * Handle channel state message
 *
 * @private
 *
 * @param channelData Channel state message
 **/
MumbleConnection.prototype._onChannelState = function ( channelData ) {

    // See if we know of this channel already.
    var channel = this.channels[ channelData.channel_id ];
    if( !channel ) {

        // This is a new channel, add it to the collection.
        channel = { channel_id: channelData.channel_id, parent: channelData.parent };
        this.channels[ channelData.channel_id ] = channel;

        // Update the rootChannel if this channel doesn't have a parent.
        if( !channel.parent ) {
            this.rootChannel = channel;
        }
    }

    // Copy the new values to the previous channel.
    for( var i in channelData ) {
        channel[ i ] = channelData[ i ];
    }

};

/**
 * Handle user state message
 *
 * @private
 *
 * @param userState User state message
 */
MumbleConnection.prototype._onUserState = function ( userState ) {

    var user = this.users[ userState.session ];
    if( !user ) {
        var decoder;
        user = this.users[ userState.session ] = {
            talking: false,
            session: userState.session,
            buffer: new jitter.JitterBuffer( 10 )
        };

        user.buffer.setMargin(10);
    }

    // Copy the new values to the previous user.
    for( var i in userState ) {
        user[ i ] = userState[ i ];
    }

    this.emit( 'user-update', user );
};

/**
 * Handle server sync message
 *
 * @private
 *
 * @param syncData Server sync message
 **/
MumbleConnection.prototype._onServerSync = function ( syncData ) {
    this.sessionId = syncData.session;
};

/**
 * Handle the reject message
 *
 * @private
 *
 * @param reject Reject message
 **/
MumbleConnection.prototype._onReject = function ( reject ) {
    var emitted = false;

    // Emit the specific event.
    if( this.listeners( 'error' + reject.type ).length ) {
        this.emit( 'error' + reject.type, reject );
        emitted = true;
    }

    // Emit the error event.
    if( this.listeners( 'error' ).length ) {
        this.emit( 'error', reject );
        emitted = true;
    }

    // If this report wasn't handled in any way throw an exception.
    if( !emitted ) {
        throw new Error( reject.type + ': ' + reject.reason );
    }
};

/**
 * Handle incoming voice data
 *
 * @private
 *
 * @param data Voice packet
 **/
MumbleConnection.prototype._onUDPTunnel = function( data ) {

    // Voice data type
    var target = data[0] & 0x1f;
    var type = ( data[0] & 0xe0 ) >> 5;

    // Ignore the packet if we don't understand the codec value.
    if( !MumbleConnection.codecValues[ type ] )
        return;

    // Read rest of the header.
    var session = util.fromVarint( data.slice(1) );
    var sequence = util.fromVarint( data.slice(1 + session.length) );
    var packet = data.slice(1 + session.length + sequence.length);

    var user = this.users[ session.value ];
    if( !user ) { return; }

    // Read the audio frames.
    sequence = sequence.value;
    var moreFrames = true;
    while( moreFrames && packet.length > 0 ) {

        // Audio frame header.
        var headerLength, frameLength, terminateAudio;
        var header;
        if( type === MumbleConnection.codec.Celt ) {

            // Celt header is two bytes.
            header = packet[0];

            headerLength = 1;
            frameLength = header & 0x7F;
            terminateAudio = ( frameLength === 0 );
            moreFrames = ( header & 0x80 );

        } else if( type === MumbleConnection.codec.Opus ) {

            // Opus header is two bytes.
            var headerVarint = util.fromVarint( packet );
            header = headerVarint.value;

            headerLength = headerVarint.length;
            frameLength = header & 0x1FFF;
            terminateAudio = header & 0x2000;
            moreFrames = false;
        }
        var frame = packet.slice( headerLength, headerLength + frameLength );
        terminateAudio = terminateAudio ? 1 : 0;

        // Put the packet in the jitter buffer.
        var jitterPacket = {
            data: frame,
            timestamp: sequence * this.FRAME_LENGTH,
            span: this.FRAME_LENGTH,
            sequence: sequence++,
            userData: ( terminateAudio << 7 ) | type,
        };
        user.buffer.put( jitterPacket );
        user.voiceActive = true;

        // Write debug information if we got a debug file.
        if( this.in_celt ) { this.in_celt.write( packet ); }

        // Slice the current packet off the buffer and repeat.
        packet = packet.slice( headerLength + frameLength );
    }
};


/**
 * Processes the incoming audio queue
 *
 * @private
 **/
MumbleConnection.prototype._processAudio = function() {
    var self = this;

    while( this.lastProcess + this.FRAME_LENGTH < Date.now() ) {
        var user, packet;
        var packets = this._dequeueFrames();

        // Update the user talk-state.
        for( var p in packets ) {
            packet = packets[p];
            user = packet.user;

            //console.log( packet );
            if( packet.frame && !user.talking ) {
                user.talking = true;
                this.emit( 'voice-start', { session: user.session, name: user.name, talking: true } );
            }

            if( packet.terminator ) {
                user.talking = false;
                user.voiceActive = false;
                this.emit( 'voice-end', { session: user.session, name: user.name, talking: false } );
            }
        }

        for( var u in this.users ) {
            user = this.users[ u ];
            if( user.talking && user.missedFrames > 20 ) {
                user.talking = false;
                user.voiceActive = false;
                this.emit( 'voice-end', { session: user.session, name: user.name, talking: false } );
            }
        }

        this.emit( 'voice-frame', packets );


        // We got listeners for voice event so do decode.
        var decoded = [];
        var decodedUser = {};
        for( var f in packets ) {
            packet = packets[f];
            user = packet.user;

            // Make sure there are listeners for the voice event before decoding.
            if( this.listeners( 'voice' ).length === 0 &&
                this.listeners( 'voice-user-' + user.session ).length === 0 ) {

                continue;
            }

            // Decode the packet using the correct decoder based on the packet
            // codec.

            var decoder = this._getDecoder( user, packet.codec );
            var data = decoder.decode( packets[f].frame );

            var decodedPacket = {
                data: data,
                codec: packet.codec,
                session: packet.session
            };

            decodedUser[ user.session ] = decodedUser[ user.session ] || [];
            decodedUser[ user.session ].push( decodedPacket );
            decoded.push( decodedPacket );
        }

        if( decoded.length > 0 ) {

            // Emit the premix event as it's cheap.
            Object.keys( decodedUser ).forEach( function( key ) {
                var packets = decodedUser[ key ];
                for( var p in packets ) {
                    self.emit('voice-user-' + key, packets[ p ].data );
                }
            });

            // The voice event is more expensive as it requires mixing audio.
            // Emit it only if we know there's someone listening.
            if( this.listeners('voice').length > 0 ) {

                var mixed = this._mix( decoded );
                this.emit( 'voice', mixed );
            }
        }

        this.lastProcess += this.FRAME_LENGTH;
    }
};

/**
 * Dequeue the next frames for each user from the Jitterbuffer
 *
 * @private
 */
MumbleConnection.prototype._dequeueFrames = function() {

    var packets = [];
    for( var i in this.users ) {
        var user = this.users[i];

        // We don't need to skip the users who aren't talking.
        if( !user.voiceActive ) {
            continue;
        }

        // Get the frame for the user
        var frame = user.buffer.get( this.FRAME_LENGTH );

        var packet = {
            user: user,
            session: user.session,
        };

        // Set the frame data of the packet depending on the jitterbuffer
        // result.
        if( frame.data ) {

            // Use the dequeued data.
            packet.frame = frame.data;
            packet.codec = frame.userData & 0x7f;
            packet.terminator = ( frame.userData & 0x80 ) > 0;
            packets.push( packet );

            // Store this as the last successful frame so we can use it
            // if the jitterbuffer is getting low on buffered content.
            user.lastFrame = frame.packet;
            user.missedFrames = 0;

        } else if( frame === jitter.INSERTION && user.lastFrame ) {

            // If the jitterbuffer wants to pad the buffer,
            // duplicate the last frame as the fake frame.
            packet.frame = user.lastFrame.frame;
            packet.codec = user.lastFrame.codec;
            packets.push( packet );

            user.missedFrames++;
        } else {
            user.missedFrames++;
        }

        user.buffer.tick();
    }

    return packets;
};

/**
 * Mix a punch of different audio buffers into one
 *
 * @private
 *
 * @param {Buffer} decoded Decoded audio sample buffers
 * @return {Buffer} Mixed audio sample buffer
 */
MumbleConnection.prototype._mix = function( decoded ) {

    var mixed;

    // There's a good chance there will be only one speaker.
    // At this point we don't need to do mixing at all.
    // Just use that one frame as it is.
    if( decoded.length === 1 ) {
        mixed = decoded[0].data;
    } else {

        // Multiple speakers. Mix the frames.
        mixed = new Buffer( this.FRAME_SIZE * 2 );
        for( var i = 0; i < this.FRAME_SIZE; i++ ) {

            // Sum the sample
            var sum = 0;
            for( var d in decoded ) {
                sum += decoded[d].data.readInt16LE( i*2 );
            }

            // Truncate the sum to 16-bit
            // TODO: These are just quick limits. Fix them for min/max values.
            if( sum > 1 << 14 ) { sum = 1 << 14; }
            if( -sum > 1 << 14 ) { sum = -(1 << 14); }

            mixed.writeInt16LE( sum, i*2 );
        }
    }

    return mixed;
};

/**
 * Wait for a prefix on the TCP socket
 *
 * @private
 **/
MumbleConnection.prototype._waitForPrefix = function () {
    var self = this;

    // Read 6 byte prefix.
    this.socket.read(6, function (data) {
        var type = data.readUInt16BE(0);
        var length = data.readUInt32BE(2);

        // Read the rest of the message based on the length prefix.
        self.socket.read(length, function (data) {
            self._processData(type, data);

            // Wait for the next message.
            self._waitForPrefix();
        });
    });
};

/**
 * Send the ping message
 *
 * @private
 **/
MumbleConnection.prototype._ping = function () {
    this.sendMessage('Ping', { timestamp: Date.now() });
};

/**
 * Look up a channel by channel name under a parent
 *
 * @private
 *
 * @param parentId Parent channel ID
 * @param name Channel name to be looked up
 * @param caseInsensitive true to perform case insensitive name comparison
 **/
MumbleConnection.prototype._findChannel = function( parentId, name, caseInsensitive ) {
    if( caseInsensitive ) { name = name.toLowerCase(); }

    for( var i in this.channels ) {
        var c = this.channels[i];
        var key = c.name;
        if( caseInsensitive ) { key = key.toLowerCase(); }
        if( c.parent === parentId && key === name ) { return c; }
    }

    return null;
};

MumbleConnection.prototype._getDecoder = function( user, codec ) {
    if( codec === MumbleConnection.codec.Opus ) {
        if( user.opusDecoder ) {
            return user.opusDecoder;
        }
        return ( user.opusDecoder = new OpusEncoder( this.SAMPLING_RATE ) );
    } else {
        if( user.celtDecoder ) {
            return user.celtDecoder;
        }
        return ( user.celtDecoder = new CeltEncoder( this.SAMPLING_RATE, this.FRAME_SIZE ) );
    }
};

module.exports = MumbleConnection;
