
'use strict';

/**
 * Mumble network protocol wrapper for an SSL socket
 *
 * @private
 *
 * @constructor
 * @this {MumbleSocket}
 * @param {Socket} socket
 *     SSL socket to be wrapped.
 *     The socket must be connected to the Mumble server.
 */
var MumbleSocket = function( socket ) {
    var self = this;
    this.buffers = [];
    this.readers = [];
    this.length = 0;
    this.socket = socket;

    // Register the data callback to receive data from Mumble server.
    socket.on( 'data', function( data ) {
        self.receiveData( data );
    } );
};


/**
 * Handle incoming data from the socket
 *
 * @param {Buffer} data Incoming data buffer
 */
MumbleSocket.prototype.receiveData = function( data ) {

    // Insert the data into the buffer queue.
    this.buffers.push( data );
    this.length += data.length;

    // Check buffer status to see if we got enough data for the next reader.
    this._checkReader();
};

/**
 * Queue a reader callback for incoming data.
 *
 * @param {number} length The amount of data this callback expects
 * @param {function} callback The data callback
 */
MumbleSocket.prototype.read = function( length, callback ) {

    // Push the reader to the queue
    this.readers.push( { length: length, callback: callback } );

    // If the reader queue was empty there's a chance there is pending
    // data so check the buffer state.
    if( this.readers.length === 1 ) { this._checkReader(); }
};

/**
 * Write message into the socket
 *
 * @param {Buffer} buffer Message to write
 */
MumbleSocket.prototype.write = function( buffer ) {
    // Just in case the function is call when we are disconnecting, we need to check if the socket is still writable
    if(this.socket.writable) {
        this.socket.write( buffer );
    }
};

/**
 * Close the socket
 */
MumbleSocket.prototype.end = function() {
    this.socket.end();
};

/**
 * Check whether there's enough data to satisfy the current reader callback
 *
 * @private
 */
MumbleSocket.prototype._checkReader = function() {

    // If there are no readers we'll wait for more.
    if( this.readers.length === 0 ) { return; }

    // If there's less data than the foremost reader requires, wait for more.
    var reader = this.readers[ 0 ];
    if( this.length < reader.length ) { return; }

    // Allocate the buffer for the reader.
    var buffer = new Buffer( reader.length );
    var written = 0;

    // Gather the buffer contents from the queued data fragments.
    while( written < reader.length ) {

        // Take the first unprocessed fragment.
        var received = this.buffers[ 0 ];

        // Calculate the amount of data missing from the reader buffer.
        var remaining = reader.length - written;
        if( received.length <= remaining ) {

            // Write the current fragment in whole to the output buffer if
            // it is smaller than or equal in size to the data we require.
            received.copy( buffer, written );
            written += received.length;

            // We wrote the whole buffer. Remove it from the socket.
            this.buffers.splice( 0, 1 );
            this.length -= received.length;
        } else {

            // The current fragment is larger than what the reader requires.
            // Write only part of it to the buffer.
            received.copy( buffer, written, 0, remaining );
            written += remaining;

            // Slice the written part off the fragment.
            this.buffers[ 0 ] = received.slice( remaining );
            this.length -= remaining;
        }
    }

    // Remove the current reader and perform the callback.
    this.readers.splice( 0, 1 );
    reader.callback( buffer );

    // TODO: Should we recurse into _checkReader in case there's a second
    // reader queued and we still got enough data for it?
    // Probably not. Queueing multiple readers is bad anyway.
};

module.exports = MumbleSocket;
