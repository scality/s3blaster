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
            pattern: 'S3/index.js',
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
        s3Config.simul.monitors.forEach(type => {
            const obj = type.split(':');
            const name = (obj.length > 0) ? obj[0] : undefined;
            const pattern = (obj.length > 1) ? obj[1] : obj[0];
            if (name) {
                availStatTypes[name] = {
                    key: `${name}`,
                    name: `${name} [CPU(%) MEM(MB)]`,
                    pattern,
                    monitor: [
                        {
                            column: cols.CPU,
                            method: methods.MAX,
                            description: `max cpu usage of ${name} (%)`,
                            statOutput: statOutput.CPU,
                        },
                        {
                            column: cols.MEM,
                            method: methods.SUM,
                            description: `total using RAM of ${name} (MB)`,
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
