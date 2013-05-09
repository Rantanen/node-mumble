
"use strict";

var CeltEncoder = require('../../node-celt').CeltEncoder;
var MumbleSocket = require('./MumbleSocket');
var Messages = require('./MumbleMessageMap');
var util = require('./util');
var DIR = util.dir;
var TRACE = util.trace;
var WARN = util.warn;

var EventEmitter = require('events').EventEmitter;
var fs = require('fs');

var readData = function (conn, prefix) {
    var type = prefix.readUInt16BE(0);
    var length = prefix.readUInt32BE(2);

    conn.socket.read(length, function (data) { conn.processData(type, data); });
};

var readPrefix = function (conn) {
    conn.socket.read(6, function (data) { readData(conn, data); });
};

var MumbleConnection = function (socket) {
    var self = this;
    this.socket = new MumbleSocket(socket);

    this.pingInterval = setInterval(function () { self.ping(); }, 1000);

    this.channels = {};
    this.encoder = new CeltEncoder( 48000, 480 );

    this.packetBuffer = new Buffer( 480 * 2 );
    this.voiceBuffer = [];
    this.voiceBufferLength = 0;

    if( process.env.MUMBLE_FILEOUT ) {
        var fname = process.env.MUMBLE_FILEOUT;
        this.out_pcm = fs.createWriteStream( fname + "_out.pcm" );
        this.out_celt = fs.createWriteStream( fname + "_out.celt" );
    }

    this.initPending = [ 'UserState','ServerConfig' ];

    this.voiceSequence = 0;
    readPrefix(this);
};
MumbleConnection.prototype = Object.create( EventEmitter.prototype );

MumbleConnection.prototype.initialize = function () {
    this.sendMessage('Version', { version: 1, release: 'Node.js-client', os: 'Node.js', osVersion: process.version });
};

MumbleConnection.prototype.authenticate = function( name ) {
    this.sendMessage('Authenticate', { username: name });
};

MumbleConnection.prototype.ping = function () {
    this.sendMessage('Ping', { timestamp: Date.now() });
};

MumbleConnection.prototype.sendMessage = function (type, data) {
    DIR( data );
    var msg = Messages.schemaByName[type].serialize(data);

    var prefix = new Buffer(6);
    prefix.writeUInt16BE(Messages.idByName[type], 0);
    prefix.writeUInt32BE(msg.length, 2);

    this.socket.write(prefix);
    this.socket.write(msg);
};

MumbleConnection.prototype.processData = function (type, data) {
    if( Messages.nameById[ type ] === 'UDPTunnel' ) {
        this.onUDPTunnel( data );
        readPrefix(this);
        return;
    }

    var schema = Messages.schemaById[type];
    fs.writeFileSync('data', data);

    var msg = schema.parse(data);

    if( !this[ "on" + Messages.nameById[ type ] ] ) {
        TRACE( Messages.nameById[ type ] );
        TRACE(msg);
    } else {
        this[ "on" + Messages.nameById[ type ] ]( msg );
    }

    if( this.initPending ) {
        var initIndex = this.initPending.indexOf( Messages.nameById[ type ] );
        if( initIndex != -1 ) {
            this.initPending.splice( initIndex, 1 );
        }


        if( this.initPending.length == 0 ) {
            TRACE('Mumble connection initialized.');
            this.initPending = null;
            this.emit( 'initialized' );
        } else {
            TRACE('Mumble connection pending: ' + this.initPending.join(', ') );
        }
    }

    readPrefix(this);
};

MumbleConnection.prototype.onPing = function () {
};

MumbleConnection.prototype.onChannelState = function ( channelData ) {
    var channel = this.channels[ channelData.channelId ];
    if( !channel ) {
        channel = { channelId: channelData.channelId, parent: null };
        this.channels[ channelData.channelId ] = channel;
    }

    for( var i in channelData ) {
        channel[ i ] = channelData[ i ];
    }

    if( channel.parent === null ) {
        this.rootChannel = channel;
    }
};

MumbleConnection.prototype.onServerSync = function ( syncData ) {
    this.userId = syncData.session;
    this.emit( 'connected' );
};

MumbleConnection.prototype.joinUrl = function ( url ) {
    var matches = /mumble:\/\/([\w\.]+)(\/[^?]+)?(\?[^#]*)?/.exec( url );

    var host = matches[1];
    var path = matches[2];
    var query = matches[3];

    path = path.split('/');
    var channel = this.rootChannel;
    for( var i in path ) {
        if( path[i] === '' ) { continue; }
        var segment = decodeURIComponent( path[i] );
        var nextChannel = this._findChannel( channel.channelId, segment, true );
        if( nextChannel === null ) { WARN( 'Path not found!' ); break; }
        channel = nextChannel;
    }

    this.sendMessage( 'UserState', { userId: this.userId, actor: this.userId, channelId: channel.channelId });
};

MumbleConnection.prototype.sendVoice = function ( packet ) {
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
        this.sendVoiceRaw( encoded );

        if( this.out_celt ) {
            this.out_celt.write( encoded );
        }
    }

    if( this.out_pcm ) {
        this.out_pcm.write( this.packetBuffer );
    }
}

MumbleConnection.prototype.sendVoiceRaw = function ( packet ) {
    var prefix = new Buffer(6);
    prefix.writeUInt16BE(Messages.idByName.UDPTunnel, 0);

    var type = 0 // Celt alpha;
    var target = 0 // Talking
    var typetarget = type << 5 + target;

    // Create the voice packet header.
    var sessionVarint = util.toVarint( this.userId );
    var sequenceVarint = util.toVarint( this.voiceSequence++ );

    var voiceHeader = new Buffer( 1 + sequenceVarint.length );
    voiceHeader[0] = typetarget;
    //sessionVarint.value.copy( voiceHeader, 1, 0 );
    //sequenceVarint.value.copy( voiceHeader, 1 + sessionVarint.length, 0 );
    sequenceVarint.value.copy( voiceHeader, 1, 0 );

    // Gather the audio frames.
    var frames = [];
    var audioLength = 0;
    while( packet.length > 0x7F ) {
        // Full frame.
        var frame = new Buffer( 1 + 0x7F );
        frame[0] = 255; // Terminator bit (128) + length of 127
        packet.copy( frame, 1, 0, 128 );
        packet = packet.slice(128);
        audioLength += frame.length;
        frames.push( frame );
    }

    var lastFrame = new Buffer( 1 + packet.length );
    lastFrame[0] = packet.length;
    packet.copy( lastFrame, 1, 0 );
    audioLength += lastFrame.length;
    frames.push( lastFrame );

    prefix.writeUInt32BE( voiceHeader.length + audioLength, 2 );

    this.socket.write(prefix);
    this.socket.write(voiceHeader);
    for( var i in frames ) {
        this.socket.write( frames[i] );
    }

};

MumbleConnection.prototype.onUDPTunnel = function( data ) {
    var type = data[0];
    var session = util.fromVarint( data.slice(1) );
    var sequence = util.fromVarint( data.slice(1 + session.length) );
    var packet = data.slice(1 + session.length + sequence.length);

    while( true ) {
        var header = packet[0];
        var length = header & 0x7F;
        if( length === 0 ) { break; }

        var data = packet.slice(1, length + 1);

        var emitParam = { session: session, type: type, packet: data, handled: false };
        this.emit( 'voice-encoded', emitParam );

        if( !emitParam.handled ) {
            var voice = this.encoder.decode( data );
            this.emit( 'voice', { session: session, data: voice } );
        }

        if( header & 0x80 == 0 ) { break; }
        packet = packet.slice( length + 1);
    }
};

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
