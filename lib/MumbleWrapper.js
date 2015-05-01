
"use strict";

var EventEmitter = require('events').EventEmitter;

var MumbleWrapper = function(connection) {
	this.connection = connection;
	/*
	 * Forward all events from the connection
	 */
	this.on('newListener', function (event, listener) {
		connection.on(event, listener);
	});
};


MumbleWrapper.prototype = Object.create( EventEmitter.prototype );

MumbleWrapper.prototype.authenticate = function(name, password) { return this.connection.authenticate(name, password); };
MumbleWrapper.prototype.sendMessage = function(type, data) { return this.connection.sendMessage(type, data); };
MumbleWrapper.prototype.outputStream = function(userid) { return this.connection.outputStream(userid); };
MumbleWrapper.prototype.inputStream = function() { return this.connection.inputStream(); };
MumbleWrapper.prototype.joinPath = function(path) { return this.connection.joinPath(path); };
MumbleWrapper.prototype.sendVoice = function(chunk) { return this.connection.sendVoice(chunk); };
MumbleWrapper.prototype.disconnect = function() { return this.connection.disconnect(); };

module.exports = MumbleWrapper;
