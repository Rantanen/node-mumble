
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

```javascript
var mumble = require('mumble'),
    fs = require('fs');

var options = {
    key: fs.readFileSync( 'key.pem' ),
    cert: fs.readFileSync( 'cert.pem' )
};

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

var onVoice = function( voice ) {
    console.log( 'Mixed voice' );

    var pcmData = voice;
};
```

Use `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem` to generate the certificate.

Take a look at the advanced example in "examples/advanced.js"!

Please also take a look at the [wiki](https://github.com/Rantanen/node-mumble/wiki/API) for an complete documentation of the API.

Contributing
------------

Pull requests, found issues, etc. are welcome. The authors are tracked in the
AUTHORS file. This file is kept up to date manually so authors are encouraged
to pull request the necessary changes to the AUTHORS themselves.

### Running tests

Tests can be executed with `mocha`. By default the tests are executed against
local (localhost) Mumble server in the default port. To use a remote server
or non-default port, launch `mocha` with `MUMBLE_URL` environment variable set:

```
MUMBLE_URL=my.mumble.server.com mocha
```

Related Projects
----------------
- [node-mumble-audio](https://github.com/EvolveLabs/node-mumble-audio) Add local capture and playback to node-mumble.
