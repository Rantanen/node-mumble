
var mumble = require('../');

var unique = Date.now() % 10;

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('loopback-' + unique);
    connection.on( 'initialized', function() {
        connection.outputStream().pipe( connection.inputStream() );
    });
});



