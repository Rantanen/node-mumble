
"use strict";

var tls = require('tls');

var MumbleConnection = require('./lib/MumbleConnection')

exports.MumbleConnection = MumbleConnection;

var parseArgs = function( args, specs ) {

    // Output arguments
    var out = {};
    var position = 1;
    var current = 0;

    for( var a in specs ) {
        var spec = specs[a];
        console.dir( out );
        console.dir( spec );

        // Read the required type.
        var requiredType = spec.type || typeof spec.default;

        // If there is no requirement on type use the first argument.
        if( !requiredType ) {
            out[ spec.name ] = args[ current ];
            current++;
        } else {

            // We require a specific type. Make sure the argument matches.
            var requiredTypes = requiredType.split('|');
            var argType = typeof args[ current ];
            var found = false;

            for( var r in requiredTypes ) {
                var candidate = requiredTypes[r];
                console.log( 'type: ' + argType + ' vs candidate: ' + candidate );
                if( argType === candidate ) {
                    out[ spec.name ] = args[ current ];
                    current++;
                    found = true;
                    break;
                }
            }

            // We didn't find a candidate.
            if( !found ) {
                if( spec.default ) {
                    out[ spec.name ] = spec.default;
                } else {
                    throw new TypeError( 'Required argument {' + spec.type + '} ' + spec.name + ' missing at position ' + position );
                }
            }
        }

        // We read an argument successfully.
        position++;
    }

    return out;
}

exports.connect = function( host, port, tlsoptions, done ) {

    var args = parseArgs( arguments, [
        { name: 'host', default: 'localhost' },
        { name: 'port', default: 64738, type: 'string|number' },
        { name: 'tlsoptions', default: {} },
        { name: 'done', type: 'function' }
    ]);

    host = args.host;
    port = args.port;
    tlsoptions = args.tlsoptions;
    done = args.done;

    console.log( host );
    console.log( port );
    console.log( tlsoptions );
    console.log( done );

    var args = [ host, port, tlsoptions, done ];
    if( typeof args[0] !== 'string' ) {
        host = 'localhost';
    }

    // If port wasn't given, use the default one.
    if( !port ) { port = 64738; }

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

