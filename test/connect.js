
'use strict';

var chai = require( 'chai' );
var mumble = require( '../' );
var MumbleConnectionManager = mumble.MumbleConnectionManager;

chai.use( require( 'chai-spies' ) );
var should = chai.should();

describe( 'mumble', function() {
    this.timeout( 5000 );

    describe( '#connect()', function() {

        it( 'should connect', function( done ) {

            mumble.connect( process.env.MUMBLE_URL, function( err, conn ) {
                should.not.exist( err );
                done();
            } );
        } );

        it( 'should be able to authenticate', function( done ) {

            mumble.connect( process.env.MUMBLE_URL, function( err, conn ) {
                should.not.exist( err );

                conn.on( 'initialized', function() {
                    conn.user.name.should.equal( 'NodeTestUser' );
                    done();
                } );

                conn.authenticate( 'NodeTestUser' );
            } );
        } );
    } );

    describe( 'MumbleConnectionManager', function() {

        it( 'should connect', function( done ) {

            var manager = new MumbleConnectionManager( process.env.MUMBLE_URL );
            manager.connect( function( err, conn ) {
                should.not.exist( err );
                done();
            } );
        } );

        it( 'should be able to authenticate', function( done ) {

            var manager = new MumbleConnectionManager( process.env.MUMBLE_URL );
            manager.connect( function( err, conn ) {
                should.not.exist( err );

                conn.on( 'initialized', function() {
                    conn.user.name.should.equal( 'NodeTestUser2' );
                    done();
                } );

                conn.authenticate( 'NodeTestUser2' );
            } );
        } );
    } );
} );
