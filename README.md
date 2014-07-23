
Mumble client for Node.js
=========================

This module implements mumble protocol handling for Node.js

    var mumble = require('mumble');
    var fs = require('fs');
    
    var options = {
        key: fs.readFileSync( 'private.pem' ),
        cert: fs.readFileSync( 'public.pem' )
    }
    
    console.log( 'Connecting' );
    mumble.connect( 'mumble://example.org', options, function ( error, connection ) {
        if( error ) { throw new Error( error ); }
    
        connection.authenticate( 'ExampleUser' );
        
        connection.on( 'initialized', function () {
            console.log('connection ready');
            //...
        });
    
        // Show all incoming events and the name of the event which is fired.
        /*
        connection.on( 'protocol-in', function (data) {
            var handlerName = data.type;
            handlerName = handlerName.replace(/^([A-Z][A-Z]*?)(?=([A-Z]?[a-z])|$)/g,
                function( match, $1 ) {
                    return $1.toLowerCase();
                });
            console.log('event', handlerName, 'data', data.message);
        });
        */
    
        // Collect user information
        var users = {};
        var sessions = {};
        connection.on( 'userState', function (state) {
            users[state.userId] = state;
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
    });
