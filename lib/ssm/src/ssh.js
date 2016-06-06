'use strict'; // eslint-disable-line strict

/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const Connection = require('ssh2').Client;
const _ = require('underscore');

const s3Config = require('../../config.js').config;
const servers = s3Config.conn.servers;

let monitorPatterns = s3Config.simul.monitors;
if (monitorPatterns) {
    monitorPatterns = monitorPatterns.split(',');
}

// for calculating metadata size
const mdInfo = {
    bucketsList: [],
    bucketsPath: new Array(servers.length).fill(' '),
    bucketsCommonPath: [],
};

const memInfoKey = {
    MemTotal: 'MemTotal',
    MemFree: 'MemFree',
    Cached: 'Cached',
    SwapTotal: 'SwapTotal',
    SwapFree: 'SwapFree',
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
    /**
     * Prints /proc/meminfo to stdout and parses it into a dictionary.
     * @param {function} callback - cb
     * @return {this} this
     */
    memoryInfo(callback) {
        this.execute.bind(this)('cat /proc/meminfo', (err, data) => {
            if (err && callback) {
                callback(err, null);
            } else {
                // let kv = _.map(data.split('\n'), x => x.split(':'));
                let kv = data.split('\n').map(x => x.split(':'));
                kv.pop(); // Remove spurious last val.
                kv = kv.map(x => {
                    const key = x[0];
                    let val = x[1];
                    if (val) {
                        val = val.trim();
                        if (val.indexOf('kB') !== -1) {
                            val = val.substring(0, val.length - 3);
                        }
                        val = parseInt(val, 10);
                    }
                    return [key, val];
                });
                const info = kv.reduce((memo, x) => {
                    memo[x[0]] = x[1];
                    return memo;
                }, {});
                if (callback) callback(null, info);
            }
        });
    }

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
     * Return the percentage disk space used on mount being used at path
     * @param {string} path - path
     * @param {function} callback - cb
     * @return {this} this
     */
    getPercentageUsed(path, callback) {
        const cmd = `df ${path} -h | tail -n 1`;
        this.execute.bind(this)(cmd, (err, data) => {
            if (err && callback) callback(err, null);
            else {
                const percentageString = data.match(/\S+/g)[4];
                const percUsed = parseFloat(percentageString.substring(0,
                                            percentageString.length - 1)) / 100;
                if (callback) callback(null, percUsed);
            }
        });
    }

    /**
     * Extract server's stats send to ssh
     * @param{string} input: is a string of temple: x1,y1;x2,y2;... where
     *     xi, yi corresponds to values of 'resident size' and '%cpu' columns
     * @param{boolen} sum: second result will be sum instead of max
     * @return{array} res: res[0] sum of using memory,
     *                     res[1] max or sum of %cpu usage
     */
    extratInfo(input, sum) {
        if (!input) return [0, 0];
        const arr = input.slice(0, input.length - 1).split(';').map(val =>
                                val.split(','));
        const res = [0, 0];
        arr.forEach(val => {
            if (val[0][val[0].length - 1] === 'g') {
                res[0] +=
                    Number(val[0].slice(0, val[0].length - 1)) * 1024 * 1024;
            } else if (val[0][val[0].length - 1] === 'm') {
                res[0] += Number(val[0].slice(0, val[0].length - 1)) * 1024;
            } else {
                res[0] += Number(val[0]);
            }
            if (!sum) {
                res[1] = Math.max(res[1], Number(val[1]));
            } else {
                res[1] += Number(val[1]);
            }
        });
        return ` ${toFixedLength((res[0] / 1024).toFixed(0), 12, 'left')}` +
               `${toFixedLength(res[1].toFixed(0), 6)} `;
    }

    percentageUsed(path, callback) {
        this.getPercentageUsed.bind(this)(path, callback);
    }

    percentageFree(path, callback) {
        this.getPercentageUsed.bind(this)(path, (error, percentageUsed) => {
            callback(error, percentageUsed ? 1 - percentageUsed : null);
        });
    }

    /**
     * Get percentage swap used as a float
     * @param {function} callback - cb
     * @return {this} this
     */
    swapUsedPercentage(callback) {
        this.memoryInfo((err, info) => {
            if (err && callback) {
                callback(err, null);
            } else {
                if (callback) {
                    const swapFree = info[memInfoKey.SwapFree];
                    const swapTotal = info[memInfoKey.SwapTotal];
                    callback(null, swapTotal ?
                        (swapFree / swapTotal).toFixed(3) : 0);
                }
            }
        });
    }

    /**
     * Get percentage swap used as a float
     * @param {function} callback - cb
     * @return {this} this
     */
    memoryUsed(callback) {
        this.memoryInfo((err, info) => {
            if (err && callback) callback(err, null);
            else {
                const memoryFree = info[memInfoKey.MemFree];
                const cached = info[memInfoKey.Cached];
                const realFree = memoryFree + cached;
                const perc = (realFree / info[memInfoKey.MemTotal]).toFixed(3);
                if (callback) callback(null, perc);
            }
        });
    }

    /**
     * Takes average load over 1 minute, 5 minutes and 15 minutes from uptime
     * command
     * @param {functon} callback - cb
     * @return {this} this
     */
    averageLoad(callback) {
        this.execute.bind(this)('uptime', (err, data) => {
            if (err) callback(err, data);
            else {
                let averages = data.split('load average:');
                averages = averages[averages.length - 1].trim().split(' ');
                averages = {
                    1: parseFloat(averages[0]),
                    5: parseFloat(averages[1]),
                    15: parseFloat(averages[2]),
                };
                callback(null, averages);
            }
        });
    }

    cpuUsage(callback) {
        const cmd = 'top -b -d1 -n1|grep -i "Cpu(s)"|head -c21|' +
                    'cut -d \' \' -f3|cut -d \'%\' -f1';
        this.execute.bind(this)(cmd, (err, data) => {
            if (callback) callback(err, parseFloat(data));
        });
    }

    repdMap(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "RepdServerMap"|' +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    bucketd(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "bucketd"|' +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    repd(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "repd"|' +
            'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    supervisord(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "supervisord"|' +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    vaultd(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "vaultd"|' +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    s3(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep "S3"|' +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    ioStat(callback) {
        const cmd = 'iostat -x -d| grep "sd"| awk \'{ printf("%s ", $14); }\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, data.slice(1));
            }
            return callback(err);
        });
    }

    ironman(callback) {
        const cmd = 'COLUMNS=200 top -c -b -d1 -n1 | grep ' +
            '"S3\\|Vault\\|MetaData\\|repd\\|bucketd\\|RepdServerMap\\|' +
            'vaultd"|awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            if (data) {
                return callback(err, this.extratInfo(data, 'sum'));
            }
            return callback(err);
        });
    }

    monitors(type, callback) {
        const cmd = `COLUMNS=200 top -c -b -d1 -n1 | grep "${type}"|` +
                    'awk \'{printf("%s,%s;", $6, $9);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
            // console.log(`${cmd}: ${data}`);
            if (data) {
                return callback(err, this.extratInfo(data));
            }
            return callback(err);
        });
    }

    mdSize(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[serverIdx];

        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}${bucket} ` +
                   `${bucketsPath[bktIdx]}dbAttributes ` +
                   `${bucketsPath[bktIdx]}sdb ` +
                   `${bucketsPath[bktIdx]}stdb `;
        });
        cmd += '| awk \'{printf("%s,", $1);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
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

    mdBktSize(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[serverIdx];

        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}${bucket} `;
        });
        cmd += '| awk \'{printf("%s,", $1);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
        // console.log(`${servers[serverIdx]}:mdBktSize: ${cmd} => ${data}`);
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

    mdAttrSize(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[serverIdx];

        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}dbAttributes `;
        });
        cmd += '| awk \'{printf("%s,", $1);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
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

    mdAttrSize(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[serverIdx];

        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}dbAttributes `;
        });
        cmd += '| awk \'{printf("%s,", $1);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
        // console.log(`${servers[serverIdx]}:mdAttrSize: ${cmd} => ${data}`);
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

    mdLogSize(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsPath[serverIdx];

        let cmd = 'du -s -B KB ';
        bucketsList.forEach((bucket, bktIdx) => {
            cmd += `${bucketsPath[bktIdx]}sdb ` +
                   `${bucketsPath[bktIdx]}stdb `;
        });
        cmd += '| awk \'{printf("%s,", $1);}\'';
        this.execute.bind(this)(cmd, (err, data) => {
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

    mdLocation(callback, serverIdx) {
        const bucketsList = mdInfo.bucketsList;
        const bucketsPath = mdInfo.bucketsCommonPath[serverIdx];

        let cmd = '';
        bucketsList.forEach(bucket => {
            cmd += `find ${bucketsPath} -name ${bucket} ; `;
        });
        this.execute.bind(this)(cmd, (err, data) => {
// console.log(`${servers[serverIdx]}:mdLocation: ${err}, ${cmd} => ${data}`);
            if (data) {
                mdInfo.bucketsPath[serverIdx] =
                    data.slice(1, data.length - 1).split('\n\n').map(val => {
                        const lastSlashIdx = data.lastIndexOf('/') || 0;
                        return val.slice(0, lastSlashIdx);
                    });
            }
            return callback(err);
        });
    }
}

exports.SSHConnection = SSHConnection;
exports.memInfoKey = memInfoKey;
exports.mdInfo = mdInfo;
