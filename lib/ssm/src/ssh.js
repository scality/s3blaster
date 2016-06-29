'use strict'; // eslint-disable-line strict

/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const Connection = require('ssh2').Client;
const _ = require('underscore');

const s3Config = require('../../config').config;
const servers = s3Config.conn.servers;
const config = require('./config');
const statOutput = config.statOutput;
const methods = config.methods;

const bucketsPath = [];
servers.forEach(server => {
    bucketsPath[server] = ' ';
});

const mdCmd = [];
servers.forEach(server => {
    mdCmd[server] = [];
    mdCmd[server].mdSize = '';
    mdCmd[server].mdBktSize = '';
    mdCmd[server].mdAttrSize = '';
    mdCmd[server].mdLogSize = '';
});

// for calculating metadata size
const mdInfo = {
    bucketsList: [],
    bucketsPath,
    bucketsCommonPath: [],
    mdCmd,
};

/**
 * stringify to a given length
 * @param {number/string} value: input variable
 * @param {number} length: desired output length
 * @param {string} align: align output string
 * @return {string} string of at least given length
 */
function toFixedLength(value, length, align) {
    if (align === 'center') {
        return (value.toString().length < length) ?
                            toFixedLength(` ${value} `, length, align) : value;
    } else if (align === 'left') {
        return (value.toString().length < length) ?
                            toFixedLength(`${value} `, length, align) : value;
    }
    return (value.toString().length < length) ?
                        toFixedLength(` ${value}`, length, align) : value;
}

/**
 * Extends Connection with standard operations over ssh.
 * @param {object} opts - opts
 * @constructor
 */
class SSHConnection extends Connection {
    execute(execStr, callback) {
        this.exec(execStr, (err, stream) => {
            if (err && callback) {
                callback(err); return;
            }
            let stderr = '';
            let stdout = '';
            let exitCode = 0;
            let streamEnded = false;
            const respond = _.once(() => {
                const exitWithErrorCode = exitCode === 1;
                const noOutput = stdout.length === 0;
                const isErrorState = exitWithErrorCode || noOutput;
                if (isErrorState) {
                    if (!stderr.length) {
                        stderr = 'Unknown Error (No stderr or stdout received)';
                    }
                    if (callback) callback(stderr, null);
                } else {
                    if (callback) callback(null, stdout);
                }
            });
            stream.on('data', (data, extended) => {
                const result = data.toString();
                if (extended === 'stderr') {
                    stderr = `${stderr}\n${result}`;
                } else {
                    stdout = `${stdout}\n${result}`;
                }
            });
            stream.on('error', () => {
                exitCode = 1;
            });
            stream.on('end', () => {
                streamEnded = true;
                respond();
            });
            stream.on('exit', () => {
                if (streamEnded) respond();
            });
        });
    }

    /**
     * Extract server's stats send to ssh
     * @param{string} input: is a string of temple: x1,y1;x2,y2;... where
     *     xi, yi corresponds to values of 'resident size' and '%cpu' columns
     * @param{array} monitor: array of patterns to be monitored
     * @return{array} res: res[0] sum of using memory,
     *                     res[1] max or sum of %cpu usage
     */
    extratInfo(input, monitor) {
        if (!input) return new Array(monitor.length).fill(0);
        const arr = input.slice(1, input.length - 1).split(';').map(val =>
                                val.split(':'));
        const res = new Array(monitor.length).fill(0);
        let output = '';
        arr.forEach(stat => {
            stat.forEach((val, idx) => {
                if (monitor[idx].statOutput === statOutput.MEM) {
                    if (val[val.length - 1] === 'g') {
                        res[idx] +=
                            Number(val.slice(0, val.length - 1)) * 1024;
                    } else if (val[val.length - 1] === 'm') {
                        res[idx] += Number(val.slice(0, val.length - 1));
                    } else {
                        res[idx] += Number(val) / 1024;
                    }
                } else {
                    if (monitor[idx].method === methods.MAX) {
                        res[idx] = Math.max(res[idx], Number(val));
                    } else {
                        res[idx] += Number(val);
                    }
                }
            });
        });
        monitor.forEach((mon, idx) => {
            if (mon.statOutput === statOutput.MEM) {
                output +=
                    ` ${toFixedLength(res[idx].toFixed(0), 10)} `;
            } else {
                output += ` ${toFixedLength(res[idx].toFixed(0), 6, 'left')} `;
            }
        });
        return output;
    }

