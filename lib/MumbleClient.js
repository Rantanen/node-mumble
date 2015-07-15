
"use strict";

var User = require('./User');
var Channel = require('./Channel');

var EventEmitter = require('events').EventEmitter;
var util = require( './util' );

/**
 * @summary Mumble client API
 *
 * @description
 * Instances should be created with Mumble.connect().
 */
var MumbleClient = function(connection) {
    this._users = {}; //Collect high-level information about users
    this._channels = {}; //Collect high-level information about channels
    this.sessions = {}; //Sessions to user map

    //TODO: We are storing the users twice to avoid some looping. Is this the
    //best approach?

    /**
     * @summary Defines whether the connection has been succesffully handshaken.
     *
     * @description
     * The connection is considered `ready` when the server handshake has been
     * processed and the initial ping has been received.
     *
     * @name MumbleClient#ready
     * @type Boolean
     */
    this.ready = false;

    /**
     * @summary The internal {@link MumbleConnection} object.
     *
     * @description
     * The connection object is used for the low level access to the Mumble
     * protocol. Most developers should find a higher level APIs for the
     * functionality on the {@link MumbleClient} class instead.
     *
     * @name MumbleClient#connection
     * @type MumbleConnection
     */
    this.connection = connection;

    /**
     * @summary The server root channel.
     *
     * @name MumbleClient#rootChannel
     * @type Channel
     */
    this.rootChannel = undefined;

    /**
     * @summary The current user.
     *
     * @name MumbleClient#user
     * @type User
     */
    this.user = undefined;

    this._gotServerSync = false;
    this._gotInitialPing = false;

    // Generate list of free whisper target IDs.
    this.freeTargets = [];
    for( var i = 1; i <= 30; i++ ) {
        this.freeTargets.push( i );
    }

    /*
     * Forward all events from the connection
     */
    this.on('newListener', function (event, listener) {
        connection.on(event, listener);
    });

    connection.once('ping', this._initialPing.bind( this ) );
    connection.on('channelRemove', this._channelRemove.bind( this ));
    connection.on('userRemove', this._userRemove.bind( this ) );
    connection.on('serverSync', this._serverSync.bind( this ) );
    connection.on('userState', this._userState.bind( this ) );
    connection.on('channelState', this._channelState.bind( this ) );
    connection.on('permissionQuery', this._permissionQuery.bind( this ) );
    connection.on('textMessage', this._textMessage.bind( this ) );
};
MumbleClient.prototype = Object.create( EventEmitter.prototype );

/**
 * @summary Emitted when a text message is received.
 *
 * @event MumbleClient#message
 * @param {String} message - The text that was sent.
 * @param {User} user - The user who sent the message.
 * @param {String} scope
 *      The scope in which the message was received. 'user' if the message was
 *      sent directly to the current user or 'channel 'if it was received
 *      through the channel.
 */

/**
 * @summary Emitted when a new user connects to the server.
 *
 * @event MumbleClient#user-connect
 * @param {User} user - The connected user.
 */

/**
 * @summary Emitted for the user events.
 *
 * @description
 * The events on the {@link User} objects are available through the Client as
 * well. These events can be used to subscribe to the events on all the users
 * at the same time.
 *
 * @event MumbleClient#user-*
 * @param {User} user - The user that caused the event.
 * @param {...*} arguments - The original event arguments.
 *
 * @example
 * client.on( 'user-move', function( user ) {
 *     console.log( 'User ' + user.name + ' moved' );
 * });
 */

/**
 * @summary Emitted when a new channel is created.
 *
 * @event MumbleClient#channel-create
 *
 * @param {Channel} channel - The new channel.
 */

/**
 * @summary Emitted for the channel events.
 *
 * @description
 * The events on the {@link Channel} objects are available through the Client as
 * well. These events can be used to subscribe to the events on all the channels
 * at the same time.
 *
 * @event MumbleClient#channel-*
 * @param {Channel} channel - The channel that caused the event.
 * @param {...*} arguments - The original event arguments.
 *
 * @example
 * client.on( 'channel-move', function( channel ) {
 *     console.log( 'Channel ' + channel.name + ' was moved' );
 * });
 */

/**
 * @summary Emitted for errors.
 *
 * @description
 * This event MUST be handled or the error object is thrown instead which will
 * likely crash the node process with a proper error message.
 *
 * @event MumbleClient#error
 *
 * @param {MumbleError} error - The error details.
 */

/**
 * @summary Returns all users currently connected to the server.
 *
 * @returns {User[]} Users connected to the server
 */
MumbleClient.prototype.users = function() {
    var list = [];
    for(var key in this._users) {
        list.push(this._users[key]);
    }
    return list;
};

/**
 * @summary Find a specific channel by its channel_id.
 *
 * @param {Number} id - Channel ID to search for.
 *
 * @returns {Channel} The channel found or undefined.
 */
MumbleClient.prototype.channelById = function(id) {
    return this._channels[id];
};

