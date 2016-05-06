"use strict";

var mumble = require('../');
var fs = require('fs');

var options = {
    //key: fs.readFileSync( 'private.pem' ),
    //cert: fs.readFileSync( 'public.pem' )
}

console.log( 'Connecting' );
mumble.connect( process.env.MUMBLE_URL, options, function ( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate( 'AdvancedUser' );

    connection.on( 'initialized', function () {
        console.log('connection ready');
        //...
    });

    // Show all incoming events and the name of the event which is fired.
    connection.on( 'protocol-in', function (data) {
        console.log('event', data.handler, 'data', data.message);
    });

    // Collect user information
    var sessions = {};
    connection.on( 'userState', function (state) {
        sessions[state.session] = state;
    });

    // Collect channel information
    var channels = {};
    connection.on( 'channelState', function (state) {
        channels[state.channelId] = state;
    });

    // On text message...
    connection.on( 'textMessage', function (data) {
        var user = sessions[data.actor];
        console.log(user.name + ':', data.message);
    });

    connection.on( 'voice', function (event) {
        console.log( 'Mixed voice' );
        var pcmData = event.data;
    });

    connection.on( 'userState', function( state ) {
        console.log( state );
        console.log( connection.userBySession( state.session ) );
    });
});
