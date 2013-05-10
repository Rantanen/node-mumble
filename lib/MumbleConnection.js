
"use strict";

var CeltEncoder = require('node-celt').CeltEncoder;
var MumbleSocket = require('./MumbleSocket');
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
var MumbleConnection = function (socket) {
    var self = this;
    this.socket = new MumbleSocket(socket);

    // Currently using just one encoder.
    // It works but doesn't achieve optimal audio quality.
    // TODO: Set up one encoder per Mumble user.
    this.encoder = new CeltEncoder( 48000, 480 );

    // Set up the ping loop.
    this.pingInterval = setInterval(function () { self._ping(); }, 1000);

    // Member fields.
    this.channels = {};
    this.packetBuffer = new Buffer( 480 * 2 );
    this.voiceBuffer = [];
    this.voiceBufferLength = 0;
    this.voiceSequence = 0;

    // Initialize the debug files if we specified MUMBLE_FILEOUT option.
    if( process.env.MUMBLE_FILEOUT ) {
        var fs = require('fs');
        var fname = process.env.MUMBLE_FILEOUT;
        this.out_pcm = fs.createWriteStream( fname + "_out.pcm" );
        this.out_celt = fs.createWriteStream( fname + "_out.celt" );
    }

    // Start waiting for the init messages.
    this.initPending = [ 'ServerSync','ServerConfig' ];

    // Start queueing for a message prefix.
    this._waitForPrefix(this);
};
MumbleConnection.prototype = Object.create( EventEmitter.prototype );

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
MumbleConnection.prototype.authenticate = function( name ) {
    this.sendMessage('Authenticate', { username: name });
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

    // Write the message.
    this.socket.write(prefix);
    this.socket.write(msg);
};

/**
 * Join a channel specified by a Mumble URL
 *
 * @param url Mumble URL
 **/
MumbleConnection.prototype.joinUrl = function ( url ) {

    // Parse the URL
    var matches = /mumble:\/\/([\w\.]+)(\/[^?]+)?(\?[^#]*)?/.exec( url );

    // Read the matches.
    var host = matches[1];
    var path = matches[2];
    var query = matches[3];

    // Iterate the path segments.
    path = path.split('/');
    var channel = this.rootChannel;
    for( var i in path ) {
        if( path[i] === '' ) { continue; }
        var segment = decodeURIComponent( path[i] );
        var nextChannel = this._findChannel( channel.channelId, segment, true );
        if( nextChannel === null ) { WARN( 'Path not found!' ); break; }
        channel = nextChannel;
    }

    // Send a new user state to update the current channel.
    this.sendMessage( 'UserState', { userId: this.userId, actor: this.userId, channelId: channel.channelId });
};

/**
 * Send voice data to the server.
 *
 * TODO: Add a flush timeout to flush remaining audio data if
 *       the buffer contains remnant data.
 *
 * @param packet Voice packet
 **/
MumbleConnection.prototype.sendVoice = function ( packet ) {

    // Add the packet to the queue.
    this.voiceBuffer.push( packet );
    this.voiceBufferLength += packet.length;

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

        // Grab the encoded buffer.
        var encoded = this.encoder.encode( this.packetBuffer );

        // Send the raw CELT packets.
        this.sendVoiceEncoded( encoded );

        // Write debug information if we got a debug file.
        if( this.out_celt ) { this.out_celt.write( encoded ); }
    }

    // Write debug information if we got a debug file.
    if( this.out_pcm ) { this.out_pcm.write( this.packetBuffer ); }
}

/**
 * Send CELT encoded voice frames.
 *
 * TODO: Support packet array for multiple frames within one audio packet.
 *
 * @param packet CELT encoded frame.
 **/
MumbleConnection.prototype.sendVoiceEncoded = function ( packets ) {

    // If the parameter was a single buffer, turn it into an array.
    if( packets instanceof Buffer ) {
        packets = [ packets ];
    }

    var type = 0 // Celt alpha;
    var target = 0 // Talking
    var typetarget = type << 5 + target;

    // Create the voice packet header.
    var sessionVarint = util.toVarint( this.userId );
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
    for( var i in frames ) { this.socket.write( frames[i] ); }
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
}

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
        if( initIndex != -1 ) { this.initPending.splice( initIndex, 1 ); }

        if( this.initPending.length == 0 ) {
            TRACE('Mumble connection initialized.');
            this.initPending = null;
            this.emit( 'initialized' );
        }
    }
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
        channel = { channelId: channelData.channelId, parent: null };
        this.channels[ channelData.channelId ] = channel;

        // Update the rootChannel if this channel doesn't have a parent.
        if( channel.parent === null ) {
            this.rootChannel = channel;
        }
    }

    // Copy the new values to the previous channel.
    for( var i in channelData ) {
        channel[ i ] = channelData[ i ];
    }

};

/**
 * Handle server sync message
 *
 * @param syncData Server sync message
 **/
MumbleConnection.prototype._onServerSync = function ( syncData ) {
    this.userId = syncData.session;
};

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

    // Read the audio frames.
    while( true ) {

        // Audio frame header.
        var header = packet[0];
        var length = header & 0x7F;
        if( length === 0 ) { break; }

        // CELT encoded audio data.
        var data = packet.slice(1, length + 1);

        // Emit a voice-encoded message.
        var emitParam = { session: session, type: type, packet: data };
        this.emit( 'voice-encoded', emitParam );

        // Make sure there are listeners for the voice event before decoding.
        if( this.listeners('voice').length > 0 ) {

            // We got listeners for voice event so do decode.
            var voice = this.encoder.decode( data );
            this.emit( 'voice', { session: session, data: voice } );
        }

        // If the terminator bit is 0, break.
        if( header & 0x80 == 0 ) { break; }

        // Slice the current packet off the buffer and repeat.
        packet = packet.slice( length + 1);
    }
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
