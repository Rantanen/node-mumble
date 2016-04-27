
'use strict';

/**
 * @summary Converts a number to Mumble varint.
 *
 * @see {@link http://mumble-protocol.readthedocs.org/en/latest/voice_data.html#variable-length-integer-encoding}
 *
 * @param {number} i - Integer to convert
 * @returns {Buffer} Varint encoded number
 */
exports.toVarint = function( i ) {

    var arr = [];
    if( i < 0 ) {
        i = ~i;
        if( i <= 0x3 ) { return new Buffer( [ 0xFC | i ] ); }

        arr.push( 0xF8 );
    }

    if( i < 0x80 ) {
        arr.push( i );
    } else if( i < 0x4000 ) {
        arr.push( ( i >> 8 ) | 0x80 );
        arr.push( i & 0xFF );
    } else if( i < 0x200000 ) {
        arr.push( ( i >> 16 ) | 0xC0 );
        arr.push( ( i >> 8 ) & 0xFF );
        arr.push( i & 0xFF );
    } else if( i < 0x10000000 ) {
        arr.push( ( i >> 24 ) | 0xE0 );
        arr.push( ( i >> 16 ) & 0xFF );
        arr.push( ( i >> 8 ) & 0xFF );
        arr.push( i & 0xFF );
    } else if( i < 0x100000000 ) {
        arr.push( 0xF0 );
        arr.push( ( i >> 24 ) & 0xFF );
        arr.push( ( i >> 16 ) & 0xFF );
        arr.push( ( i >> 8 ) & 0xFF );
        arr.push( i & 0xFF );
    } else {
        throw new TypeError( 'Non-integer values are not supported. (' + i + ')' );
    }

    return {
        value: new Buffer( arr ),
        length: arr.length
    };
};

/**
 * @summary Converts a Mumble varint to an integer.
 *
 * @see {@link http://mumble-protocol.readthedocs.org/en/latest/voice_data.html#variable-length-integer-encoding}
 *
 * @param {Buffer} b - Varint to convert
 * @returns {number} Decoded integer
 */
exports.fromVarint = function( b ) {
    var length = 1;
    var i, v = b[ 0 ];
    if( ( v & 0x80 ) === 0x00 ) {
        i = ( v & 0x7F );
    } else if( ( v & 0xC0 ) === 0x80 ) {
        i = ( v & 0x3F ) << 8 | b[ 1 ];
        length = 2;
    } else if( ( v & 0xF0 ) === 0xF0 ) {
        switch( v & 0xFC ) {
        case 0xF0:
            i = b[ 1 ] << 24 | b[ 2 ] << 16 | b[ 3 ] << 8 | b[ 4 ];
            length = 5;
            break;
        case 0xF8:
            var ret = exports.fromVarint( b.slice( 1 ) );
            return {
                value: ~ret.value,
                length: 1 + ret.length
            };
        case 0xFC:
            i = v & 0x03;
            i = ~i;
            break;
        case 0xF4:
            throw new TypeError(
                '64-bit varints are not supported. (' + b.slice( 1, 6 ) + ')' );
        default:
            throw new TypeError( 'Unknown varint' );
        }
    } else if( ( v & 0xF0 ) === 0xE0 ) {
        i = ( v & 0x0F ) << 24 | b[ 1 ] << 16 | b[ 2 ] << 8 | b[ 3 ];
        length = 4;
    } else if( ( v & 0xE0 ) === 0xC0 ) {
        i = ( v & 0x1F ) << 16 | b[ 1 ] << 8 | b[ 2 ];
        length = 3;
    }

    return {
        value: i,
        length: length
    };
};

