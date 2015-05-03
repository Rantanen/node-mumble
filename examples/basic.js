"use strict";

var mumble = require('../');
var fs = require('fs');

var options = {
    key: fs.readFileSync( 'private.pem' ),
    cert: fs.readFileSync( 'public.pem' )
}

console.log( 'Connecting' );
mumble.connect( process.env.MUMBLE_URL, options, function ( error, connection ) {
    if( error ) { throw new Error( error ); }

    console.log( 'Connected' );

    connection.authenticate( 'ExampleUser' );
    connection.on( 'initialized', onInit );
    connection.on( 'voice', onVoice );
});

var onInit = function() {
    console.log( 'Connection initialized' );

    // Connection is authenticated and usable.
};

var onVoice = function( event ) {
    console.log( 'Mixed voice' );

    var pcmData = voice.data;
}
