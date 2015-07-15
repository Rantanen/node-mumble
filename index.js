
"use strict";

var tls = require('tls');
var mumbleutil = require('./lib/util');

var MumbleConnection = require('./lib/MumbleConnection');
var MumbleClient = require('./lib/MumbleClient');

exports.MumbleConnection = MumbleConnection;

/**
 * @summary Connect to the Mumble server.
 *
 * @description
 * The URL specifies the Mumble server address. It can be either host with
 * optional port specified with `host:port` or then the full `mumble://`.
 *
 * @param {String} url - Mumble server address.
 * @param {Object} options - TLS options.
 * @param {function(err,client)} done - Connection callback receiving {@link MumbleClient}.
 */
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
        if(options.key !== undefined) {
            delete options.key;
        }
        if(options.cert !== undefined) {
            delete options.cert;
        }
        var connection = new MumbleConnection( socket, options );

        done( null, new MumbleClient(connection) );
        if( !connection.authSent && server.username ) {
            connection.authenticate( server.username );
        }

        // If path was given, wait for init to be done before moving.
        if( server.path.length ) {
            connection.once('initialized', function () {
                connection.joinPath( server.path );
            });
        }
    });

    socket.on('error', done);
};

exports.celtVersions = mumbleutil.celtVersions;
