
"use strict";

var EventEmitter = require('events').EventEmitter;

/**
 * Single user on the server.
 */
var User = function(data, wrapper) {
    this.wrapper = wrapper;
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
        id = this.wrapper.channelByName(channel).id;
    }
    else if(typeof channel === "object") {
        id = channel.id;
    }
    else {
        return;
    }
    this.wrapper.sendMessage( 'UserState', { session: this.session, actor: this.wrapper.user.session, channelId: id });
};

/**
 * @summary Sends a message to the user.
 *
 * @param {String} message - The message to send.
 */
User.prototype.sendMessage = function(message) {
    this.wrapper.connection.sendMessage('TextMessage', {
        actor : this.wrapper.session,
        session : [ this.session ],
        message : message
    });
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
    return this.wrapper.connection.outputStream(this.session, noEmptyFrames);
};

/**
 * @summary Returns an input stream for sending audio to the user.
 *
 * @returns {MumbleInputStream} Input stream.
 */
User.prototype.inputStream = function() {
    return this.wrapper.inputStreamForUser( this.session );
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
    this.session = data.session;
    this.name = data.name;
    this.id = data.userId;
    this.mute = data.mute;
    this.deaf = data.deaf;
    this.suppress = data.suppress;
    this.selfMute = data.selfMute;
    this.selfDeaf = data.selfDeaf;
    this.hash = data.hash;
    this.recording = data.recording;
    this.prioritySpeaker = data.prioritySpeaker;
    if(data.channelId !== undefined) {
        this.channel = this.wrapper.channelById(data.channelId);
    }
    else { // New users always enter root
        this.channel = this.wrapper.rootChannel;
    }
    this.channel._addUser(this);
    //TODO: Comments, textures
};

/**
 * @summary Emitted when the user disconnects
 *
 * @description
 * Also available through the client `user-disconnect´ event.
 *
 * @event User#disconnect
 */

User.prototype._detach = function() {
    this.emit('disconnect');
    this.channel._removeUser(this);
};

User.prototype._checkChangeChannel = function(data) {
    var newChannel = this.wrapper.channelById(data.channelId);
    var oldChannel = this.wrapper.channelById(this.channel.id);
    if(data.channelId !== this.channel.id) {
        oldChannel._removeUser(this);
        newChannel._addUser(this);
        this.emit('move', oldChannel, newChannel);
    }
    this.channel = newChannel;
};

/**
 * @summary Emitted when the user is muted or unmuted by the server.
 *
 * @description
 * Also available through the client `user-mute´ event.
 *
 * @event User#mute
 * @param {Boolean} status
 *      True when the user is muted, false when unmuted.
 */

User.prototype._checkMute = function(data) {
    if(data.mute && !this.mute) {
        this.emit('mute', true);
    }
    if(!data.mute && this.mute) {
        this.emit('mute', false);
    }
    this.mute = data.mute;
};

/**
 * @summary Emitted when the user mutes or unmutes themselves.
 *
 * @description
 * Also available through the client `user-self-mute´ event.
 *
 * @event User#self-mute
 * @param {Boolean} status
 *      True when the user mutes themselves. False when unmuting.
 */

User.prototype._checkSelfMute = function(data) {
    if(data.selfMute && !this.selfMute) {
        this.emit('self-mute', true);
    }
    if(!data.selfMute && this.selfMute) {
        this.emit('self-mute', false);
    }
    this.selfMute = data.selfMute;
};

/**
 * @summary Emitted when the user deafens or undeafens themselves.
 *
 * @description
 * Also available through the client `user-self-deaf´ event.
 *
 * @event User#self-deaf
 * @param {Boolean} status
 *      True when the user deafens themselves. False when undeafening.
 */

User.prototype._checkSelfDeaf = function(data) {
    if(data.selfDeaf && !this.selfDeaf) {
        this.emit('self-deaf', true);
    }
    if(!data.selfDeaf && this.selfDeaf) {
        this.emit('self-deaf', false);
    }
    this.selfDeaf = data.selfDeaf;
};

/**
 * @summary Emitted when the user is suppressed or unsuppressed.
 *
 * @description
 * Also available through the client `user-suppress´ event.
 *
 * @event User#suppress
 * @param {Boolean} status
 *      True when the user is suppressed. False when unsuppressed.
 */

User.prototype._checkSuppress = function(data) {
    if(data.suppress && !this.suppress) {
        this.emit('suppress', true);
    }
    if(!data.suppress && this.suppress) {
        this.emit('suppress', false);
    }
    this.suppress = data.suppress;
};

/**
 * @summary Emitted when the user starts or stops recording.
 *
 * @description
 * Also available through the client `user-recording´ event.
 *
 * @event User#recording
 * @param {Boolean} status
 *      True when the user starts recording. False when they stop.
 */

User.prototype._checkRecording = function(data) {
    if(data.recording && !this.recording) {
        this.emit('recording', true);
    }
    if(!data.recording && this.recording) {
        this.emit('recording', false);
    }
    this.recording = data.recording;
};

/**
 * @summary Emitted when the user gains or loses priority speaker status.
 *
 * @description
 * Also available through the client `user-priority-speaker´ event.
 *
 * @event User#priority-speaker
 * @param {Boolean} status
 *      True when the user gains priority speaker status. False when they lose
 *      it.
 */

User.prototype._checkPrioritySpeaker = function(data) {
    if(data.prioritySpeaker && !this.prioritySpeaker) {
        this.emit('priority-speaker', true);
    }
    if(!data.prioritySpeaker && this.prioritySpeaker) {
        this.emit('priority-speaker', false);
    }
    this.prioritySpeaker = data.prioritySpeaker;
};

User.prototype.update = function(data) {
    // Check which events have to be emitted
    if(data.channelId !== undefined) {
        this._checkChangeChannel(data);
    }
    if(data.mute !== undefined) {
        this._checkMute(data);
    }
    if(data.selfMute !== undefined) {
        this._checkSelfMute(data);
    }
    if(data.selfDeaf !== undefined) {
        this._checkSelfDeaf(data);
    }
    if(data.suppress !== undefined) {
        this._checkSuppress(data);
    }
    if(data.recording !== undefined) {
        this._checkRecording(data);
    }
    if(data.prioritySpeaker !== undefined) {
        this._checkPrioritySpeaker(data);
    }
    // Apply new properties
    // Done in the check methods.
    // this._applyProperties(data);
};

module.exports = User;
