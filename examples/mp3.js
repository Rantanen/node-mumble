
"use strict";

// Usage:
// npm install lame
// node mp3.js < file.mp3

var lame = require( 'lame' );
var mumble = require( '../' );

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, client ) {
    if( error ) { throw new Error( error ); }

    client.authenticate('mp3-' + unique);
    client.on( 'initialized', function() {
        start( client );
    });
});

var start = function( client ) {

    var input = client.inputStream();
    var decoder = new lame.Decoder();

    var stream;
    decoder.on( 'format', function( format ) {
        console.log( format );

        stream.pipe( client.inputStream({
            channels: format.channels,
            sampleRate: format.sampleRate,
            gain: 0.25
        }));
    });

    stream = process.stdin.pipe( decoder );
};


