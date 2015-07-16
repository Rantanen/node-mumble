
Mumble client for Node.js
=========================
[![Build Status](https://travis-ci.org/Rantanen/node-mumble.svg?branch=master)](https://travis-ci.org/Rantanen/node-mumble)
[![Code Climate](https://codeclimate.com/github/Rantanen/node-mumble/badges/gpa.svg)](https://codeclimate.com/github/Rantanen/node-mumble)

This module implements mumble protocol handling for Node.js

Installation
------------

`npm install mumble`

Example
-------

    var mumble = require('mumble');
    var fs = require('fs');

    var options = {
        key: fs.readFileSync( 'private.pem' ),
        cert: fs.readFileSync( 'public.pem' )
    }

    console.log( 'Connecting' );
    mumble.connect( 'mumble://example.org', options, function ( error, connection ) {
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

Take a look at the advanced example in "examples/advanced.js"!

Please also take a look at the [wiki](https://github.com/Rantanen/node-mumble/wiki/API) for an complete documentation of the API.

Contributing
------------

Pull requests, found issues, etc. are welcome. The authors are tracked in the
AUTHORS file. This file is kept up to date manually so authors are encouraged
to pull request the necessary changes to the AUTHORS themselves.
