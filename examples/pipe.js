
"use strict";

var mumble = require('../');

var unique = Date.now() % 10;
var input;
var output;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('input-' + unique);
    connection.on( 'initialized', function() {
        input = connection;
        tryStart();
    });
});

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('output-' + unique);
    connection.on( 'initialized', function() {
        output = connection;
        tryStart();
    });
});

var tryStart = function () {
    if( !input || !output ) return;

    input.outputStream().pipe( output.inputStream() );
};


