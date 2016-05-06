
'use strict';

var chai = require( 'chai' );
var util = require( './_util' );

chai.use( require( 'chai-spies' ) );
var should = chai.should();

var config = {
    name1: 'ReallyARaven',
    name2: 'KindaSparhawkpp'
};

describe( 'User', function() {
    this.timeout( 5000 );

    it( 'should emit self-mute event on self-mute', function( done ) {

        util.twoConnections( done, config, function( err, conn1, conn2, done ) {
            should.not.exist( err );

            var user1remote = conn2.userBySession( conn1.user.session );

            var fields = [
                'session', 'name',
                'mute', 'deaf', 'suppress',
                'selfMute', 'recording',
                'prioritySpeaker' ];

            for( var f in fields ) {
                var field = fields[ f ];
                should.equal( user1remote[ field ], conn1.user[ field ],
                        'Field ' + field + ' isn\'t equal' );
            }

            var events = 0;
            user1remote.on( 'self-mute', function() {

                user1remote.selfMute.should.be.true;

                events++;
                if( events === 2 )
                    doAssert();
            } );

            conn1.user.on( 'self-mute', function() {

                conn1.user.selfMute.should.be.true;

                events++;
                if( events === 2 )
                    doAssert();
            } );

            var asserts = 0;

            conn1.on( 'user-self-mute', function( user, value ) {
                user.name.should.equal( user1remote.name );
                user.selfMute.should.equal( value );

                asserts++;
                if( asserts === 3 )
                    return done();
            } );

            conn2.on( 'user-self-mute', function( user, value ) {
                user.name.should.equal( conn1.user.name );
                user.selfMute.should.equal( value );

                asserts++;
                if( asserts === 3 )
                    return done();
            } );


            var doAssert = function() {

                for( var f in fields ) {
                    var field = fields[ f ];
                    should.equal( user1remote[ field ], conn1.user[ field ],
                            'Field ' + field + ' isn\'t equal' );
                }

                asserts++;
                if( asserts === 3 )
                    return done();
            };

            conn1.user.setSelfMute( true );
        } );
    } );
} );
