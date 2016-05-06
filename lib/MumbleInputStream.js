
'use strict';

var EventEmitter = require( 'events' ).EventEmitter;
var WritableStream = require( 'stream' ).Writable;
var util = require( './util' );


/**
 * @summary Input stream for sending audio to Mumble.
 *
 * @description
 * The stream implements the `WritableStream` interface.
 *
 * The input data format can be specified with the constructor options. The
 * final audio will be converted to mono 16-bit PCM at 48 kHz.
 *
 * Currently the packets are sent to murmur in 10ms packets. The sample rate
 * should be such that it can divide the audio to packets of that size.
 *
 * @constructor
 * @this {MumbleInputStream}
 * @param {MumbleConnection} connection Mumble connection to write to
 * @param {Object} options - Stream options.
 * @param {number} options.sampleRate - Input sample rate. Defaults to 48000.
 * @param {number} options.channels - Input channels. Defaults to 1.
 * @param {number} options.gain - Volume multiplier. Defaults to 1.
 */
var MumbleInputStream = function( connection, options ) {

    options = options || {};

    this.connection = connection;
    this.channels = options.channels || 1;
    this.whisperId = options.whisperId;
    this.sampleRate = options.sampleRate || 48000;
    this.gain = options.gain || 1;
    this.bitDepth = options.bitDepth || 16;
    this.signed = options.signed !== undefined ? options.signed : true;
    this.endianness = options.endianness || 'LE';

    if( options && options.decodeStrings === false ) {
        throw new TypeError( 'MumbleInputStream does not support decoded string writes' );
    }

    this.processInterval = setInterval(
        this._processBuffer.bind( this ),
        this.connection.FRAME_LENGTH );

    this.processObserver = new EventEmitter();
    this.frameQueue = [];

    this.lastFrame = this._createFrameBuffer();

    this.lastFrameWritten = 0;
    this.queuedForPlay = 0;
    this.lastWrite = null;
    this.sent = 0;

    // Call the Writable constructor
    WritableStream.call( this, options );
};
MumbleInputStream.prototype = Object.create( WritableStream.prototype );

MumbleInputStream.prototype.LOCAL_BUFFER_SIZE = 10;
MumbleInputStream.prototype.PLAY_BUFFER_SIZE = 5;

/**
 * @summary Closes the stream
 */
MumbleInputStream.prototype.close = function() {
    clearInterval( this.processInterval );
};

/**
 * @summary Change the volume multiplier
 *
 * @param {number} gain - New gain value.
 */
MumbleInputStream.prototype.setGain = function( gain ) {
    if( gain <= 0 )
        throw new Error( 'Gain must be non-negative.' );

    this.gain = gain;
};

/**
 * Create new frame buffer
 *
 * @private
 *
 * @returns {Buffer} - New buffer of the correct size.
 */
MumbleInputStream.prototype._createFrameBuffer = function() {
    return new Buffer(
        this.sampleRate /
        1000 * this.connection.FRAME_LENGTH *
        2 * ( this.channels ) );
};

/**
 * Processes the frameQueue by sending frames to the connection
 *
 * @private
 */
MumbleInputStream.prototype._processBuffer = function() {

    // If there's been a gap in the audio, reset the sequence id.
    if( !this.lastWrite ||
        this.lastWrite + 20 * this.connection.FRAME_LENGTH < Date.now() ) {
        this.voiceSequence = this.connection.voiceSequence;
        this.lastWrite = Date.now();
        return;
    }

    while( this.lastWrite + this.connection.FRAME_LENGTH < Date.now() ) {
        if( this.frameQueue.length > 0 ) {

            // Deque the first sample from the queue.
            var frame = this.frameQueue.shift();

            try {

                // Process the sample to fit the Mumble expectations.
                if( this.bitDepth !== 16 || !this.signed )
                    frame = util.rescaleToUInt16LE( frame, this.bitDepth, !this.signed,
                        this.endianness === 'BE' );
                if( this.gain !== 1 )
                    frame = util.applyGain( frame, this.gain );
                if( this.channels > 1 )
                    frame = util.downmixChannels( frame, this.channels );
                if( this.sampleRate !== 48000 )
                    frame = util.resample( frame, this.sampleRate, 48000 );

                // Now the sample should be 48kHz 16-bit mono audio.
                // We can send it to Mumble.
                this.voiceSequence += this.connection.sendVoiceFrame(
                    frame, this.whisperId, this.voiceSequence );
                this.sent += frame.length / 2;

            } catch( error ) {

                this.emit( 'error', error );
                break;
            }

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
 * @private
 *
 * @param {Buffer} chunk - The chunk to be written
 * @param {string} encoding - Not used
 * @param {Function} done - Callback to signal writing the chunk is done.
 *
 * @returns {void}
 */
MumbleInputStream.prototype._write = function( chunk, encoding, done ) {

    while( true ) {

        // If we are at the buffer cap, wait until the buffer is emptied
        // before writing the rest.
        if( this.frameQueue.length >= this.LOCAL_BUFFER_SIZE ) {
            var self = this;
            this.processObserver.once( 'written', function() {
                self._write( chunk, encoding, done );
            } );
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
            this.lastFrame = this._createFrameBuffer();
            this.lastFrameWritten = 0;

        } else {

            // Frame not full. Advance the lastFrameWritten.
            this.lastFrameWritten = written;

        }

        // Check if the chunk was written in full or if some remains.
        if( chunk.length > ( written - writtenBefore ) ) {

            // Chunk was larger than remaining space in the last frame.
            chunk = chunk.slice( written - writtenBefore );

        } else {

            // Chunk was written completely.
            return done();

        }

    }
};

module.exports = MumbleInputStream;
