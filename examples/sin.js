
"use strict";

var mumble = require('../');

var unique = Date.now() % 10;
var freq = (1*process.env.FREQ) || 200;
var stream;

var phase = 0;
var generateSound = function() {
    var b = new Buffer(480*2);
    for( var i = 0; i < 480; i++ ) {
        var sample = Math.round( Math.sin( Math.PI*2*(phase+i)*freq/48000 ) * (1<<12) );
        b.writeInt16LE( sample, i*2 );
    }
    phase += 480;
    return b;
};

var writeSound = function() {
    // Fill the buffer
    while( stream.write( generateSound() ) ) {}

    // Wait for the buffer to drain
    stream.once( 'drain', writeSound );
};

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('sin-' + unique);
    connection.on( 'initialized', function() {
        stream = connection.inputStream();
        writeSound();
    });
});



