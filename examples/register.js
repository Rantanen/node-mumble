"use strict";

var mumble = require('../');
var fs = require('fs');

mumble.connect( process.env.MUMBLE_URL, {}, function( error, connection ) {
    if( error ) { throw new Error( error ); }

    connection.authenticate( 'SuperUser', 'admin' );
    connection.on( 'initialized', function () {
        connection.getRegisteredUsers();
        var unregisteredUsers = connection.users()
            .filter( function( user ) {
                if( user.name === 'SuperUser' ) { return false; }
                if( user.isRegistered() ) {
                    console.log(
                        user.name + ' is already registered and has id ' + user.id
                    );
                    return false;
                }
                return true;
            } );
        unregisteredUsers.forEach( function( user ) {
            console.log( 'Registering previously unregistered user ' + user.name );
            user.register();
        } );
        var updatedUserCount = 0;
        connection.users().forEach ( function( user ) {
            user.on( 'id', function( id ) {
                console.log( 'User ' + user.name + ' has new id ' + id );
                updatedUserCount++;
                if( updatedUserCount === unregisteredUsers.length ) {
                    connection.disconnect();
                }
            } );
        } );
        if (unregisteredUsers.length === 0) {
            console.log( 'No users to register!' );
            connection.disconnect();
        }
    } );
} );