/**
 * @summary Find a specific user by their session ID.
 *
 * @description
 * Every connected user has a session ID. The ID identifies the current connection and will change when the user reconnects.
 *
 * @param {Number} id - The session ID to search for.
 *
 * @returns {User} The user found or undefined.
 */
MumbleClient.prototype.userBySession = function( id ) {
    return this.sessions[ id ];
};

/**
 * @summary Find a specific user by their user ID.
 *
 * @description
 * User ID exists only on registered users. The ID will remain the same between
 * different sessions.
 *
 * @param {Number} id - The user ID to search for.
 *
 * @returns {User} The user found or undefined.
 */
MumbleClient.prototype.userById = function(id) {
    return this._users[id];
};

/**
 * @summary Find a specific channel by its name.
 *
 * @param {String} name - Channel name to search for.
 *
 * @returns {Channel} The channel found or undefined.
 */
MumbleClient.prototype.channelByName = function(name) {
    return util.findByValue( this._channels, 'name', name );
};

/**
 * @summary Find a specific user by its name.
 *
 * @param {String} name - User name to search for.
 *
 * @returns {User} The user found or undefined.
 */
MumbleClient.prototype.userByName = function(name) {
    return util.findByValue( this._users, 'name', name );
};

/**
 * @summary Allocates an input stream for a specific user session
 *
 * @param {Number|Array} sessionId -
 *      Single user session ID or an array of those.
 * @param {Object} options -
 *      Input stream options.
 *
 * @returns {MumbleInputStream} Input stream
 */
MumbleClient.prototype.inputStreamForUser = function( sessionId, options ) {
    var self = this;

    // If we got no free target IDs left, return null.
    if( this.freeTargets.length === 0 ) {
        return null;
    }

    // Create the targets parameter based on the sessionId type.
    var targets = [];
    if( typeof sessionId === 'number' ) {
        targets.push({ session: [ sessionId ] });
    } else {
        targets.push({ session: sessionId });
    }

    var whisperId = this.freeTargets.shift();

    this.connection.sendMessage( 'VoiceTarget', {
        targets: targets,
        id: whisperId
    });

    options = { whisperId: whisperId };
    var inputStream = this.connection.inputStream( options );

    // Return the whisper ID to the target pool when we close the stream.
    inputStream.on( 'finish', function() {
        self.freeTargets.push( whisperId );
    });

    return inputStream;
};

/*
 * Forward all relevant methods from the connection
 */

/**
 * @summary Authenticate on the server.
 *
 * @description
 * This method must be invoked to start the authentication handshake. Once the
 * handshake is done the client emits `initialized` event and the rest of the
 * functionality will be available.
 *
 * @param {String} name -
 *      Username. Ignored for registered users who will use the username
 *      registered with the certificate.
 * @param {String} password -
 *      Optional password. Required if the username is in use and certificate
 *      isn't supplied.
 */
MumbleClient.prototype.authenticate = function(name, password) {
    return this.connection.authenticate(name, password); };

/**
 * @summary Sends a text message to recipients.
 *
 * @description
 * Previously a method with the same name was used to send raw Mumble protocol
 * messages.  Use {@link MumbleConnection#sendMessage} for that now.
 *
 * @param {String} message - The text to send.
 * @param {Number[]} recipients.session - Session IDs of target users.
 * @param {Number[]} recipients.channel_id - Channel IDs of target channels.
 */
MumbleClient.prototype.sendMessage = function( message, recipients ) {
    if( !recipients.session && !recipients.channel_id ) {
        return console.error(
            "Recipients not specified for sending text messages.\n" +
            "client.sendMessage isn't used for sending protobuf messages anymore.\n" +
            "Use client.connection.sendMessage for raw protobuf messages." );
    }

    var packet = {
        actor: this.session,
        message: message
    };

    // Copy the recipients to the packet.
    Object.keys( recipients ).forEach( function(r) {
        packet[r] = recipients[r];
    });

    this.connection.sendMessage( 'TextMessage', packet );
};

/**
 * @summary Retrieves an audio output stream.
 *
 * @param {Number} userid -
 *      Optional user session ID. Defines the user whose audio the stream will
 *      handle. If omitted the stream will output mixed audio.
 *
 * @returns {MumbleOutputStream} -
 *      Output stream that can be used to stream the audio out.
 */
MumbleClient.prototype.outputStream = function(userid) {
    return this.connection.outputStream(userid); };

/**
 * @summary Retrieves an audio input stream.
 *
 * @param {Object} options - Input stream options.
 *
 * @returns {MumbleInputSTream} -
 *      Input stream for streaming audio to the server.
 */
MumbleClient.prototype.inputStream = function( options ) {
    return this.connection.inputStream( options ); };

/**
 * @summary Join a channel specified by a Mumble URL
 *
 * @deprecated We should add "findByPath" method instead which can be used to
 * retrieve `Channel` instance.
 */
