'use strict'; // eslint-disable-line strict

/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const s3Config = require('../../config.js').config;
const config = require('./config');
const statTypes = config.statTypes;

const servers = s3Config.conn.servers;
const latestStates = [];
servers.forEach(server => {
    latestStates[server] = [];
    Object.keys(statTypes).forEach(type => {
        latestStates[server][type] = 0;
    });
});

const mdSizes = [];
servers.forEach(server => {
    mdSizes[server] = new Array(2).fill(' ');
});

class StatsMonitor {
    /**
     * @param {object } sshPool - The pool of ssh connections
     * @param {float} [rate] - The rate at which to collect statistics.
     *  Defaults to 1000ms (every 1 second)
     * @constructor
     */
    constructor(sshPool, rate) {
        this.sshPool = sshPool;
        this.rate = rate;
        this.server = this.sshPool.options.host;

        if (!this.rate) {
            this.rate = 1000; // Every second
        }
    }

    monitors(type) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.monitors(type, (err, usage) => {
                    if (!err) {
                        latestStates[this.server][type.key] = usage;
                    }
                });
            }
        });
    }

    mdBktSize() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.mdBktSize((err, usage) => {
                    if (!err) {
                        latestStates[this.server].mdBktSize = usage;
                    }
                }, this.server);
            }
        });
    }

    mdAttrSize() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.mdAttrSize((err, usage) => {
                    if (!err) {
                        latestStates[this.server].mdAttrSize = usage;
                    }
                }, this.server);
            }
        });
    }

    mdLogSize() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.mdLogSize((err, usage) => {
                    if (!err) {
                        latestStates[this.server].mdLogSize = usage;
                    }
                }, this.server);
            }
        });
    }

    getMdLocation(cb) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
                return cb(err);
            }
            client.mdLocation(cb, this.server);
            return undefined;
        });
    }

    getInitSize(cb) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
                return cb(err);
            }
            client.mdSize((err, data) => {
                if (!err) {
                    mdSizes[this.server][0] = data;
                }
                return cb(err, mdSizes);
            }, this.server);
            return undefined;
        });
    }

    getCurrSize(cb) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
                return cb(err);
            }
            client.mdSize((err, data) => {
                if (!err) {
                    mdSizes[this.server][1] = data;
                }
                return cb(err, mdSizes);
            }, this.server);
            return undefined;
        });
    }

    genCmd(type) {
        if (type.monitor && type.pattern) {
            type.cmd =
                `COLUMNS=200 top -c -b -d1 -n1 | grep "${type.pattern}"|` +
                'awk \'{printf("';
            type.monitor.forEach((monitor, idx) => {
                type.cmd += '%s';
                if (idx === type.monitor.length - 1) {
                    type.cmd += ';';
                } else {
                    type.cmd += ':';
                }
            });
            type.cmd += '", ';
            type.monitor.forEach((monitor, idx) => {
                type.cmd += `int($${monitor.column})`;
                if (idx === type.monitor.length - 1) {
                    type.cmd += ');}\'';
                } else {
                    type.cmd += ',';
                }
            });
        }
    }

    start() {
        this.intervalObjects = [];
        Object.keys(statTypes).forEach(type => {
            if (statTypes[type].pattern) {
                this.genCmd(statTypes[type]);
                this.intervalObjects.push(setInterval(this.monitors.bind(this),
                                            this.rate, statTypes[type]));
            }
        });
    }

    stop() {
        this.intervalObjects.map(obj => clearInterval(obj));
    }

    getInitMDSize(cb) {
        this.getMdLocation(err => {
            if (err) {
                return cb(err);
            }
            const functions = [];
            // start monitoring MD size if location of MD is successful obtained
            Object.keys(statTypes).forEach(type => {
                if (type === 'mdBktSize') {
                    functions.push(this.mdBktSize.bind(this));
                } else if (type === 'mdAttrSize') {
                    functions.push(this.mdAttrSize.bind(this));
                } else if (type === 'mdLogSize') {
                    functions.push(this.mdLogSize.bind(this));
                }
            });
            functions.forEach(f => {
                this.intervalObjects.push(setInterval(f, this.rate));
            });
            return this.getInitSize(cb);
        });
    }

    calculateMDSize(cb) {
        this.getCurrSize(cb);
    }
}

exports.StatsMonitor = StatsMonitor;
exports.latestStates = latestStates;
