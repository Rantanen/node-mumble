
"use strict";

var Schema = require('protobuf').Schema;
var fs = require('fs');

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

var mumble = new Schema(fs.readFileSync( __dirname + '/mumble.desc'));
var messages = {};

var getSchema = function (name) {
    var schema = mumble['MumbleProto.' + name];
    messages[name] = schema;
    return schema;
};

module.exports.schemaById = {};
module.exports.schemaByName = {};
module.exports.idByName = {};
module.exports.nameById = {};

for (var k in map) {
    var schema = getSchema(map[k]);
    module.exports.schemaById[k] = schema;
    module.exports.schemaByName[map[k]] = schema;
    module.exports.idByName[map[k]] = k * 1;
    module.exports.nameById[k] = map[k];
}

