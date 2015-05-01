
"use strict";

var User = require('./User');
var Channel = require('./Channel');

var EventEmitter = require('events').EventEmitter;

var MumbleWrapper = function(connection) {
	this.users = {}; //Collect high-level information about users
	this.channels = {}; //Collect high-level information about channels
	this.sessions = {}; //Sessions to user map
	//TODO: We are storing the users twice to avoid some looping. Is this the best approach?
	this.ready = false;
	this.connection = connection;
	this.rootChannel = undefined;
	/*
	 * Forward all events from the connection
	 */
	this.on('newListener', function (event, listener) {
		connection.on(event, listener);
	});
	var thisMumbleWrapper = this;
	connection.on('userRemove', function(data) { thisMumbleWrapper._userRemove(data); });
	connection.on('userState', function(data) { thisMumbleWrapper._userState(data) });
	connection.on('channelState', function(data) { thisMumbleWrapper._channelState(data) });
	connection.once('ping', function() { // Once we receive the first ping, all users and channels were transmitted
		//TODO: Is this a good idea?
		thisMumbleWrapper.ready = true;
		thisMumbleWrapper.emit('ready');
	});
};

MumbleWrapper.prototype = Object.create( EventEmitter.prototype );

MumbleWrapper.prototype._userRemove = function(data) {
	if(data.session) {
		var user = this.sessions[data.session];
		user._detach()
		delete this.users[user.id];
		delete this.sessions[data.session];
		this.emit('user-disconnect', user);
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
		this.emit('user-connect', user);
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
	if(this.channels[data.channelId] === undefined) {
		this.channels[data.channelId] = this._newChannel(data);
	}
	else {
		var channel = this.channels[data.channelId];
		channel.update(data);
	}
};

MumbleWrapper.prototype._userState = function(data) {
	if(this.sessions[data.session] === undefined) {
		var user = this._newUser(data);
		this.users[data.userId] = user;
		this.sessions[data.session] = user;
	}
	else {
		var user = this.sessions[data.session];
		user.update(data);
	}
};

MumbleWrapper.prototype.getUsers = function() {
	var list = [];
	for(var key in this.users) {
		list.push(this.users[key]);
	}
	return list;
};

MumbleWrapper.prototype.getChannelById = function(id) {
	return this.channels[id];
};

MumbleWrapper.prototype.getUserById = function(id) {
	return this.users[id];
};

MumbleWrapper.prototype.getChannelByName = function(name) {
	for(var key in this.channels) {
		var channel = this.channels[key];
		if(channel.name === name) {
			return channel;
		}
	}
	//Else return undefined
};

MumbleWrapper.prototype.getUserByName = function(name) {
	for(var key in this.users) {
		var user = this.users[key];
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
