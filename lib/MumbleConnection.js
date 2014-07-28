
"use strict";

var jitter = require('jitterbuffer');
var CeltEncoder = require('celt').CeltEncoder;
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

    // Currently using just one encoder.
    // It works but doesn't achieve optimal audio quality.
    // TODO: Set up one encoder per Mumble user.
    this.encoder = new CeltEncoder( this.SAMPLING_RATE, this.FRAME_SIZE );

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

MumbleConnection.prototype.SAMPLING_RATE = 48000;
MumbleConnection.prototype.FRAME_SIZE = 48000 / 100;
MumbleConnection.prototype.FRAME_LENGTH = 10;

/**
 * Send the static init information
 **/
MumbleConnection.prototype.initialize = function () {
    this.sendMessage('Version', { version: 1, release: 'Node.js-client', os: 'Node.js', osVersion: process.version });
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
        celtVersions: this.options.celtVersions || util.celtVersions.default
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
    var msg = Messages.schemaByName[type].serialize(data);

    // Create the prefix.
    var prefix = new Buffer(6);
    prefix.writeUInt16BE(Messages.idByName[type], 0);
    prefix.writeUInt32BE(msg.length, 2);

    this.emit( 'protocol-out', { type: type, message: data  });

    // Write the message.
    this.socket.write(prefix);
    this.socket.write(msg);
};

/**
 * Returns a new output stream for audio.
 *
 * @param userSession int
 *      Optional user session ID. If omitted the output stream will receive
 *      the mixed audio output for all users.
 **/
MumbleConnection.prototype.outputStream = function ( userSession ) {
    var stream = new MumbleOutputStream( this );
    return stream;
};

/**
 * Returns a new input stream for audio.
 **/
MumbleConnection.prototype.inputStream = function () {
    var stream = new MumbleInputStream( this );
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
        var nextChannel = this._findChannel( channel.channelId, segment, true );
        if( nextChannel === null ) { WARN( 'Path not found!' ); break; }
        channel = nextChannel;
    }

    // Send a new user state to update the current channel.
    this.sendMessage( 'UserState', { session: this.sessionId, actor: this.sessionId, channelId: channel.channelId });
};

/**
 * Send voice data to the server.
 *
 * TODO: Add a flush timeout to flush remaining audio data if
 *       the buffer contains remnant data.
 *
 * @param packet Voice buffer
 **/
MumbleConnection.prototype.sendVoice = function ( chunk ) {

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

        this.sendVoiceFrame( this.packetBuffer );
    }

    // Write debug information if we got a debug file.
    if( this.out_pcm ) { this.out_pcm.write( this.packetBuffer ); }
};


/**
 * Send a voice frame.
 *
 * @param {Buffer} frame Voice frame.
 *        The buffer must be the size of a one frame.
 *        Use sendVoice to send arbitrary length buffers.
 **/
MumbleConnection.prototype.sendVoiceFrame = function( frame ) {

    if( this.initPending ) { throw new Error( 'Wait for "initialized" event before attempting to send audio.' ); }

    // Grab the encoded buffer.
    var encoded = this.encoder.encode( frame );

    // Send the raw CELT packets.
    this.sendEncodedFrame( encoded );

    // Write debug information if we got a debug file.
    if( this.out_celt ) { this.out_celt.write( encoded ); }
};

/**
 * Send CELT encoded voice frames.
 *
 * TODO: Support packet array for multiple frames within one audio packet.
 *
 * @param packet CELT encoded frame.
 **/
