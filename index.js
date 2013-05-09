
"use strict";

var tls = require('tls');

var MumbleConnection = require('./lib/MumbleConnection')

exports.MumbleConnection = MumbleConnection;

exports.connect = function( host, port, tlsoptions, done ) {

    tlsoptions = tlsoptions || {};

    // If the tlsoptions.rejectUnauthorized isn't defined default it to false.
    // We'll do this since most Mumble server certs are self signed anyway.
    //
    // The if catches null, false and other falsy values as well,
    // but this doesn't affect anything as we set it to false anyway.
    if( !tlsoptions.rejectUnauthorized ) {
        tlsoptions.rejectUnauthorized = false;
    }

    var socket = tls.connect( port, host, tlsoptions, function () {
        var connection = new MumbleConnection( socket );
        done( null, connection );
    });
}

