
"use strict";

var protobufjs = require('protobufjs');
var fs = require('fs');
var path = require('path');

var map = {
    0: 'Version',
    1: 'UDPTunnel',
    2: 'Authenticate',
    3: 'Ping',
    4: 'Reject',
    5: 'ServerSync',
    6: 'ChannelRemove',
    7: 'ChannelState',
    8: 'UserRemove',
    9: 'UserState',
    10: 'BanList',
    11: 'TextMessage',
    12: 'PermissionDenied',
    13: 'ACL',
    14: 'QueryUsers',
    15: 'CryptSetup',
    16: 'ContextActionModify',
    17: 'ContextAction',
    18: 'UserList',
    19: 'VoiceTarget',
    20: 'PermissionQuery',
    21: 'CodecVersion',
    22: 'UserStats',
    23: 'RequestBlob',
    24: 'ServerConfig',
    25: 'SuggestConfig'
};

var builder = protobufjs.loadProtoFile(path.join(__dirname, 'Mumble.proto'));
var mumble = builder.build('MumbleProto');
var messages = {};
var context = {schema: mumble};

module.exports.buildPacket = function (type, payload) {
    return new context.schema[type](payload || {});
};

module.exports.decodePacket = function (type_id, payload) {
    var type = map[type_id];
    return new context.schema[type].decode(payload || {});
};

module.exports.idByName = {};
module.exports.nameById = {};

for (var k in map) {
    module.exports.idByName[map[k]] = k * 1;
    module.exports.nameById[k] = map[k];
}