
"use strict";

var mumble = require('../');

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.on( 'voice-frame', function( frames ) {

        connection.authenticate( 'spy' );
        for( var f in frames ) {
            console.log( frames[ f ].user ? frames[ f ].user.name : '<no-user>' );
        }
    });
});



