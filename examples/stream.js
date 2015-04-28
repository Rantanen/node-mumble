
var mumble = require('../');
var fs = require( 'fs' );

var unique = Date.now() % 10;

var input = fs.createReadStream( 'sin.pcm' );

mumble.connect( process.env.MUMBLE_URL, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate('stream-' + unique);
    connection.on( 'initialized', function() {
        input.pipe( connection.inputStream() );
    });
});