MumbleClient.prototype.joinPath = function(path) {
    return this.connection.joinPath(path); };

/**
 * @summary Sends a raw voice frame to the server.
 *
 * @description
 * Consider using the streams.
 *
 * @param {Buffer} chunk - 16bitLE PCM buffer of voice audio.
 */
MumbleClient.prototype.sendVoice = function(chunk) {
    return this.connection.sendVoice(chunk); };

/**
 * @summary Disconnects the client.
 */
MumbleClient.prototype.disconnect = function() {
    return this.connection.disconnect(); };

/********************
 * Internal methods
 *******************/

MumbleClient.prototype._checkReady = function() {
    if(this._gotServerSync && this._gotInitialPing && !this.ready) {
        this.ready = true;
        this.emit('ready');
    }
};

MumbleClient.prototype._initialPing = function(data) {
    this._gotInitialPing = true;
    this._checkReady();
};

MumbleClient.prototype._serverSync = function(data) {
    this.session = data.session;
    this.maxBandwidth = data.maxBandwidth;
    this.user = this.sessions[this.session];
    this._gotServerSync = true;
    this._checkReady();
    //Is really everything ready when we receive this?
    //TODO: Is this a good idea?
};

MumbleClient.prototype._textMessage = function(data) {
    var actor = this.sessions[data.actor];
    if(actor) {
        if(data.session !== null) { // Then it was a private text message
            this.emit('message', data.message, actor, 'private');
        }
        else if(data.channel_id !== null) { // A message to the channel
            this.emit('message', data.message, actor, 'channel');
        }
    }
};

MumbleClient.prototype._newUser = function(data) {
    var user = new User(data, this);

    this._wrapEvents( user, 'user', [
        'move', 'mute', 'self-mute', 'self-deaf', 'suppress',
        'recording', 'priority-speaker' ] );

    if(this.ready) {
        this.emit('user-connect', user);
    }
    return user;
};

MumbleClient.prototype._channelRemove = function(data) {
    if(data.channel_id) {
        var channel = this._channels[data.channel_id];
        channel._detach();
        delete this._channels[data.channel_id];
    }
};

/**
 * @summary Remove the user from the internal collection.
 *
 * @description
 * Invoked when the server notifies us of user leaving.
 *
 * @private
 */
MumbleClient.prototype._userRemove = function(data) {

    // Make sure the user exists currently.
    //
    // The server might in some cases notify of user leaving before we've
    // received the user data for example.  In this case we HOPE that the
    // server won't actually send us the user's data during the UserState
    // exchange as that would result in us adding the user back to the users
    // list.
    if(data.session && this.sessions[ data.session ] ) {

        // Emit the user disconnection event while the user is still registered
        // to the client and channels
        var user = this.sessions[data.session];
        this.emit('user-disconnect', user);

        // Detach and clean up the user.
        user._detach();
        delete this.users[user.id];
        delete this.sessions[data.session];
    }
};

MumbleClient.prototype._newChannel = function(data) {
    var channel = new Channel(data, this);
    if(channel.id === 0) {
        this.rootChannel = channel;
    }

    this._wrapEvents( channel, 'channel', [
        'rename', 'links-add', 'links-remove', 'move', 'remove', 'permissions-update' ] );

    if(this.ready) {
        this.emit('channel-create', channel);
    }
    return channel;
};

/**
 * @summary Wraps source events to be emitted from the Client as well.
 *
 * @private
 *
 * @param {Object} source - Original event source
 * @param {String} prefix - Event prefix for the events the source emits.
 * @param {String[]} events - Events to delegate.
 */
MumbleClient.prototype._wrapEvents = function( source, prefix, events ) {
    var self = this;

    // Process all events
    events.forEach( function( event ) {
        var myEvent = prefix + '-' + event;
        source.on( event, function() {

            // Construct the event arguments for the 'emit' call:
            // eventName, source, ...original arguments
            var args = Array.prototype.slice.call( arguments );
            args.unshift( source );
            args.unshift( myEvent );

            // Emit.
            self.emit.apply( self, args );
        });
    });
};

MumbleClient.prototype._channelState = function(data) {
    if(this._channels[data.channel_id] === undefined) {
        this._channels[data.channel_id] = this._newChannel(data);
    }
    else {
        var channel = this._channels[data.channel_id];
        channel.update(data);
    }
};

MumbleClient.prototype._permissionQuery = function( query ) {

    // If the channel isn't known, ignore the permissions.
    if(this._channels[query.channel_id] === undefined) {
        return;
    }

    var channel = this._channels[query.channel_id];
    channel.onPermissionQuery( query );
};

MumbleClient.prototype._userState = function(data) {
    if(this.sessions[data.session] === undefined) {
        var user = this._newUser(data);
        this._users[data.userId] = user;
        this.sessions[data.session] = user;
    }
    else {
        this.sessions[data.session].update( data );
    }
};

module.exports = MumbleClient;
