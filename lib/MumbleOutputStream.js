
'use strict';

var ReadableStream = require( 'stream' ).Readable;
var EventEmitter = require( 'events' ).EventEmitter;

/**
 * @summary Output stream for streaming audio out of Mumble.
 *
 * @description
 * The stream implements the `ReadableStream` interface
 *
 * The output data will be 16-bit PCM at 48 kHz. There's no options to resample
 * it like there are for the InputStream.
 *
 * @constructor
 * @this {MumbleOutputStream}
 *
 * @param {MumbleConnection} connection - Mumble connection to read from.
 * @param {number} sessionId - User session ID.
 * @param {Object} options - Stream options.
 */
var MumbleOutputStream = function( connection, sessionId, options ) {
    if( sessionId === undefined ) { sessionId = null; }

    var self = this;
    this.connection = connection;
    this.sessionId = sessionId;

    this.eventEmitter = new EventEmitter();
    this.frames = [];

    this.writtenUntil = Date.now();
    if( options ) {
        this.noEmptyFrames = options.noEmptyFrames;
    }

    if( !this.noEmptyFrames ) {
        this.emptyFrame = new Buffer( this.connection.FRAME_SIZE * 2 );
        this.emptyFrame.fill( 0 );
    }

    this.voiceListener = function( data ) { self._addAudio( data ); };

    if( sessionId === null ) {
        connection.on( 'voice', this.voiceListener );
    } else {
        connection.on( 'voice-user-' + sessionId, this.voiceListener );
    }

    // Call the Readable constructor
    ReadableStream.call( this, options );
};
MumbleOutputStream.prototype = Object.create( ReadableStream.prototype );

/**
 * @summary Closes the stream
 */
MumbleOutputStream.prototype.close = function() {
    this.connection.removeListener( 'voice', this.voiceListener );
};

/**
 * @summary Adds audio frames to the buffer
 *
 * @private
 *
 * @param {Object} data - Audio frame data.
 */
MumbleOutputStream.prototype._addAudio = function( data ) {

    this.frames.push( data );

    // If there is more than 5 seconds of buffered data, start cutting old frames out.
    while( this.frames.length > 5000 / this.connection.FRAME_LENGTH ) {
        this.frames.splice( 0, 1 );
    }

    this.eventEmitter.emit( 'newframes' );
};

/**
 * ReadableStream _read implementation
 *
 * This method is called by the ReadableStream when it requests more data.
 *
 * @param {number} size Number of bytes to read
 */
MumbleOutputStream.prototype._read = function( size ) {

    // If we got no queued audio frames, check stuff.
    if( this.frames.length === 0 ) {

        // If we're overdue on written frames, write an empty frame.
        if( !this.noEmptyFrames &&
            this.writtenUntil + this.connection.FRAME_LENGTH < Date.now() ) {

            this.push( this.emptyFrame );
            this.writtenUntil += this.connection.FRAME_LENGTH;
            return;
        }

        // We still got some time until new frames should arrive so requeue this function.
        var self = this;
        setTimeout( function() { self._read( size ); }, this.connection.FRAME_LENGTH );
        return;
    }

    // Keep pushing frames as long as there are some and the stream accepts them.
    while( this.frames.length > 0 ) {
        var frame = this.frames[ 0 ];
        this.frames.splice( 0, 1 );

        this.writtenUntil += this.connection.FRAME_LENGTH;
        if( !this.push( frame ) ) { break; }
    }
};

module.exports = MumbleOutputStream;
