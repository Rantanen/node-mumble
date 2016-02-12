"use strict";

var tls = require('tls');
var mumbleutil = require('./lib/util');

var MumbleConnection = require('./lib/MumbleConnection');
var MumbleClient = require('./lib/MumbleClient');
var MumbleConnectionManager = require('./lib/MumbleConnectionManager');

exports.MumbleConnection = MumbleConnection;
exports.MumbleConnectionManager = MumbleConnectionManager;

exports.celtVersions = mumbleutil.celtVersions;
