
"use strict";

var tls = require('tls');
var mumbleutil = require('./util');

var MumbleConnection = require('./MumbleConnection');
var MumbleClient = require('./MumbleClient');

/**
 * @summary Mumble connection manager
 *
 * @description
 * A connection tool to decouple connecting to the server
 * from the module itself.
 *
 * The URL specified to the connection manager the Mumble server address.
 * It can be either host with optional port specified with `host:port`
 * or then the full `mumble://`.
 *
 * @constructor
 * @param {String} url - Mumble server address.
 * @param {Object} options - TLS options.
 */
function MumbleConnectionManager( url, options ) {
  this.server = mumbleutil.parseUrl( url );

  this.options = options || {};

  // If the options.rejectUnauthorized isn't defined default it to false.
  // We'll do this since most Mumble server certs are self signed anyway.
  //
  // The if catches null, false and other falsy values as well,
  // but this doesn't affect anything as we set it to false anyway.
  if( !this.options.rejectUnauthorized ) {
      this.options.rejectUnauthorized = false;
  }
}

/**
 * @summary Connect to the Mumble server.
 *
 * @description
 * Connects to the Mumble server provided in the constructor
 *
 * @param {function(err,client)} done
 *      Connection callback receiving {@link MumbleClient}.
 */
MumbleConnectionManager.prototype.connect = function connect( done ) {
    var self = this;

    self.socket = tls.connect( self.server.port, self.server.host, self.options,
        function ( err ) {
            if( self.options.key !== undefined ) {
                delete self.options.key;
            }
            if( self.options.cert !== undefined ) {
                delete self.options.cert;
            }
            var connection = new MumbleConnection( self.socket, self.options );

            done( null, new MumbleClient( connection ) );
            if( !connection.authSent && self.server.username ) {
                connection.authenticate( self.server.username );
            }

            // If path was given, wait for init to be done before moving.
            if( self.server.path.length ) {
                connection.once( 'initialized', function () {
                    connection.joinPath( self.server.path );
                });
            }

            // The connection will now own listening for socket errors.
            self.socket.removeListener( 'error', done );
        });

    self.socket.once( 'error', done );
};

module.exports = MumbleConnectionManager;
