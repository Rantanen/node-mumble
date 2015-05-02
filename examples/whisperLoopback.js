
"use strict";

var mumble = require('../');

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('loopback-' + unique);
    connection.on( 'initialized', function() {

        var users = connection.users();
        for( var u in users ) {
            var user = users[u];
            user.outputStream().pipe( user.inputStream() );
        }
    });
});



