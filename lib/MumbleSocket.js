
"use strict";

var MumbleSocket = function (socket) {
    var self = this;
    this.buffers = [];
    this.readers = [];
    this.length = 0;
    this.socket = socket;

    socket.on('data', function (data) {
        self.receiveData(data);
    });
};


MumbleSocket.prototype.receiveData = function (data) {
    this.buffers.push(data);
    this.length += data.length;
    this._checkReader();
};

MumbleSocket.prototype.read = function (length, callback) {
    this.readers.push({ length: length, callback: callback });
    if (this.readers.length === 1) { this._checkReader(); }
};

MumbleSocket.prototype.write = function (buffer) {
    this.socket.write(buffer);
};

MumbleSocket.prototype.end = function () {
    this.socket.end();
};

MumbleSocket.prototype._checkReader = function () {
    if (this.readers.length === 0) { return; }

    var reader = this.readers[0];
    var expectedLength = reader.length;

    if (this.length < reader.length) { return; }

    var buffer = new Buffer(reader.length);
    var written = 0;

    while (written < reader.length) {
        var received = this.buffers[0];

        var remaining = reader.length - written;
        if (received.length <=  remaining) {
            received.copy(buffer, written);
            written += received.length;

            // We wrote the whole buffer. Remove it from the socket.
            this.buffers.splice(0, 1);
            this.length -= received.length;
        } else {
            received.copy(buffer, written, 0, remaining);
            written += remaining;

            this.buffers[0] = received.slice(remaining);
            this.length -= remaining;
        }
    }

    this.readers.splice(0, 1);
    reader.callback(buffer);
};

module.exports = MumbleSocket;
