
"use strict";

var ReadableStream = require('stream').Readable;

/**
 * Mumble output stream
 *
 * @constructor
 * @this {MumbleOutputStream}
 * @param {MumbleConnection} connection Mumble connection to read from
 */
var MumbleOutputStream = function(connection, options) {
    var self = this;
    this.connection = connection;
    this.users = {};

    this.lastRead = Date.now();

    this.voiceListener = function( evt ) {
        self._addAudioFrame( evt.session, evt.sequence, evt.data );
    };
    connection.on( 'voice', this.voiceListener );

    // Call the Readable constructor
    ReadableStream.call(this, options);
};
MumbleOutputStream.prototype = Object.create( ReadableStream.prototype );

/**
 * Closes the stream
 */
MumbleOutputStream.prototype.close = function () {
    this.connection.removeListener( 'voice', this.voiceListener );
}

/**
 * Adds audio frames to the buffer
 *
 * This method is used internally
 *
 * @param {Number} session User session ID
 * @param {Number} sequence Frame sequence number
 * @param {Buffer} audioFrame Frame voice data buffer
 */
MumbleOutputStream.prototype._addAudioFrame = function( session, sequence, audioFrame ) {

    // Make sure the user exists.
    var user = this.users[ session ];
    if( !user ) { user = this.users[ session ] = { session: session, frames: [] } }

    // Append the audio frame to the current user frames.
    user.frames.push( audioFrame );
};

/**
 * ReadableStream _read implementation
 *
 * This method is called by the ReadableStream when it requests more data.
 *
 * @param {Number} size Number of bytes to read
 */
MumbleOutputStream.prototype._read = function( size ) {

    // Calculate the amount of frames to read based on time.
    var interval = Date.now() - this.lastRead;
    var frameCount = Math.floor( interval / this.connection.FRAME_LENGTH );

    // If _read was called before enough time has passed, delay the execution by frame length.
    if( frameCount <= 0 ) {
        var self = this;
        setTimeout( function() { self._read( size ); }, this.connection.FRAME_LENGTH );
    }

    // Write the frames one by one.
    for( var f = 0; f < frameCount; f++ ) {

        // Grab a frame from each user.
        var userFrames = [];
        var userCount = 0;
        for( var i in this.users ) {
            userCount++;
            var user = this.users[i];
            if( user.frames.length > 0 ) {
                userFrames.push( user.frames[0] );
                user.frames.splice( 0, 1 );
            }
        }

        // Get the mixed buffer.
        var mixedBuffer;
        console.log( 'Mixing buffers from %d users', userFrames.length );
        if( userFrames.length === 0 ) {

            // If we got no frames, return a zeroed buffer.
            mixedBuffer = new Buffer( this.connection.FRAME_SIZE * 2 );
            mixedBuffer.fill(0);

        } else if( userFrames.length === -1 ) {

            // If we got only one frame, return that frame as it is.
            mixedBuffer = userFrames[0];

        } else {

            // We got more than one frame. Mix these together.
            mixedBuffer = new Buffer( this.connection.FRAME_SIZE * 2 );

            for( var i = 0; i < this.connection.FRAME_SIZE; i++ ) {
                var sum = 0;
                for( var u in userFrames ) { sum += userFrames[u].readInt16LE( i*2 ); }

                if( sum > 1 << 14 ) { sum = 1 << 14; }
                if( -sum > 1 << 14 ) { sum = -(1 << 14); }
                try {
                    mixedBuffer.writeInt16LE( sum, i*2 );
                } catch(e) {
                    console.log( sum );
                    throw e;
                }
            }
        }

        // Push the mixed buffer into the stream.
        var cont = this.push( mixedBuffer );
        this.lastRead += this.connection.FRAME_LENGTH;
        if( !cont ) { return; }
    }

};

module.exports = MumbleOutputStream;
