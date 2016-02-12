"use strict";

var tls = require('tls');
var mumbleutil = require('./lib/util');

var MumbleConnection = require('./lib/MumbleConnection');
var MumbleClient = require('./lib/MumbleClient');
var MumbleConnectionManager = require('./lib/MumbleConnectionManager');

exports.MumbleConnection = MumbleConnection;
exports.MumbleConnectionManager = MumbleConnectionManager;

exports.celtVersions = mumbleutil.celtVersions;

/**
 * @summary Connect to the Mumble server.
 *
 * @description
 * The URL specifies the Mumble server address. It can be either host with
 * optional port specified with `host:port` or then the full `mumble://`.
 *
 * @param {String} url - Mumble server address.
 * @param {Object} [options] - TLS options.
 * @param {function(err,client)} done - Connection callback receiving {@link MumbleClient}.
 *
 * @returns {ConnectionManager} The manager used to establish the connection.
 */
exports.connect = function( url, options, done ) {

    // Handle optional options.
    if( typeof options === 'function' ) {
        done = options;
        options = {};
    }

    // Establish the conneciton.
    var manager = new MumbleConnectionManager( url, options );
    manager.connect( done );
    return manager;
};
