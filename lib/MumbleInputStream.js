
"use strict";

var EventEmitter = require('events').EventEmitter;
var WritableStream = require('stream').Writable;


/**
 * Mumble input stream
 *
 * @constructor
 * @this {MumbleInputStream}
 * @param {MumbleConnection} connection Mumble connection to write to
 */
var MumbleInputStream = function( connection, options ) {
    var self = this;
    this.connection = connection;

    if( options && options.decodeStrings === false ) {
        throw new TypeError( "MumbleInputStream does not support decoded string writes" );
    }

    this.processInterval = setInterval(
        this._processBuffer.bind( this ),
        this.connection.FRAME_LENGTH );

    this.processObserver = new EventEmitter();
    this.frameQueue = [];
    this.lastFrame = new Buffer( this.connection.FRAME_SIZE * 2 );
    this.lastFrameWritten = 0;
    this.queuedForPlay = 0;
    this.lastWrite = Date.now();

    // Call the Writable constructor
    WritableStream.call( this, options );
};
MumbleInputStream.prototype = Object.create( WritableStream.prototype );

MumbleInputStream.prototype.LOCAL_BUFFER_SIZE = 10;
MumbleInputStream.prototype.PLAY_BUFFER_SIZE = 5;

/**
 * Closes the stream
 */
MumbleInputStream.prototype.close = function () {
    clearInterval( this.processInterval );
};

/**
 * Processes the frameQueue by sending frames to the connection
 */
MumbleInputStream.prototype._processBuffer = function() {

    while( this.lastWrite + this.connection.FRAME_LENGTH < Date.now() ) {
        if( this.frameQueue.length > 0 ) {

            // Take the first frame and send it.
            var frame = this.frameQueue[0];
            this.frameQueue.splice(0,1);
            this.connection.sendVoiceFrame( frame );

            // Raise 'written' event to notify the _write implementation that
            // it might be able to write more chunks to the internal buffer.
            this.processObserver.emit( 'written' );
        }

        this.lastWrite += this.connection.FRAME_LENGTH;
    }

    return;
};


/**
 * Writes incoming chunks to the voice channel
 *
 * This method is called by the WritableStream when data is being written.
 *
 * @param {Buffer} chunk The chunk to be written
 * @param {String} encoding Not used
 * @param {Function} callback Callback to signal writing the chunk is done.
 */
MumbleInputStream.prototype._write = function( chunk, encoding, callback ) {

    while( true ) {

        // If we are at the buffer cap, wait until the buffer is emptied
        // before writing the rest.
        if( this.frameQueue.length >= this.LOCAL_BUFFER_SIZE ) {
            var self = this;
            this.processObserver.once( 'written', function () {
                self._write( chunk, encoding, callback );
            });
            return;
        }

        // Write the chunk to the current buffer.
        var writtenBefore = this.lastFrameWritten;
        chunk.copy( this.lastFrame, this.lastFrameWritten, 0 );
        var written = writtenBefore + chunk.length;

        // Check if we've written the last frame full.
        if( written >= this.lastFrame.length ) {

            // Frame is full.
            // Fix the 'written' value and queue the frame.
            written = this.lastFrame.length;
            this.frameQueue.push( this.lastFrame );
            this.lastFrame = new Buffer( this.connection.FRAME_SIZE * 2 );
            this.lastFrameWritten = 0;

        } else {

            // Frame not full. Advance the lastFrameWritten.
            this.lastFrameWritten = written;

        }

        // Check if the chunk was written in full or if some remains.
        if( chunk.length > (written - writtenBefore) ) {

            // Chunk was larger than remaining space in the last frame.
            chunk.slice( written - writtenBefore );

        } else {

            // Chunk was written completely.
            return callback();

        }

    }
};

module.exports = MumbleInputStream;
