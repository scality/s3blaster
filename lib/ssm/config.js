'use strict'; // eslint-disable-line strict

/*
   This config file hooks up to the vagrant virtual machines specified in
   the Vagrantfile. Useful for integration testing.
*/
const s3Config = require('../config.js').config;
const user = s3Config.acc.user;
const publicKey = s3Config.acc.publicKey;
const privateKey = s3Config.acc.privateKey;
const passphrase = s3Config.acc.passphrase;
const password = s3Config.acc.password;
const rate = s3Config.simul.rate;

const servers = s3Config.conn.servers.map((server, idx) => {
    return {
        name: `server${idx + 1}`,
        host: server,
        username: user,
        publicKey,
        privateKey,
        passphrase,
        password,
    };
});

exports.servers = servers;
exports.rate = rate; // ms
exports.poolSize = 10;
exports.maintainConnections = 5;
exports.logLevel = 'info';
