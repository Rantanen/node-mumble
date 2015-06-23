
"use strict";

var fs = require( 'fs' );
var mumble = require('../');

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('record-' + unique);
    connection.on( 'initialized', function() {
        var user = connection.userByName( 'Wace' );
        console.log( user.session );
        var stream = user.outputStream();
        stream.pipe( process.stdout );
    });
});



