'use strict'; // eslint-disable-line strict

/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const s3Config = require('../../config.js').config;
const _monitors = s3Config.simul.monitors;
const config = require('./config');
const statTypes = config.statTypes;
const typesNb = Object.keys(statTypes).length;

const servers = s3Config.conn.servers;
const serversNb = servers.length;

const latestStates = new Array(serversNb * typesNb).fill(' ');
const mdSizes = new Array(serversNb).fill(' ').map(() =>
                                                        new Array(2).fill(' '));

function getData(ssmType, hostIdx, data) {
    if (hostIdx < 0) {
        return;
    }
    latestStates[hostIdx * typesNb + Object.keys(statTypes).indexOf(ssmType)] =
        data;
}

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
        this.serverIdx = servers.indexOf(this.sshPool.options.host);

        if (!this.rate) {
            this.rate = 1000; // Every second
        }
    }

    swapUsed() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.swapUsedPercentage((err, swapUsed) => {
                    if (err) process.stderr.write(`error: ${err}\n`);
                    else {
                        getData('swapUsed', this.serverIdx, swapUsed);
                    }
                });
            }
        });
    }

    load() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.cpuUsage((err, usage) => {
                    if (err) process.stderr.write(`error: ${err}\n`);
                    else {
                        getData('cpuUsage', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    memoryUsed() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.memoryUsed((err, usage) => {
                    if (!err) {
                        getData('memoryUsed', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    repdMap() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.repdMap((err, usage) => {
                    if (!err) {
                        getData('repdMap', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    bucketd() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.bucketd((err, usage) => {
                    if (!err) {
                        getData('bucketd', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    repd() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.repd((err, usage) => {
                    if (!err) {
                        getData('repd', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    supervisord() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.supervisord((err, usage) => {
                    if (!err) {
                        getData('supervisord', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    vaultd() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.vaultd((err, usage) => {
                    if (!err) {
                        getData('vaultd', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    s3() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.s3((err, usage) => {
                    if (!err) {
                        getData('s3', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    ioStat() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.ioStat((err, usage) => {
                    if (!err) {
                        getData('ioStat', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    ironman() {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.ironman((err, usage) => {
                    if (!err) {
                        getData('ironman', this.serverIdx, usage);
                    }
                });
            }
        });
    }

    monitors(type) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
            } else {
                client.monitors(type, (err, usage) => {
                    if (!err) {
                        getData(type, this.serverIdx, usage);
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
                        getData('mdBktSize', this.serverIdx, usage);
                    }
                }, this.serverIdx);
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
                        getData('mdAttrSize', this.serverIdx, usage);
                    }
                }, this.serverIdx);
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
                        getData('mdLogSize', this.serverIdx, usage);
                    }
                }, this.serverIdx);
            }
        });
    }

    getMdLocation(cb) {
        this.sshPool.oneShot((err, client) => {
            if (err) {
                process.stderr.write(`error: ${err}\n`);
                return cb(err);
            }
            client.mdLocation(cb, this.serverIdx);
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
                    mdSizes[this.serverIdx][0] = `${data}`;
                }
                return cb(err, mdSizes);
            }, this.serverIdx);
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
                    mdSizes[this.serverIdx][1] = `${data}`;
                }
                return cb(err, mdSizes);
            }, this.serverIdx);
            return undefined;
        });
    }


    start() {
        const functions = [];
        Object.keys(statTypes).forEach(type => {
            if (type === 'swapUsed') {
                functions.push(this.swapUsed.bind(this));
            } else if (type === 'cpuUsage') {
                functions.push(this.load.bind(this));
            } else if (type === 'memoryUsed') {
                functions.push(this.memoryUsed.bind(this));
            } else if (type === 'repdMap') {
                functions.push(this.repdMap.bind(this));
            } else if (type === 'bucketd') {
                functions.push(this.bucketd.bind(this));
            } else if (type === 'repd') {
                functions.push(this.repd.bind(this));
            } else if (type === 'supervisord') {
                functions.push(this.supervisord.bind(this));
            } else if (type === 'vaultd') {
                functions.push(this.vaultd.bind(this));
            } else if (type === 's3') {
                functions.push(this.s3.bind(this));
            } else if (type === 'ironman') {
                functions.push(this.ironman.bind(this));
            } else if (type === 'ioStat') {
                functions.push(this.ioStat.bind(this));
            }
        });
        this.intervalObjects = functions.map(f => setInterval(f, this.rate));
        if (_monitors) {
            _monitors.split(',').forEach(type => {
                this.intervalObjects.push(setInterval(this.monitors.bind(this),
                                            this.rate, type));
            });
        }
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
            // start monitoring MD size
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
exports.mdSizes = mdSizes;
