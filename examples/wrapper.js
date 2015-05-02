"use strict";

var mumble = require('../');
var fs = require('fs');

var options = {
    key: fs.readFileSync( 'private.pem' ),
    cert: fs.readFileSync( 'public.pem' )
}

var tree = "";

function buildChannelTree(channel, level) {
    for(var i = 0; i < level; i++) {
        tree += "   ";
    }
    tree += "  - " + channel.name + ": ";
    for(var key in channel.users) {
        var user = channel.users[key];
        tree += user.name + ", "
    }
    tree += "\n";
    for(var key in channel.children) {
        buildChannelTree(channel.children[key], level + 1);
    }
}

console.log( 'Connecting' );
mumble.connect( process.env.MUMBLE_URL, options, function ( error, connection ) {
    if(error) { throw new Error(error); }
    console.log('Connected');
    connection.on('ready', function() {
        console.log("Ready!");
        buildChannelTree(connection.rootChannel, 0);
        console.log(tree);
        console.log("Those were all channels!");
        console.log("Users:");
        var list = connection.users();
        for(var key in list) {
            var user = list[key];
            console.log("  - " + user.name + " in channel " + user.channel.name);
        }
        console.log("\nThose were all users!");
    });
    connection.on('channel-move', function(channel, from, to) {
        console.log("Channel " + channel.name + " was moved from " + from.name + " to " + to.name);
    });
    connection.on('channel-links-add', function(channel, links) {
        for(var key in links) {
            console.log("Channel " + links[key].name + " was linked to " + channel.name);
        }
    });
    connection.on('channel-links-remove', function(channel, links) {
        for(var key in links) {
            console.log("Channel " + links[key].name + " was unlinked from " + channel.name);
        }
    });
    connection.on('channel-rename', function(channel, oldName, newName) {
        console.log("Channel " + oldName + " was renamed to " + newName);
    });
    connection.on('user-mute', function(user, muted) {
        console.log("User " + user.name + " changed mute to: " + muted);
    });
    connection.on('user-self-deaf', function(user, deaf) {
        console.log("User " + user.name + " changed deaf to: " + deaf);
    });
    connection.on('user-self-mute', function(user, muted) {
        console.log("User " + user.name + " changed self-mute to: " + muted);
    });
    connection.on('user-suppress', function(user, suppress) {
        console.log("User " + user.name + " changed suppress to: " + suppress);
    });
    connection.on('user-move', function(user, fromChannel, toChannel) {
        console.log("User " + user.name + " moved from channel " + fromChannel.name + " to " + toChannel.name);
    });
    connection.on('user-disconnect', function(user) {
        console.log("User " + user.name + " disconnected");
    });
    connection.on('user-connect', function(user) {
        console.log("User " + user.name + " connected");
    });
    connection.on('channel-create', function(channel) {
        console.log("Channel " + channel.name + " created");
    });
    connection.on('channel-remove', function(channel) {
        console.log("Channel " + channel.name + " removed");
    });
    connection.on('message', function(message, actor) {
        actor.sendMessage("I received: '" + message + "'");
        connection.user.channel.sendMessage("I received: '" + message + "'");
    });
    connection.authenticate('ExampleUser');
});
