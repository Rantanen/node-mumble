
"use strict";

var util = require( './util' );
var EventEmitter = require('events').EventEmitter;

/**
 * Single channel on the server.
 */
var Channel = function(data, client) {

    this.client = client;

    /**
     * @summary Linked channels
     *
     * @name Channel#links
     * @type Channel[]
     */
    this.links = [];

    /**
     * @summary Child channels
     *
     * @name Channel#children
     * @type Channel[]
     */
    this.children = [];

    /**
     * @summary Users in the channel
     *
     * @name Channel#users
     * @type User[]
     */
    this.users = [];

    this._checkParent(data); //Needs to be done seperate
    this._applyProperties(data);
    //TODO: Description
};

Channel.prototype = Object.create(EventEmitter.prototype);

/**
 * @summary Join the channel
 */
Channel.prototype.join = function() {
    this.client.connection.sendMessage( 'UserState', { session: this.client.user.session, actor: this.client.user.session, channel_id: this.id });
};

/**
 * @summary Sends a message to the channel.
 *
 * @param {String} message - The message to send.
 */
Channel.prototype.sendMessage = function(message) {
    this.client.sendMessage( message, { channel_id: [ this.id ] });
};

/**
 * @summary Retrieves the channel permissions
 *
 * @param {Function(err,permissions)} callback - Result callback
 */
Channel.prototype.getPermissions = function( callback ) {

    // Return the cached permissions info if we got that.
    if( this.permissions ) {
        return process.nextTick( callback.bind( null, null, this.permissions ) );
    }

    // Send the permissions query and wire up the callback.
    this.client.connection.sendMessage( 'PermissionQuery', {
        channel_id: this.id
    });

    // Bind the 'this' and 'err' parameters. The last one comes from the event.
    this.once( 'permissions-update', callback.bind( null, null ) );
};


/**
 * @summary Adds a sub-channel to the current channel.
 *
 * @param {String} name - New sub-channel name.
 */
Channel.prototype.addSubChannel = function( name, options ) {

    options = options || {};

    this.client.connection.sendMessage( 'ChannelState', {

        parent: this.id,
        name: name,
        temporary: !!options.temporary
    });
};

/**
 * @summary Removes the current channel.
 */
Channel.prototype.remove = function() {

    this.client.connection.sendMessage( 'ChannelRemove', {

        channel_id: this.id
    });
};

Channel.prototype.update = function(data) {
    // Check which events have to be emitted and what has to be updated
    if(data.name !== null) {
        this._checkRename(data);
    }
    if(data.linksAdd !== null || data.linksRemove !== null) {
        this._checkLinks(data);
    }
    if(data.parent !== null) {
        this._checkParent(data);
    }
    // Apply new properties
    // Done in check methods.
    //this._applyProperties(data);
};

/**
 * @summary Emitted when the channel permissions are updated.
 *
 * @description
 * Also available through the client `channel-permissions-update` event.
 *
 * @event Channel#permissions-update
 * @param {Permissions} permissions - The new permissions
 */
Channel.prototype.onPermissionQuery = function( query ) {
    this.permissions = util.readPermissions( query.permissions );
    this.emit( 'permissions-update', this.permissions );
};

Channel.prototype._checkRename = function(data) {
    if(data.name !== this.name) {
        this.emit("rename", this.name, data.name);
    }
    this.name = data.name;
};

/**
 * @summary Emitted when this channel is linked to new ones.
 *
 * @description
 * Also available through the client `channel-links-add` event.
 *
 * @event Channel#links-add
 * @param {Channel[]} newChannels - The newly linked channels.
 */

/**
 * @summary Emitted when channel links are removed.
 *
 * @description
 * Also available through the client `channel-links-remove` event.
 *
 * @event Channel#links-remove
 * @param {Channel[]} linksRemove - The removed channels.
 */

Channel.prototype._checkLinks = function(data) {
    if( data.linksAdd !== null ) {
        var newChannels = [];
        for( var la in data.linksAdd ) {
            var channel = this.client.channelById( data.linksAdd[ la ] );
            this.links.push( channel );
            newChannels.push( channel );
        }
        this.emit( "links-add", newChannels );
    }

    if( data.linksRemove !== null ) {
        var linksRemove = [];
        for( var lr in data.linksRemove ) {
            for( var l in this.links ) {
                var link = this.links[ l ];
                if( link.id === data.linksRemove[ lr ] ) {
                    linksRemove.push( link );
                    this.links.splice( l, 1 );
                    break;
                }
            }
        }
        this.emit( "links-remove", linksRemove );
    }
};

/**
 * @summary Emitted when the channel is moved in the channel hierarchy.
 *
 * @description
 * Also available through the client `channel-move` event.
 *
 * @event Channel#move
 * @param {Channel} oldParent - Old parent channel.
 * @param {Channel} newParent - New parent channel.
 */

Channel.prototype._checkParent = function(data) {
    if(this.parent) {
        if(this.parent.id !== data.parent) {
            this.parent._removeChild(this);
            var oldParent = this.parent;
            this.parent = this.client.channelById(data.parent);
            this.parent._addChild(this);
            this.emit("move", oldParent, this.parent);
        }
    }
    else {
        if(data.parent !== null) { // parent can be 0. Therefor we need to check for undefined
            // Root does not have parent :( poor root.
            this.parent = this.client.channelById(data.parent);
            this.parent._addChild(this);
        }
    }
};

Channel.prototype._applyProperties = function(data) {
    this.id = data.channel_id;
    this.name = data.name;
    for(var key in data.links) {
        var linkId = data.links[key];
        if(this.links.indexOf(linkId) === -1) {
            this.links.push(this.client.channelById(linkId));
        }
    }
    this.temporary = data.temporary;
    this.position = data.position;

    // Parent is handled in _checkParent as it is more complex
};

/**
 * @summary Emitted when the channel is removed from the channel tree.
 *
 * @descripion
 * Also available through the client `channel-remove` event.
 *
 * @event Channel#remove
 */

Channel.prototype._detach = function() {
    this.emit('remove');
    this.parent._removeChild(this);
};

Channel.prototype._addChild = function(channel) {
    this.children.push(channel);
};

Channel.prototype._removeChild = function(channel) {
    util.removeFrom( this.children, channel );
};

Channel.prototype._addUser = function(user) {
    this.users.push(user);
};

Channel.prototype._removeUser = function(user) {
    util.removeFrom( this.users, user );
};

module.exports = Channel;
