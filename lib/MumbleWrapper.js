
"use strict";

var User = require('./User');
var Channel = require('./Channel');

var EventEmitter = require('events').EventEmitter;

var MumbleWrapper = function(connection) {
    this._users = {}; //Collect high-level information about users
    this._channels = {}; //Collect high-level information about channels
    this.sessions = {}; //Sessions to user map
    //TODO: We are storing the users twice to avoid some looping. Is this the best approach?
    this.ready = false;
    this.connection = connection;
    this.rootChannel = undefined;
    this.user = undefined;
    /*
     * Forward all events from the connection
     */
    this.on('newListener', function (event, listener) {
        connection.on(event, listener);
    });
    var thisMumbleWrapper = this;
    connection.on('serverSync', function(data) { thisMumbleWrapper._serverSync(data); });
    connection.on('userState', function(data) { thisMumbleWrapper._userState(data); });
    connection.on('channelState', function(data) { thisMumbleWrapper._channelState(data); });
    connection.on('textMessage', function(data) { thisMumbleWrapper._textMessage(data); });
};

MumbleWrapper.prototype = Object.create( EventEmitter.prototype );

MumbleWrapper.prototype._serverSync = function(data) {
    this.session = data.session;
    this.maxBandwidth = data.maxBandwidth;
    this.user = this.sessions[this.session];
    this.ready = true;
    this.emit('ready');
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
    var thisMumbleWrapper = this;
    user.on('move', function(oldChannel, newChannel) { thisMumbleWrapper.emit('user-move', user, oldChannel, newChannel); });
    user.on('mute', function(muted) { thisMumbleWrapper.emit('user-mute', user, muted); });
    user.on('self-mute', function(muted) { thisMumbleWrapper.emit('user-self-mute', user, muted); });
    user.on('self-deaf', function(deafened) { thisMumbleWrapper.emit('user-self-deaf', user, deafened); });
    user.on('suppress', function(suppressed) { thisMumbleWrapper.emit('user-suppress', user, suppressed); });
    user.on('recording', function(recording) { thisMumbleWrapper.emit('user-recording', user, recording); });
    user.on('priority-speaker', function(priority) { thisMumbleWrapper.emit('user-priority-speaker', user, priority); });
    if(this.ready) {
        this.emit('user-connected', user);
    }
    return user;
};

MumbleWrapper.prototype._newChannel = function(data) {
    var channel = new Channel(data, this);
    if(channel.id === 0) {
        this.rootChannel = channel;
    }
    var thisMumbleWrapper = this;
    channel.on('rename', function(oldName, newName) { thisMumbleWrapper.emit('channel-rename', channel, oldName, newName) });
    channel.on('links-add', function(links) { thisMumbleWrapper.emit('channel-links-add', channel, links) });
    channel.on('links-remove', function(links) { thisMumbleWrapper.emit('channel-links-remove', channel, links) });
    channel.on('move', function(oldParent, newParent) { thisMumbleWrapper.emit('channel-move', channel, oldParent, newParent) });
    if(this.ready) {
        this.emit('channel-created', channel);
    }
    return channel;
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

MumbleWrapper.prototype._userState = function(data) {
    if(this.sessions[data.session] === undefined) {
        var user = this._newUser(data);
        this._users[data.userId] = user;
        this.sessions[data.session] = user;
    }
    else {
        var user = this.sessions[data.session];
        user.update(data);
    }
};

MumbleWrapper.prototype.users = function() {
    var list = [];
    for(var key in this._users) {
        list.push(this._users[key]);
    }
    return list;
};

MumbleWrapper.prototype.channelById = function(id) {
    return this._channels[id];
};

MumbleWrapper.prototype.userById = function(id) {
    return this._users[id];
};

MumbleWrapper.prototype.channelByName = function(name) {
    for(var key in this._channels) {
        var channel = this._channels[key];
        if(channel.name === name) {
            return channel;
        }
    }
    //Else return undefined
};

MumbleWrapper.prototype.userByName = function(name) {
    for(var key in this._users) {
        var user = this._users[key];
        if(user.name === name) {
            return user;
        }
    }
    //Else return undefined
};

/*
 * Forward all relevant methods from the connection
 */
MumbleWrapper.prototype.authenticate = function(name, password) { return this.connection.authenticate(name, password); };
MumbleWrapper.prototype.sendMessage = function(type, data) { return this.connection.sendMessage(type, data); };
MumbleWrapper.prototype.outputStream = function(userid) { return this.connection.outputStream(userid); };
MumbleWrapper.prototype.inputStream = function() { return this.connection.inputStream(); };
MumbleWrapper.prototype.joinPath = function(path) { return this.connection.joinPath(path); };
MumbleWrapper.prototype.sendVoice = function(chunk) { return this.connection.sendVoice(chunk); };
MumbleWrapper.prototype.disconnect = function() { return this.connection.disconnect(); };

module.exports = MumbleWrapper;
