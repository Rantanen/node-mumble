
"use strict";

var tls = require('tls');
var mumbleutil = require('./lib/util');

var MumbleConnection = require('./lib/MumbleConnection');

exports.MumbleConnection = MumbleConnection;

exports.connect = function( url, options, done ) {

    if( typeof options === 'function' ) {
        done = options;
        options = {};
    }

    var server = mumbleutil.parseUrl( url );

    options = options || {};

    // If the options.rejectUnauthorized isn't defined default it to false.
    // We'll do this since most Mumble server certs are self signed anyway.
    //
    // The if catches null, false and other falsy values as well,
    // but this doesn't affect anything as we set it to false anyway.
    if( !options.rejectUnauthorized ) {
        options.rejectUnauthorized = false;
    }

    var socket = tls.connect( server.port, server.host, options, function ( err ) {

        // TODO Remove the certificate buffers from the options.
        // MumbleConnection doesn't need to hold onto them.
        var connection = new MumbleConnection( socket, options );

        done( null, connection );
        if( !connection.authSent && server.username ) {
            connection.authenticate( server.username );
        }

        // If path was given, wait for init to be done before moving.
        if( server.path ) {
            connection.once('initialized', function () {
                setTimeout( function () {
                    console.log( "Init done. Joining path\n\n");
                    connection.joinPath( server.path );
                }, 1000 );
            });
        }
    });

    socket.on('error', done);
}

exports.celtVersions = mumbleutil.celtVersions;
