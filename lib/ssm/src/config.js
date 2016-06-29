'use strict'; // eslint-disable-line strict

/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

/**
 * Takes the root config and extends with internal configuration
 * and add some massaging.
 */

const s3Config = require('../../config.js').config;
const config = require('../config');
const _ = require('underscore');
const fs = require('fs');

(() => {
    _.defaults(exports, config); // Import the root configuration.

    _.defaults(exports, { // Fill in the gaps
        servers: [],
        rate: s3Config.simul.rate,
        logLevel: 'info',
    });

    exports.serverDefaults = {
        name: null,
        host: null,
        port: null,
    };

    /*
     * Merge with the default server options and read any private/public key
     * files.
     */
    function processServers() {
        exports.servers.forEach(server => {
            _.defaults(server, exports.serverDefaults);
            if (server.hasOwnProperty('privateKey')) {
                try {
                    server.privateKey = // eslint-disable-line
                                fs.readFileSync(server.privateKey).toString();
                } catch (err) {
                    process.stderr.write(`Unable to load private key at
                        ${server.privateKey} ${err}`);
                    server.privateKey = ''; // eslint-disable-line
                }
            }
            if (server.hasOwnProperty('publicKey')) {
                try {
                    server.publicKey =  // eslint-disable-line
                                fs.readFileSync(server.publicKey).toString();
                } catch (err) {
                    process.stderr.write(`Unable to load public key at
                        ${server.publicKey} ${err}`);
                    server.publicKey = ''; // eslint-disable-line
                }
            }
        });
    }

    if (s3Config.simul.ssm) {
        processServers();
    }

    // statOutput's columns for appropriated purpose
    const cols = {
        MEM: 6,
        CPU: 9,
        MD: 1,
        IOSTAT: 14,
    };
    const methods = {
        MAX: 'max',
        SUM: 'sum',
    };
    const statOutput = {
        CPU: 'percent',
        MEM: 'byte',
    };

    const statTypes = {
        s3: {
            key: 's3',
            name: 's3 [CPU(%) MEM(MB)]',
            pattern: '/usr/bin/node /home/scality/S3/index.js',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of S3 (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of S3 (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        vaultd: {
            key: 'vaultd',
            name: 'vaultd [CPU(%) MEM(MB)]',
            pattern: '/usr/bin/node /home/scality/Vault/vaultd.js',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of vaultd (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of vaultd (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        bucketd: {
            key: 'bucketd',
            name: 'bucketd [CPU(%) MEM(MB)]',
            pattern: '/usr/bin/node /home/scality/MetaData/bin/bucketd.js',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of bucketd (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of bucketd (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        repdMap: {
            key: 'repdMap',
            name: 'RepdServerMap [CPU(%) MEM(MB)]',
            pattern: 'RepdServerMap',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of RepdServerMap (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of RepdServerMap (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        repd: {
            key: 'repd',
            name: 'repd [CPU(%) MEM(MB)]',
            pattern: 'node bin/repd.js',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of repd (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of repd (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        sproxyd: {
            key: 'sproxyd',
            name: 'sproxyd [CPU(%) MEM(MB)]',
            pattern: '/usr/local/bin/sproxyd',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of sproxyd (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of sproxyd (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        nginx: {
            key: 'nginx',
            name: 'nginx [CPU(%) MEM(MB)]',
            pattern: 'nginx',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of nginx (for sproxyd) (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of nginx (for sproxyd) (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        supervisord: {
            key: 'supervisord',
            name: 'supervisord [CPU(%) MEM(MB)]',
            pattern: '/usr/bin/python /usr/local/bin/supervisord',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of supervisord (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of supervisord (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        filebeat: {
            key: 'filebeat',
            name: 'filebeat [CPU(%) MEM(MB)]',
            pattern: '/usr/bin/filebeat',
            monitor: [
                {
                    column: cols.CPU,
                    method: methods.MAX,
                    description: 'max cpu usage of filebeat (%)',
                    statOutput: statOutput.CPU,
                },
                {
                    column: cols.MEM,
                    method: methods.SUM,
                    description: 'total using RAM of filebeat (MB)',
                    statOutput: statOutput.MEM,
                },
            ],
        },
        mdBktSize: {
            key: 'mdBktSize',
            name: 'metastore size (KB)',
            pattern: '',
            monitor: [
                {
                    column: cols.MD,
                    method: methods.SUM,
                    description: 'total size of metastores (KB)',
                },
            ],
        },
        mdLogSize: {
            key: 'mdLogSize',
            name: 'meta log size (KB)',
            pattern: '',
            monitor: [
                {
                    column: cols.MD,
                    method: methods.SUM,
                    description: 'total size of metadata log files (KB)',
                },
            ],
        },
    };

    let availStatTypes = {};
    if (s3Config.simul.ssmTypes === 'all') {
        availStatTypes = statTypes;
    } else {
        const types = s3Config.simul.ssmTypes.split(',');
        types.forEach(type => {
            if (Object.keys(statTypes).indexOf(type) > -1) {
                availStatTypes[type] = statTypes[type];
            }
        });
    }
    if (s3Config.simul.monitors) {
        s3Config.simul.monitors.split(',').forEach(type => {
            if (!availStatTypes[type]) {
                availStatTypes[type] = {
                    key: `${type}`,
                    name: `${type} [CPU(%) MEM(MB)]`,
                    pattern: type,
                    monitor: [
                        {
                            column: cols.CPU,
                            method: methods.MAX,
                            description: `max cpu usage of ${type} (%)`,
                            statOutput: statOutput.CPU,
                        },
                        {
                            column: cols.MEM,
                            method: methods.SUM,
                            description: `total using RAM of ${type} (MB)`,
                            statOutput: statOutput.MEM,
                        },
                    ],
                };
            }
        });
    }

    exports.statTypes = availStatTypes;
    exports.statOutput = statOutput;
    exports.methods = methods;
    exports.timeouts = {
        acquisition: 10000,
    };
})();