MumbleConnection.prototype.sendEncodedFrame = function ( packets ) {

    // If the parameter was a single buffer, turn it into an array.
    if( packets instanceof Buffer ) {
        packets = [ packets ];
    }

    var type = 0; // Celt alpha;
    var target = 0; // Talking
    var typetarget = type << 5 + target;

    // Create the voice packet header.
    var sessionVarint = util.toVarint( this.sessionId );
    var sequenceVarint = util.toVarint( this.voiceSequence );

    // Client side voice header.
    var voiceHeader = new Buffer( 1 + sequenceVarint.length );
    voiceHeader[0] = typetarget;
    sequenceVarint.value.copy( voiceHeader, 1, 0 );

    // Gather the audio frames.
    var frames = [];
    var framesLength = 0;
    for( var i = 0; i < packets.length; i++ ) {
        var packet = packets[i];
        if( packet.length > 127 ) { throw new TypeError( "Audio frame too long! Max length 127 bytes." ); }

        var frame = new Buffer( 1 + packet.length );
        frame[0] = packet.length;

        // If this isn't the last frame, set the terminator bit as 1.
        // This signals there are more audio frames after this one.
        if( i < packets.length - 1 ) {
            frame[0] = frame[0] + (1 << 7);
        }
        // Copy the packet to the remaining bits.
        packet.copy( frame, 1, 0 );

        // Push the frame to the list.
        frames.push( frame );
        framesLength += frame.length;
        this.voiceSequence++;
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
};

/**
 * Disconnects the client from Mumble
 */
MumbleConnection.prototype.disconnect = function() {
    clearInterval( this.pingInterval );
    this.emit('disconnect');
    this.socket.end();
    this.removeAllListeners();
    console.log( "Mumble connection closed" );
};

/**
 * Process incoming message
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
        var schema = Messages.schemaById[type];
        var msg = schema.parse(data);
        this._processMessage( type, msg );

    }
};

/**
 * Process incoming protobuf message
 *
 * @param type Message type ID
 * @param msg Message
 **/
MumbleConnection.prototype._processMessage = function( type, msg ) {

    // Check whether we have a handler for this or not.
    if( !this[ "_on" + Messages.nameById[ type ] ] ) {
        TRACE( "Unhandled message" );
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
 * Handle ping message
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
 * @param channelData Channel state message
 **/
MumbleConnection.prototype._onChannelState = function ( channelData ) {

    // See if we know of this channel already.
    var channel = this.channels[ channelData.channelId ];
    if( !channel ) {

        // This is a new channel, add it to the collection.
        channel = { channelId: channelData.channelId, parent: channelData.parent };
        this.channels[ channelData.channelId ] = channel;

        // Update the rootChannel if this channel doesn't have a parent.
        if( typeof channel.parent === 'undefined' ) {
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
 * @param userState User state message
 */
MumbleConnection.prototype._onUserState = function ( userState ) {

    var user = this.users[ userState.session ];
    if( !user ) {
        user = this.users[ userState.session ] = {
            talking: false,
            session: userState.session,
            buffer: new jitter.JitterBuffer( 10 ),
            decoder: new CeltEncoder( this.SAMPLING_RATE, this.FRAME_SIZE )
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
 * @param syncData Server sync message
 **/
MumbleConnection.prototype._onServerSync = function ( syncData ) {
    this.sessionId = syncData.session;
};

/**
 * Handle the reject message
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
 * @param data Voice packet
 **/
MumbleConnection.prototype._onUDPTunnel = function( data ) {
    
    // Voice data type
    // TODO: Implement actual type checking.
    //       Currently we only support Celt 0.7.0 packets.
    var type = data[0];

    // Read rest of the header.
    var session = util.fromVarint( data.slice(1) );
    var sequence = util.fromVarint( data.slice(1 + session.length) );
    var packet = data.slice(1 + session.length + sequence.length);

    var user = this.users[ session.value ];
    if( !user ) { return; }

    // Read the audio frames.
    sequence = sequence.value;
    while( true ) {

        // Audio frame header.
        var header = packet[0];
        var length = header & 0x7F;
        if( length === 0 ) { break; }

        // CELT encoded audio data.
        var frame = packet.slice(1, length + 1);

        // Put the packet in the jitter buffer.
        var jitterPacket = {
            data: frame,
            timestamp: sequence * this.FRAME_LENGTH,
            span: this.FRAME_LENGTH,
            sequence: sequence,
            userData: type
        };
        user.buffer.put( jitterPacket );

        // Write debug information if we got a debug file.
        if( this.in_celt ) { this.in_celt.write( packet ); }

        // If the terminator bit is 0, break.
        if( header & 0x80 === 0 ) { break; }

        // Slice the current packet off the buffer and repeat.
        packet = packet.slice( length + 1);
        sequence++;
    }
};


/**
 * Processes the incoming audio queue
 **/
MumbleConnection.prototype._processAudio = function() {

    while( this.lastProcess + this.FRAME_LENGTH < Date.now() )
    {

        var packets = this._dequeueFrames();

        // Update the user talk-state.
        for( var p in packets ) {
            var packet = packets[p];
            var user = packet.user;

            if( packet.frame && !user.talking ) {
                user.talking = true;
                this.emit( 'voice-start', { session: user.session, name: user.name, talking: true } );
            } else if (user.talking && user.missedFrames > 20) {
                user.talking = false;
                this.emit( 'voice-end', { session: user.session, name: user.name, talking: false } );
            }
        }

        this.emit( 'voice-frame', packets );

        // Make sure there are listeners for the voice event before decoding.
        if( packets.length > 0 && (
            this.listeners('voice').length > 0 ||
            this.listeners('voice-user-' + user.session).length > 0 )) {

            // We got listeners for voice event so do decode.
            var decoded = [];
            for( var f in packets ) {
                decoded.push({
                    data: packets[f].decoder.decode( packets[f].frame ),
                    codec: packets[f].codec,
                    session: packets[f].session
                });
            }

            // Emit the premix event as it's cheap.
            this.emit('voice-user-' + user.session, decoded);

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
 */
MumbleConnection.prototype._dequeueFrames = function() {

    var packets = [];
    for( var i in this.users ) {

        // Get the frame for the user
        var user = this.users[i];
        var frame = user.buffer.get( this.FRAME_LENGTH );

        var packet = {
            user: user,
            session: user.session,
            decoder: user.decoder,
        };

        // Set the frame data of the packet depending on the jitterbuffer
        // result.
        if( frame.data ) {

            // Use the dequeued data.
            packet.frame = frame.data;
            packet.codec = (frame.userData & 0xff) >> 5,
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
 **/
MumbleConnection.prototype._ping = function () {
    this.sendMessage('Ping', { timestamp: Date.now() });
};

/**
 * Look up a channel by channel name under a parent
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

module.exports = MumbleConnection;