    monitors(type, callback) {
        this.execute.bind(this)(type.cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data, type.monitor));
            }
            return callback(err);
        });
    }

    mdSize(callback, server) {
        this.execute.bind(this)(mdInfo.mdCmd[server].mdSize, (err, data) => {
            if (data) {
                const arr = data.slice(0, data.length - 1).split(',');
                let res = 0;
                arr.forEach(val => {
                    res += Number(val.slice(0, val.length - 2));
                });
                return callback(err, res);
            }
            return callback(err);
        });
    }

    mdBktSize(callback, server) {
        this.execute.bind(this)(mdInfo.mdCmd[server].mdBktSize, (err, data) => {
        // console.log(`${servers[server]}:mdBktSize: ${cmd} => ${data}`);
            if (data) {
                const arr = data.slice(0, data.length - 1).split(',');
                let res = 0;
                arr.forEach(val => {
                    res += Number(val.slice(0, val.length - 2));
                });
                return callback(err, res);
            }
            return callback(err);
        });
    }

    mdAttrSize(callback, server) {
        this.execute.bind(this)(mdInfo.mdCmd[server].mdAttrSize,
            (err, data) => {
            // console.log(`${servers[server]}:mdAttrSize: ${cmd} => ${data}`);
                if (data) {
                    const arr = data.slice(0, data.length - 1).split(',');
                    let res = 0;
                    arr.forEach(val => {
                        res += Number(val.slice(0, val.length - 2));
                    });
                    return callback(err, res);
                }
                return callback(err);
            });
    }

    mdLogSize(callback, server) {
        this.execute.bind(this)(mdInfo.mdCmd[server].mdLogSize, (err, data) => {
            if (data) {
                const arr = data.slice(0, data.length - 1).split(',');
                let res = 0;
                arr.forEach(val => {
                    res += Number(val.slice(0, val.length - 2));
                });
                return callback(err, res);
            }
            return callback(err);
        });
    }

    genMdCmd(server) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[server];

        // for mdSize
        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}/${bucket} ` +
                   `${bucketsPath[bktIdx]}/dbAttributes ` +
                   `${bucketsPath[bktIdx]}/sdb ` +
                   `${bucketsPath[bktIdx]}/stdb `;
        });
        cmd += '| awk \'{printf("%s:", int($1));}\'';
        mdInfo.mdCmd[server].mdSize = cmd;

        // for mdBktSize
        cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}/${bucket} `;
        });
        cmd += '| awk \'{printf("%s:", int($1));}\'';
        mdInfo.mdCmd[server].mdBktSize = cmd;

        // for mdAttrSize
        cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}/dbAttributes `;
        });
        cmd += '| awk \'{printf("%s:", int($1));}\'';
        mdInfo.mdCmd[server].mdAttrSize = cmd;

        // for mdLogSize
        cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}/sdb ` +
                   `${bucketsPath[bktIdx]}/stdb `;
        });
        cmd += '| awk \'{printf("%s:", int($1));}\'';
        mdInfo.mdCmd[server].mdLogSize = cmd;
    }

    mdLocation(callback, server) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsCommonPath[server];

        let cmd = '';
        bucketsList.forEach(bucket => {
            cmd += `find ${bucketsPath} -name ${bucket} ; `;
        });
        this.execute.bind(this)(cmd, (err, data) => {
            // console.log(`${server}:mdLocation: ${err}, ${cmd} => ${data}`);
            if (data) {
                mdInfo.bucketsPath[server] =
                    data.slice(1, data.length - 1).split('\n\n').map(val => {
                        const lastSlashIdx = val.lastIndexOf('/');
                        return val.slice(0, lastSlashIdx);
                    });
                this.genMdCmd(server);
            }
            return callback(err);
        });
    }
}

exports.SSHConnection = SSHConnection;
exports.mdInfo = mdInfo;