exports.parseUrl = function( url ) {

    var rv = {
        host: url,
        port: 64738,
        path: [],
        username: null,
        password: null
    };

    // Parse the URL
    var matches = /^mumble:\/\/([^\/]+)(\/[^?]*)?(\?[^#]*)?$/.exec( url );

    if( matches ) {

        // Read the matches.
        rv.host = matches[ 1 ];
        var path = matches[ 2 ];

        // var query = matches[3];  // not used

        // Split the path.
        rv.path = path ? path.split( '/' ) : [];

        // Filter empty string segments away.
        // Abuse the fact that empty strings are falsey.
        rv.path = rv.path.filter( function( str ) { return str; } );
    }

    var hostMatches = /^(.*@)?([^@:]+)(:(\d+))?$/.exec( rv.host );
    if( hostMatches ) {
        var userinfo = hostMatches[ 1 ];
        rv.host = hostMatches[ 2 ];
        rv.port = hostMatches[ 4 ] || rv.port;

        if( userinfo ) {
            var userMatches = /^([^:]*)(:(.*))?@$/.exec( userinfo );
            rv.username = userMatches[ 1 ] || null;
            rv.password = userMatches[ 3 ] || null;
        }
    }

    return rv;
};

if( process.env.MUMBLE_TRACE ) {
    exports.trace = function( msg ) { console.log( msg ); };
    exports.dir = function( data ) { console.dir( data ); };
    exports.warn = function( msg ) { console.log( 'WARNING: ' + msg ); };
} else {
    exports.trace = exports.dir = exports.warn = function() {};
}

exports.celtVersions = {
    v0_7_0: -2147483637, //  0x8000000b,
    v0_8_0: -2147483636, //  0x8000000b,
    v0_9_0: -2147483634, //  0x8000000b,
    v0_10_0: -2147483633, //  0x8000000b,
    v0_11_0: -2147483632 //  0x8000000b,
};

var permissions = {
    None: 0x00,
    Write: 0x01,
    Traverse: 0x02,
    Enter: 0x04,
    Speak: 0x08,
    MuteDeafen: 0x10,
    Move: 0x20,
    MakeChannel: 0x40,
    LinkChannel: 0x80,
    Whisper: 0x100,
    TextMessage: 0x200,
    MakeTempChannel: 0x400,

    // Root only
    Kick: 0x10000,
    Ban: 0x20000,
    Register: 0x40000,
    SelfRegister: 0x80000,

    Cached: 0x8000000,
    All: 0xf07ff
};

/**
 * @summary Read permission flags into an permission object.
 *
 * @param {number} permissionFlags - Permission bit flags
 * @returns {Object} Permission object with the bit flags decoded.
 */
exports.readPermissions = function( permissionFlags ) {
    var result = {};
    for( var p in permissions ) {
        var mask = permissions[ p ];

        // Ignore the 'None' field.
        if( !mask )
            continue;

        result[ p ] = ( permissionFlags & mask ) === mask;
    }

    return result;
};

/**
 * @summary Write permission flags into an permission object.
 *
 * @param {Object} permissionObject - Permissions object
 * @returns {number} Permission bit flags
 */
exports.writePermissions = function( permissionObject ) {
    var flags = {};
    for( var p in permissions ) {
        if( permissionObject[ p ] ) {
            flags |= permissions[ p ];
        }
    }
    return flags;
};

var eventRe = /([a-z])([A-Z])/;
exports.toEventName = function( field ) {
    return field.replace( eventRe, '$1-$2' ).toLowerCase();
};

exports.toFieldName = function( field ) {
    return field.replace( eventRe, '$1_$2' ).toLowerCase();
};


exports.findByValue = function( collection, field, value ) {

    // Check the collection for an item that has the value in the field.
    for( var key in collection ) {
        var item = collection[ key ];
        if( item[ field ] === value )
            return item;
    }

    // Not found. Return undefined.
};

exports.removeFrom = function( collection, item ) {
    var index = collection.indexOf( item );
    if( index !== -1 )
        collection.splice( index, 1 );
};

/**
 * Applies gain to the audio frame. Modifies the frame.
 *
 * @param {Buffer} frame - Audio frame with 16-bit samples.
 * @param {number} gain - Multiplier for each sample.
 *
 * @returns {Buffer} The audio frame passed in.
 */
exports.applyGain = function( frame, gain ) {
    for( var i = 0; i < frame.length; i += 2 ) {
        frame.writeInt16LE( Math.floor( frame.readInt16LE( i ) * gain ), i );
    }
    return frame;
};

/**
 * Downmixes multi-channel frame to mono.
 *
 * @param {Buffer} frame - Multi-channel audio frame.
 * @param {number} channels - Number of channels.
 *
 * @returns {Buffer} Downmixed audio frame.
 */
exports.downmixChannels = function( frame, channels ) {
    var monoFrame = new Buffer( frame.length / 2 );
    var writeOffset = 0;

    for( var i = 0; i < frame.length; ) {
        var sample = 0;
        for( var c = 0; c < channels; c++, i += 2 ) {
            sample += frame.readInt16LE( i );
        }

        // Clamp the sample to the limits.
        if( sample < -( 1 << 15 ) )
            sample = -( 1 << 15 );
        else if( sample > ( 1 << 15 ) - 1 )
            sample = ( 1 << 15 ) - 1;

        monoFrame.writeInt16LE( sample, writeOffset );
        writeOffset += 2;
    }

    return monoFrame;
};

/**
 * @summary Resamples the frame.
 *
 * @description
 * The resampling is done by duplicating samples every now and then so it's not
 * the best quality. Also the source/target rate conversion must result in a
 * whole number of samples for the frame size.
 *
 * @param {Buffer} frame - Original frame
 * @param {number} sourceRate - Original sample rate
 * @param {number} targetRate - Target sample rate
 *
 * @returns {Buffer} New resampled buffer.
 */
exports.resample = function( frame, sourceRate, targetRate ) {

    var targetFrame = new Buffer( frame.length * targetRate / sourceRate );

    for( var t = 0; t < targetFrame.length / 2; t++ ) {

        var targetDuration = t / targetRate;
        var sourceDuration = Math.floor( targetDuration * sourceRate );
        var sourceIndex = sourceDuration * 2;
        targetFrame.writeInt16LE( frame.readInt16LE( sourceIndex ), t * 2 );
    }

    return targetFrame;
};

/**
 * @summary Rescales the frame.
 *
 * @description
 * Assuming both source and target Bit depth are multiples of eight, this
 * function rescales the frame. E.g. it can be used to make a 16 Bit audio
 * frame of an 8 Bit audio frame.
 *
 * @param {Buffer} frame - Original frame
 * @param {number} sourceDepth - Original Bit depth
 * @param {Boolean} sourceUnsigned - whether the source values are unsigned
 * @param {Boolean} sourceBE - whether the source values are big endian
 *
 * @returns {Buffer} Rescaled buffer.
 */
exports.rescaleToUInt16LE = function( frame, sourceDepth, sourceUnsigned, sourceBE ) {

    if( sourceDepth === 16 && !sourceUnsigned && !sourceBE ) {
        return frame;
    }

    if( sourceDepth !== 8 && sourceDepth !== 16 && sourceDepth !== 32 ) {
        throw new Error( 'unsupported source depth ' + sourceDepth );
    }

    var targetFrame = new Buffer( frame.length * 16 / sourceDepth );

    var readFunc =
        frame[
            'read' +
            ( sourceUnsigned ? 'U' : '' ) +
            'Int' +
            sourceDepth +
            ( sourceDepth !== 8 ? ( sourceBE ? 'BE' : 'LE' ) : '' )
        ].bind( frame );

    var srcSize = Math.pow( 2, sourceDepth ) - 1;
    var srcOffset = sourceUnsigned ? 0 : ( srcSize + 1 ) / -2;

    var tgtSize = sourceUnsigned ? 32767 : 65535;
    var tgtOffset = sourceUnsigned ? 0 : ( tgtSize + 1 ) / -2;

    var factor = tgtSize / srcSize;

    var siStep = sourceDepth / 8;
    for( var si = 0, ti = 0; si < frame.length; si += siStep, ti += 2 ) {
        targetFrame.writeInt16LE(
            Math.round( tgtOffset + ( readFunc( si ) - srcOffset ) * factor ),
             ti );
    }

    return targetFrame;
};

// Gather all versions and fix the values at the same time.
var allVersions = [];
for( var i in exports.celtVersions ) {
    allVersions.push( exports.celtVersions[ i ] );
}
exports.celtVersions.all = allVersions;
exports.celtVersions.default = [
    exports.celtVersions.v0_7_0,
    // We don't have 0.11.0 encoder so it would be stupid to advertise it.
    // exports.celtVersions.v0_11_0,
];
