
"use strict";

var tls = require('tls');

var MumbleConnection = require('./lib/MumbleConnection')

exports.MumbleConnection = MumbleConnection;

exports.connect = function( host, port, tlsoptions, done ) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    var socket = tls.connect( port, host, tlsoptions, function () {
        var connection = new MumbleConnection( socket );
        connection.initialize();

        done( null, connection );
    });
}

