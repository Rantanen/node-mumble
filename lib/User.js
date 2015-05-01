
"use strict";

var EventEmitter = require('events').EventEmitter;

var User = function(data, wrapper) {
	this.wrapper = wrapper;
	this._applyProperties(data);
};

User.prototype = Object.create(EventEmitter.prototype);

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
		this.channel = this.wrapper.getChannelById(data.channelId);
	}
	else { // New users always enter root
		this.channel = this.wrapper.rootChannel;
	}
	//TODO: Comments, textures
};

User.prototype._checkChangeChannel = function(data) {
	var newChannel = this.wrapper.getChannelById(data.channelId);
	var oldChannel = this.wrapper.getChannelById(this.channel.id);
	if(data.channelId !== this.channel.id) {
		this.emit('move', oldChannel, newChannel);
	}
	this.channel = newChannel;
};

User.prototype._checkMute = function(data) {
	if(data.mute && !this.mute) {
		this.emit('mute', true);
	}
	if(!data.mute && this.mute) {
		this.emit('mute', false);
	}
	this.mute = data.mute;
};

User.prototype._checkSelfMute = function(data) {
	if(data.selfMute && !this.selfMute) {
		this.emit('self-mute', true);
	}
	if(!data.selfMute && this.selfMute) {
		this.emit('self-mute', false);
	}
	this.selfMute = data.selfMute;
};

User.prototype._checkSelfDeaf = function(data) {
	if(data.selfDeaf && !this.selfDeaf) {
		this.emit('self-deaf', true);
	}
	if(!data.selfDeaf && this.selfDeaf) {
		this.emit('self-deaf', false);
	}
	this.selfDeaf = data.selfDeaf;
};

User.prototype._checkSuppress = function(data) {
	if(data.suppress && !this.suppress) {
		this.emit('suppress', true);
	}
	if(!data.suppress && this.suppress) {
		this.emit('suppress', false);
	}
	this.suppress = data.suppress;
};

User.prototype._checkRecording = function(data) {
	if(data.recording && !this.recording) {
		this.emit('recording', true);
	}
	if(!data.recording && this.recording) {
		this.emit('recording', false);
	}
	this.recording = data.recording;
};

User.prototype._checkPrioritySpeaker = function(data) {
	if(data.prioritySpeaker && !this.prioritySpeaker) {
		this.emit('priority-speaker', true);
	}
	if(!data.prioritySpeaker && this.prioritySpeaker) {
		this.emit('priority-speaker', false);
	}
	this.prioritySpeaker = data.prioritySpeaker;
};

User.prototype.canTalk = function() {
	return !this.mute && !this.selfMute && !this.suppress;
};

User.prototype.canHear = function() {
	return !this.selfDeaf;
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
}

module.exports = User;