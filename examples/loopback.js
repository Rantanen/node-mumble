
var mumble = require('../');

var unique = Date.now() % 10;
var input;
var output;

mumble.connect( process.env.MUMBLE_ADDR, function( error, connection ) {
    connection.authenticate('input-' + unique);
    connection.on( 'initialized', function() {
        input = connection;
        tryStart();
    });
});

mumble.connect( process.env.MUMBLE_ADDR, function( error, connection ) {
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


