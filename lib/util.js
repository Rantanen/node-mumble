
"use strict";

/**
 * Converts a number to Mumble varint
 *
 * @param {Number} Integer to convert
 * @return {Buffer} Varint encoded number
 */
exports.toVarint = function( i ) {
    var absValue = Math.abs( i );

    var arr = [];
    if( i < 0 ) {
        i = ~i;
        if( i <= 0x3 ) { return new Buffer([ 0xFC | i ]); }

        arr.push( 0xF8 );
    }

    if( i < 0x80 ) {
        arr.push( i );
    } else if ( i < 0x4000 ) {
        arr.push(( i >> 8 ) | 0x80 );
        arr.push(i & 0xFF );
    } else if ( i < 0x200000 ) {
        arr.push((i >> 16) | 0xC0);
        arr.push((i >> 8) & 0xFF);
        arr.push(i & 0xFF);
    } else if ( i < 0x10000000 ) {
        arr.push((i >> 24) | 0xE0);
        arr.push((i >> 16) & 0xFF);
        arr.push((i >> 8) & 0xFF);
        arr.push(i & 0xFF);
    } else if ( i < 0x100000000 ) {
        arr.push(0xF0);
        arr.push((i >> 24) & 0xFF);
        arr.push((i >> 16) & 0xFF);
        arr.push((i >> 8) & 0xFF);
        arr.push(i & 0xFF);
    } else {
        throw new TypeError( "Non-integer values are not supported. (" + i + ")" );
    }

    return {
        value: new Buffer( arr ),
        length: arr.length
    };
};

/**
 * Converts a Mumble varint to an integer
 *
 * @param {Buffer} Varint to convert
 * @return {Number} Decoded integer
 */
exports.fromVarint = function( b ) {
    var length = 1;
    var v = b[0];
    if(( v & 0x80) === 0x00) {
        i = (v & 0x7F);
    } else if ((v & 0xC0) === 0x80) {
        i = (v & 0x3F) << 8 | b[1];
        length = 2;
    } else if ((v & 0xF0) === 0xF0) {
        switch (v & 0xFC) {
            case 0xF0:
                i = b[1] << 24 | b[2] << 16 | b[3] << 8 | b[4];
                length = 5;
                break;
            case 0xF8:
                ret = exports.fromVarint( b.slice(1) );
                return {
                    value: ~ret.value,
                    length: 1+ret.length
                }
            case 0xFC:
                i = v & 0x03;
                i = ~i;
                break;
            case 0xF4:
                throw new TypeError( "64-bit varints are not supported. (" + b.slice( 1, 6 ) + ")" );
            default:
                throw new TypeError( "Unknown varint" );
        }
    } else if ((v & 0xF0) === 0xE0) {
        i = (v & 0x0F) << 24 | b[1] << 16 | b[2] << 8 | b[3];
        length = 4;
    } else if ((v & 0xE0) === 0xC0) {
        i = (v & 0x1F) << 16 | b[1] << 8 | b[2];
        length = 3;
    }

    return {
        value: i,
        length: length
    };
}

exports.parseUrl = function( url ) {

    var rv = {
        host : url,
        port : 64738,
        path : [],
        username: null,
        password: null
    }

    // Parse the URL
    var matches = /^mumble:\/\/([^\/]+)(\/[^?]*)?(\?[^#]*)?$/.exec( url );

    if( matches ) {

        // Read the matches.
        rv.host = matches[1];
        var path = matches[2];

        // var query = matches[3];  // not used

        // Split the path.
        rv.path = path ? path.split('/') : [];

        // Filter empty string segments away.
        // Abuse the fact that empty strings are falsey.
        rv.path = rv.path.filter( function( str ) { return str; } );
    }

    var hostMatches = /^(.*@)?([^@:]+)(:(\d+))?$/.exec( rv.host );
    if( hostMatches ) {
        var userinfo = hostMatches[1];
        rv.host = hostMatches[2];
        rv.port = hostMatches[4] || rv.port;

        if( userinfo ) {
            var userMatches = /^([^:]*)(:(.*))?@$/.exec( userinfo );
            rv.username = userMatches[1] || null;
            rv.password = userMatches[3] || null;
        }
    }

    return rv;
}

if( process.env.MUMBLE_TRACE ) {
    exports.trace = function( msg ) { console.log( msg ); };
    exports.dir = function( data ) { console.dir( data ); };
    exports.warn = function( msg ) { console.log( "WARNING: " + msg ); };
} else {
    exports.trace = exports.dir = exports.warn = function() {};
}

exports.celtVersions = {
    v0_7_0: -2147483637, //  0x8000000b,
    v0_8_0: -2147483636, //  0x8000000b,
    v0_9_0: -2147483634, //  0x8000000b,
    v0_10_0: -2147483633, //  0x8000000b,
    v0_11_0: -2147483632 //  0x8000000b,
}

// Gather all versions and fix the values at the same time.
var allVersions = [];
for( var i in exports.celtVersions ) {
    allVersions.push( exports.celtVersions[i] );
}
exports.celtVersions.all = allVersions;
exports.celtVersions.default = [
    exports.celtVersions.v0_7_0, 
    // We don't have 0.11.0 encoder so it would be stupid to advertise it.
    // exports.celtVersions.v0_11_0,
]
    
