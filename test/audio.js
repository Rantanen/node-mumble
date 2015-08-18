
"use strict";

var chai = require( 'chai' );
var mumble = require( '../' );
var util = require( './_util' );

chai.use( require( 'chai-spies' ) );
var should = chai.should();

describe( 'MumbleConnection', function() {
    this.timeout( 5000 );

    it( 'should not emit frames on silence', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            var gotVoice = false;
            conn2.on( 'voice', function( voice ) {
                gotVoice = true;
            });

            setTimeout( function() {
                gotVoice.should.be.false;
                done();
            }, 1000 );
        });
    });

    it( 'should not have too big of a delay', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            // Single frame
            var b = new Buffer( conn1.connection.FRAME_SIZE * 2 );

            var start = Date.now();
            conn1.sendVoice( b );

            conn2.on( 'voice', function(f) {
                var delay = Date.now() - start;

                // Delay is affected by the server location relative to test
                // runner. In Travis' case the runner is most likely in the US
                // while the test server is in Europe.
                delay.should.be.below( 300 );
                done();
            });
        });
    });

    it( 'should not generate extra frames', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            // Single frame
            var b = new Buffer( conn1.connection.FRAME_SIZE * 2 );

            var times = 5;
            for( var i = 0; i < times; i++ )
                conn1.sendVoice( b );

            conn2.on( 'voice', function() {
                times--;
                if( times === 0 )
                    done();
            });
        });
    });

    it( 'should not drop the first voice packet', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            var b = new Buffer( conn1.connection.FRAME_SIZE * 2 );
            var sentFrame;

            // Override the sendEncodedFrame of conn1 to catch the
            // actual encoded frame we are sending.
            var sef = conn1.connection.sendEncodedFrame;
            conn1.connection.sendEncodedFrame = function( frames, c, wt, vs ) {
                should.not.exist( sentFrame );
                sentFrame = frames;
                return sef.call( conn1.connection, frames, c, wt, vs );
            };

            conn1.sendVoice( new Buffer( conn1.connection.FRAME_SIZE * 2 ) );

            conn2.on( 'voice-frame', function( packets ) {
                if( packets.length === 0 ) return;
                var frame = packets[0].frame;

                frame.should.deep.equal( sentFrame );
                done();
            });
        });
    });

    it( 'should not drop the first voice packet after silence', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            var b = new Buffer( conn1.connection.FRAME_SIZE * 2 );
            var sentFrame, okToEnd = false;

            // Override the sendEncodedFrame of conn1 to catch the
            // actual encoded frame we are sending.
            var sef = conn1.connection.sendEncodedFrame;
            conn1.connection.sendEncodedFrame = function( frames, c, wt, vs ) {
                should.not.exist( sentFrame );
                sentFrame = frames;
                return sef.call( conn1.connection, frames, c, wt, vs );
            };

            // First send single voice frame to start the voice transmission.
            conn1.sendVoice( new Buffer( conn1.connection.FRAME_SIZE * 2 ) );

            // After a second send the next one. This should have the connection
            // in 'voice ended' state with voiceActive = false.
            setTimeout( function() {
                sentFrame = null;
                okToEnd = true;
                conn1.sendVoice( new Buffer( conn1.connection.FRAME_SIZE * 2 ) );
            }, 500 );

            var spy = chai.spy();
            conn2.on( 'voice-end', spy );

            conn2.on( 'voice-frame', function( packets ) {
                if( packets.length === 0 ) return;
                var frame = packets[0].frame;

                if( okToEnd ) {
                    spy.should.have.been.called.once();
                }

                frame.should.deep.equal( sentFrame );

                if( okToEnd ) {
                    done();
                }
            });

        });
    });

    it( 'should contain audio in the first packet', function( done ) {

        util.twoConnections( done, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            // We'll send a flat signal on specific level.
            var level = 1 << 9;

            conn2.on( 'voice', function( voice ) {

                // We're interested in the level at the end due to
                // encoder delays.
                var value = voice.readInt16LE( voice.length - 100 );
                var diff = Math.abs( value - level ) / level;

                // Make sure the difference is less than 5%
                // We'll accept 'slight' level changes due to lossy encoding.
                diff.should.be.below( 0.25 );
                done();
            });

            var buffer = util.levelBuffer( conn1.connection.FRAME_SIZE, level );
            conn1.sendVoice( buffer );
        });
    });
});
