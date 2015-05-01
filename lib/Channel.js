
"use strict";

var EventEmitter = require('events').EventEmitter;

var Channel = function(data, wrapper) {

	this.wrapper = wrapper;

	this.links = [];
	this.children = [];
	this.users = [];
	this._checkParent(data); //Needs to be done seperate
	this._applyProperties(data);
	//TODO: Description
};

Channel.prototype = Object.create(EventEmitter.prototype);

Channel.prototype.update = function(data) {
	// Check which events have to be emitted and what has to be updated
	if(data.name !== undefined) {
		this._checkRename(data);
	}
	if(data.linksAdd !== undefined || data.linksRemove !== undefined) {
		this._checkLinks(data);
	}
	if(data.parent !== undefined) {
		this._checkParent(data);
	}
	// Apply new properties
	// Done in check methods.
	//this._applyProperties(data);
};

Channel.prototype._checkRename = function(data) {
	if(data.name !== this.name) {
		this.emit("rename", this.name, data.name);
	}
	this.name = data.name;
};

Channel.prototype._checkLinks = function(data) {
	if(data.linksAdd !== undefined) {
		var newChannels = [];
		for(var key in data.linksAdd) {
			var channel = this.wrapper.getChannelById(data.linksAdd);
			this.links.push(channel);
			newChannels.push(channel);
		}
		this.emit("links-add", newChannels);
	}
	if(data.linksRemove !== undefined) {
		var linksRemove = [];
		for(var key in data.linksRemove) {
			for(var key2 in this.links) {
				var channel = this.links[key2];
				if(channel.id == data.linksRemove[key]) {
					linksRemove.push(channel);
					this.links.splice(key2, 1);
					break;
				}
			}
		}
		this.emit("links-remove", linksRemove);
	}
};

Channel.prototype._checkParent = function(data) {
	if(this.parent) {
		if(this.parent.id !== data.parent) {
			this.parent._removeChild(this);
			var oldParent = this.parent;
			this.parent = this.wrapper.getChannelById(data.parent);
			this.parent._addChild(this);
			this.emit("move", oldParent, this.parent);
		}
	}
	else {
		if(data.parent !== undefined) { // parent can be 0. Therefor we need to check for undefined
			// Root does not have parent :( poor root.
			this.parent = this.wrapper.getChannelById(data.parent);
			this.parent._addChild(this);
		}
	}
};

Channel.prototype._applyProperties = function(data) {
	this.id = data.channelId;
	this.name = data.name;
	for(var key in data.links) {
		var linkId = data.links[key];
		if(this.links.indexOf(linkId) === -1) {
			this.links.push(this.wrapper.getChannelById(linkId));
		}
	}
	this.temporary = data.temporary;
	this.position = data.position;
	// Parent is handled in _checkParent as it is more complex
	//this.parent = wrapper.getChannelById(data.parent);
};

Channel.prototype._addChild = function(channel) {
	this.children.push(channel);
};

Channel.prototype._removeChild = function(channel) {
	this.children.push(channel);
};

module.exports = Channel;