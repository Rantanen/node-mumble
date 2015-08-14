
"use strict";

var mumble = require( '../' );
var i = 0;

exports.twoConnections = function( done, cb ) {
    var myDone = function() {
        if( conn1 ) conn1.disconnect();
        if( conn2 ) conn2.disconnect();
        done();
    };

    var conn1, conn2;
    mumble.connect( process.env.MUMBLE_URL, function( error, conn ) {
        if( error ) cb( error, null, null, myDone );
        conn.authenticate( 'TestSender' + ( i++ ) );
        conn.on( 'initialized', init.bind( null, conn, null ) );
    });
    mumble.connect( process.env.MUMBLE_URL, function( error, conn ) {
        if( error ) cb( error, null, null, myDone );
        conn.authenticate( 'TestReceiver' + ( i++ ) );
        conn.on( 'initialized', init.bind( null, null, conn ) );
    });

    var init = function( c1, c2 ) {
        conn1 = conn1 || c1;
        conn2 = conn2 || c2;
        if( !conn1 || !conn2 ) return;

        // The server is still initializing the connection, etc.
        // Wait a bit before invoking the callback to normalize the situation.
        setTimeout( cb.bind( null, null, conn1, conn2, myDone ), 500 );
    };
};

exports.levelBuffer = function( samples, level ) {
    var b = new Buffer( samples * 2 );
    for( var i = 0; i < b.length / 2; i++ ) {
        b.writeInt16LE( level, i*2 );
    }

    return b;
};

exports.printFrame = function( frame ) {
    var c = 0;
    var sum = 0;
    for( var i = 0; i < frame.length / 2; i++ ) {
        var v = frame.readInt16LE( i*2 );
        sum += v;
        c++;
        if( c === 50 ) {
            v = sum / 50;
            v /= 16;
            var str = '';
            for( var u = -32; u < v; u++ )
                str += ' ';
            console.log( str + '#' );
            sum = 0;
            c = 0;
        }
    }
};
