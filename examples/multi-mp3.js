
"use strict";

// Usage:
// npm install lame
// node mp3.js < file.mp3

var lame = require( 'lame' );
var mumble = require( '../' );
var AudioMix = require( 'audio-mix' );
var fs = require( 'fs' );

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, client ) {
    if( error ) { throw new Error( error ); }

    client.authenticate('mp3-' + unique);
    client.on( 'initialized', function() {
        start( client );
    });
});

var start = function( client ) {

    var audioMix = new AudioMix();

    var first = play( 'mi.mp3', function( format ) {
        console.log( 'format' );

        format.gain = 0.25;
        var input = client.inputStream( format );
        audioMix.pipe( input );
    });

    var second = play( 'mi2.mp3' );

    first.pipe( audioMix.writeStream() );
    second.pipe( audioMix.writeStream() );
};

var play = function( file, format ) {
    var stream = fs.createReadStream( file );

    var decoder = new lame.Decoder();

    if( format )
        decoder.on( 'format', format );
    stream.pipe( decoder );
    return stream;
};
