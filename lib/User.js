
"use strict";

var EventEmitter = require('events').EventEmitter;
var util = require( './util' );

/**
 * Single user on the server.
 */
var User = function(data, client) {
    this.client = client;
    this._applyProperties(data);
};

User.prototype = Object.create(EventEmitter.prototype);

/**
 * @summary Moves the user to a channel
 *
 * @param {Channel|String} channel - Channel name or a channel object
 */
User.prototype.moveToChannel = function(channel) {
    var id;
    if(typeof channel === "string") {
        id = this.client.channelByName(channel).id;
    }
    else if(typeof channel === "object") {
        id = channel.id;
    }
    else {
        return;
    }
    this.client.connection.sendMessage( 'UserState', { session: this.session, actor: this.client.user.session, channel_id: id });
};

/**
 * @summary Attempts to kick the user.
 * 
 * @param {String} [reason] - The reason to kick the user for.
 */
User.prototype.kick = function(reason) {
    reason = reason ? reason : "You have been kicked";
    this.client.connection.sendMessage( 'UserRemove', { session: this.session, actor: this.client.user.session, reason: reason, ban: false } );
};

/**
 * @summary Attempts to ban the user.
 * 
 * @param {String} [reason] - The reason to ban the user for.
 */
User.prototype.ban = function(reason) {
    reason = reason ? reason : "You have been banned";
    this.client.connection.sendMessage( 'UserRemove', { session: this.session, actor: this.client.user.session, reason: reason, ban: true } );
};

/**
 * @summary Sends a message to the user.
 *
 * @param {String} message - The message to send.
 */
User.prototype.sendMessage = function(message) {
    this.client.sendMessage( message, { session: [ this.session ] } );
};

/**
 * @summary Returns an output stream for listening to the user audio.
 *
 * @param {Boolean} [noEmptyFrames]
 *      True to cut the output stream during silence. If the output stream
 *      isn't cut it will keep emitting zero-values when the user isn't
 *      talking.
 *
 * @returns {MumbleOutputStream} Output stream.
 */
User.prototype.outputStream = function(noEmptyFrames) {
    return this.client.connection.outputStream(this.session, noEmptyFrames);
};

/**
 * @summary Returns an input stream for sending audio to the user.
 *
 * @returns {MumbleInputStream} Input stream.
 */
User.prototype.inputStream = function() {
    return this.client.inputStreamForUser( this.session );
};

/**
 * @summary Checks whether the user can talk or not.
 *
 * @returns {Boolean} True if the user can talk.
 */
User.prototype.canTalk = function() {
    return !this.mute && !this.selfMute && !this.suppress;
};

/**
 * @summary Checks whether the user can hear other people.
 *
 * @returns {Boolean} True if the user can hear.
 */
User.prototype.canHear = function() {
    return !this.selfDeaf;
};

User.prototype._applyProperties = function(data) {

    /**
     * @summary Session ID
     *
     * @description
     * Session ID is present for all users. The ID specifies the current user
     * session and will change when the user reconnects.
     *
     * @see User#id
     *
     * @name User#session
     * @type Number
     */
    this.session = data.session;

    /**
     * @summary User name
     *
     * @name User#name
     * @type String
     */
    this.name = data.name;

    /**
     * @summary User ID
     *
     * @description
     * User ID is specified only for users who are registered on the server.
     * The user ID won't change when the user reconnects.
     *
     * @see User#session
     *
     * @name User#id
     * @type Number
     */
    this.id = data.user_id;

    /**
     * @summary _true_ when the user is muted by an admin.
     *
     * @name User#mute
     * @type Boolean
     */
    this.mute = data.mute;

    /**
     * @summary _true_ when the user is deafened by an admin.
     *
     * @name User#deaf
     * @type Boolean
     */
    this.deaf = data.deaf;

    /**
     * @summary _true_ when the user is suppressed due to lack of
     * permissions.
     *
     * @description
     * The user will be suppressed by the server if they don't have permissions
     * to speak on the current channel.
     *
     * @name User#suppress
     * @type Boolean
     */
    this.suppress = data.suppress;

    /**
     * @summary _true_ when the user has muted themselves.
     *
     * @name User#selfMute
     * @type Boolean
     */
    this.selfMute = data.self_mute;

    /**
     * @summary _true_ when the user has deafened themselves.
     *
     * @name User#selfDeaf
     * @type Boolean
     */
    this.selfDeaf = data.self_deaf;

    /**
     * @summary The hash of the user certificate
     *
     * @name User#hash
     * @type String
     */
    this.hash = data.hash;

    /**
     * @summary _true_ when the user is recording the conversation.
     *
     * @name User#recording
     * @type Boolean
     */
    this.recording = data.recording;

    /**
     * @summary _true_ when the user is a priority speaker.
     *
     * @name User#prioritySpeaker
     * @type Boolean
     */
    this.prioritySpeaker = data.priority_speaker;

    /**
     * @summary User's current channel.
     *
     * @name User#channel
     * @type Channel
     */
    if(data.channel_id !== null) {
        this.channel = this.client.channelById(data.channel_id);
    }
    else { // New users always enter root
        this.channel = this.client.rootChannel;
    }
    this.channel._addUser(this);
    //TODO: Comments, textures
};

