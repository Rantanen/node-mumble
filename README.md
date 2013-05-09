
Mumble client for Node.js
=========================

This module implements mumble protocol handling for Node.js

    var mumble = require('mumble');

    var tlsOptions = {
        // Client certificates unless server doesn't require them. (Most do!)
    }

    console.log( 'Connecting' );
    mumble.connect( 'mumble.example.org', 64738, tlsOptions, function ( error, connection ) {
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
        console.log( 'Incoming voice data' );

        var sender = voice.sender;
        var pcmData = voice.data;
    }

