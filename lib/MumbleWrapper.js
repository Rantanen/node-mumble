
"use strict";

var User = require('./User');
var Channel = require('./Channel');

var EventEmitter = require('events').EventEmitter;

/**
 * Mumble client API
 *
 * Instances should be created with Mumble.connect().
 *
 * @fires MumbleWrapper#message
 */
var MumbleWrapper = function(connection) {
    this._users = {}; //Collect high-level information about users
    this._channels = {}; //Collect high-level information about channels
    this.sessions = {}; //Sessions to user map

    //TODO: We are storing the users twice to avoid some looping. Is this the
    //best approach?
    this.ready = false;
    this.connection = connection;
    this.rootChannel = undefined;
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
MumbleWrapper.prototype = Object.create( EventEmitter.prototype );

/**
 * Emitted when a text message is received.
 *
 * @event MumbleWrapper#message
 * @param {String} message - The text that was sent.
 * @param {User} user - The user who sent the message.
 * @param {String} scope
 *      The scope in which the message was received. 'user' if the message was
 *      sent directly to the current user or 'channel 'if it was received
 *      through the channel.
 */

/**
 * Returns all users currently connected to the server.
 *
 * @returns {User[]} - Users connected to the server
 */
MumbleWrapper.prototype.users = function() {
    var list = [];
    for(var key in this._users) {
        list.push(this._users[key]);
    }
    return list;
};

/**
 * Find a specific channel by its channelId.
 *
 * @param {Number} id - Channel ID to search for.
 *
 * @returns {Channel} - The channel found or undefined.
 */
MumbleWrapper.prototype.channelById = function(id) {
    return this._channels[id];
};

/**
 * Find a specific user by their user ID.
 *
 * User ID exists only on registered users. The ID will remain the same between
 * different sessions.
 *
 * @param {Number} id - The user ID to search for.
 *
 * @returns {User} - The user found or undefined.
 */
MumbleWrapper.prototype.userById = function(id) {
    return this._users[id];
};

/**
 * Find a specific channel by its name.
 *
 * @param {String} name - Channel name to search for.
 *
 * @returns {Channel} - The channel found or undefined.
 */
MumbleWrapper.prototype.channelByName = function(name) {
    for(var key in this._channels) {
        var channel = this._channels[key];
        if(channel.name === name) {
            return channel;
        }
    }
    //Else return undefined
};

/**
 * Find a specific user by its name.
 *
 * @param {String} name - User name to search for.
 *
 * @returns {User} - The user found or undefined.
 */
MumbleWrapper.prototype.userByName = function(name) {
    for(var key in this._users) {
        var user = this._users[key];
        if(user.name === name) {
            return user;
        }
    }
    //Else return undefined
};

/**
 * Allocates an input stream for a specific user session
 *
 * @param {Number|Array} sessionId -
 *      Single user session ID or an array of those.
 */
MumbleWrapper.prototype.inputStreamForUser = function( sessionId ) {
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

    this.sendMessage( 'VoiceTarget', {
        targets: targets,
        id: whisperId
    });

    var inputStream = this.connection.inputStream( whisperId );

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
 * Authenticate on the server.
 *
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
MumbleWrapper.prototype.authenticate = function(name, password) {
    return this.connection.authenticate(name, password); };

/**
 * Sends a raw Mumble protocol message to the server.
 *
 * Serializes and sends a protocol buffer message to the Mumble server. This
 * method can be used to invoke functionality not otherwise exposed by the API.
 * Shouldn't be needed for most operations.
 *
 * @param {String} name -
 *      Protocol buffer message name.
 *      Reference mumble protocol buffer documentation:
 *      https://github.com/mumble-voip/mumble/blob/master/src/Mumble.proto
 * @param {Object} data -
 *      JavaScript object representation of the protocol buffer message to
 *      serialize.
 */
MumbleWrapper.prototype.sendMessage = function(type, data) {
    return this.connection.sendMessage(type, data); };

/**
 * Retrieves an audio output stream.
 *
 * @param {Number} userid -
 *      Optional user session ID. Defines the user whose audio the stream will
 *      handle. If omitted the stream will output mixed audio.
 *
 * @returns {MumbleOutputStream} -
 *      Output stream that can be used to stream the audio out.
 */
MumbleWrapper.prototype.outputStream = function(userid) {
    return this.connection.outputStream(userid); };

/**
 * Retrieves an audio input stream.
 *
 * @returns {MumbleInputSTream} -
 *      Input stream for streaming audio to the server.
 */
MumbleWrapper.prototype.inputStream = function() {
    return this.connection.inputStream(); };

/**
 * Join a channel specified by a Mumble URL
 *
 * @deprecated We should add "findByPath" method instead which can be used to
 * retrieve `Channel` instance.
 */
MumbleWrapper.prototype.joinPath = function(path) {
    return this.connection.joinPath(path); };

/**
 * Sends a raw voice frame to the server.
 *
 * Consider using the streams.
 *
 * @param {Buffer} chunk - 16bitLE PCM buffer of voice audio.
 */
MumbleWrapper.prototype.sendVoice = function(chunk) {
    return this.connection.sendVoice(chunk); };

/**
 * Disconnects the client.
 */
MumbleWrapper.prototype.disconnect = function() {
    return this.connection.disconnect(); };

/********************
 * Internal methods
 *******************/

MumbleWrapper.prototype._checkReady = function() {
    if(this._gotServerSync && this._gotInitialPing && !this.ready) {
        this.ready = true;
        this.emit('ready');
    }
};

MumbleWrapper.prototype._initialPing = function(data) {
    this._gotInitialPing = true;
    this._checkReady();
};

MumbleWrapper.prototype._serverSync = function(data) {
    this.session = data.session;
    this.maxBandwidth = data.maxBandwidth;
    this.user = this.sessions[this.session];
    this._gotServerSync = true;
    this._checkReady();
    //Is really everything ready when we receive this?
    //TODO: Is this a good idea?
};

MumbleWrapper.prototype._textMessage = function(data) {
    var actor = this.sessions[data.actor];
    if(actor !== undefined) {
        if(data.session !== undefined) { // Then it was a private text message
            this.emit('message', data.message, actor, 'private');
        }
        else if(data.channelId !== undefined) { // A message to the channel
            this.emit('message', data.message, actor, 'channel');
        }
    }
};

MumbleWrapper.prototype._newUser = function(data) {
    var user = new User(data, this);

    this._wrapEvents( user, 'user', [
        'move', 'mute', 'self-mute', 'self-deaf', 'suppress',
        'recording', 'priority-speaker' ] );

    if(this.ready) {
        this.emit('user-connect', user);
    }
    return user;
};

MumbleWrapper.prototype._channelRemove = function(data) {
    if(data.channelId) {
        var channel = this._channels[data.channelId];
        channel._detach();
        delete this._channels[data.channelId];
    }
};

/**
 * Remove the user from the internal collection.
 *
 * Invoked when the server notifies us of user leaving.
 */
MumbleWrapper.prototype._userRemove = function(data) {

    // Make sure the user exists currently.
    //
    // The server might in some cases notify of user leaving before we've
    // received the user data for example.  In this case we HOPE that the
    // server won't actually send us the user's data during the UserState
    // exchange as that would result in us adding the user back to the users
    // list.
    if(data.session && this.sessions[ data.session ] ) {

        // Emit the user disconnection event while the user is still registered
        // to the wrapper and channels
        var user = this.sessions[data.session];
        this.emit('user-disconnect', user);

        // Detach and clean up the user.
        user._detach();
        delete this.users[user.id];
        delete this.sessions[data.session];
    }
};

MumbleWrapper.prototype._newChannel = function(data) {
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
 * Wraps source events to be emitted from the Wrapper as well.
 *
 * @param {Object} source - Original event source
 * @param {String} prefix - Event prefix for the events the source emits.
 * @param {String[]} events - Events to delegate.
 */
MumbleWrapper.prototype._wrapEvents = function( source, prefix, events ) {
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

MumbleWrapper.prototype._channelState = function(data) {
    if(this._channels[data.channelId] === undefined) {
        this._channels[data.channelId] = this._newChannel(data);
    }
    else {
        var channel = this._channels[data.channelId];
        channel.update(data);
    }
};

MumbleWrapper.prototype._permissionQuery = function( query ) {

    // If the channel isn't known, ignore the permissions.
    if(this._channels[query.channelId] === undefined) {
        return;
    }

    var channel = this._channels[query.channelId];
    channel.onPermissionQuery( query );
};

MumbleWrapper.prototype._userState = function(data) {
    if(this.sessions[data.session] === undefined) {
        var user = this._newUser(data);
        this._users[data.userId] = user;
        this.sessions[data.session] = user;
    }
    else {
        this.sessions[data.session].update( data );
    }
};

module.exports = MumbleWrapper;