/**
 * @summary Emitted when the user disconnects
 *
 * @description
 * Also available through the client `user-disconnect` event.
 *
 * @event User#disconnect
 */

User.prototype._detach = function() {
    this.emit('disconnect');
    this.channel._removeUser(this);
};


/**
 * @summary Emitted when the user moves between channels.
 *
 * @event User#move
 * @param {Channel} oldChannel - The channel where the user was moved from.
 * @param {Channel} newChannel - The channel where the user was moved to.
 * @param {User} actor - The user who moved the channel or undefined for server.
 */
User.prototype._checkChangeChannel = function( data ) {

    // Get the two channel instances.
    var newChannel = this.client.channelById( data.channel_id );
    var oldChannel = this.channel;

    // Make sure there is a change in the channel.
    if( newChannel === oldChannel )
        return;

    // Make the channel change and notify listeners.
    this.channel = newChannel;
    oldChannel._removeUser( this );
    newChannel._addUser( this );

    var actor = this.client.userBySession( data.actor );
    this.emit( 'move', oldChannel, newChannel, actor );
};

/**
 * @summary Emitted when the user is muted or unmuted by the server.
 *
 * @description
 * Also available through the client `user-mute` event.
 *
 * @event User#mute
 * @param {Boolean} status
 *      True when the user is muted, false when unmuted.
 */

/**
 * @summary Emitted when the user mutes or unmutes themselves.
 *
 * @description
 * Also available through the client `user-self-mute` event.
 *
 * @event User#self-mute
 * @param {Boolean} status
 *      True when the user mutes themselves. False when unmuting.
 */

/**
 * @summary Emitted when the user deafens or undeafens themselves.
 *
 * @description
 * Also available through the client `user-self-deaf` event.
 *
 * @event User#self-deaf
 * @param {Boolean} status
 *      True when the user deafens themselves. False when undeafening.
 */

/**
 * @summary Emitted when the user is suppressed or unsuppressed.
 *
 * @description
 * Also available through the client `user-suppress` event.
 *
 * @event User#suppress
 * @param {Boolean} status
 *      True when the user is suppressed. False when unsuppressed.
 */

/**
 * @summary Emitted when the user starts or stops recording.
 *
 * @description
 * Also available through the client `user-recording` event.
 *
 * @event User#recording
 * @param {Boolean} status
 *      True when the user starts recording. False when they stop.
 */

/**
 * @summary Emitted when the user gains or loses priority speaker status.
 *
 * @description
 * Also available through the client `user-priority-speaker` event.
 *
 * @event User#priority-speaker
 * @param {Boolean} status
 *      True when the user gains priority speaker status. False when they lose
 *      it.
 */

User.prototype.update = function(data) {
    var self = this;

    // Check the simple fields.
    [
        'mute', 'selfMute', 'suppress',
        'selfDeaf',
        'recording', 'prioritySpeaker',
    ].forEach( function(f) {
        self._checkField( data, f );
    });

    // Channel check
    if( data.channel_id !== null ) {
        this._checkChangeChannel( data );
    }

};

User.prototype._checkField = function( data, field ) {

    // Make sure the field has a value.
    var newValue = data[ field ];
    if( newValue === undefined )
        return;

    // Make sure the new value differs.
    var oldValue = this[ field ];
    if( newValue === oldValue )
        return;

    // All checks succeeded. Store the new value and emit change event.
    this[ field ] = newValue;
    var actor = this.client.userBySession( data.actor );
    this.emit( util.toEventName( field ), newValue, actor );
};


module.exports = User;
