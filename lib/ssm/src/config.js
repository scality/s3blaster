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
     * Merge with the default server options and read any private key files.
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

    processServers();

    const statTypes = {
        repdMap: ['total using RAM of RepdServerMap (MB)',
                  'max cpu usage of RepdServerMap (%)'],
        bucketd: ['total using RAM of bucketd (MB)',
                  'max cpu usage of bucketd (%)'],
        repd: ['total using RAM of repd (MB)',
               'cpu usage of repd (%)'],
        supervisord: ['total using RAM of supervisord (MB)',
                      'cpu usage of supervisord (%)'],
        vaultd: ['total using RAM of vaultd (MB)',
                 'cpu usage of vaultd (%)'],
        s3: ['total using RAM of S3 (MB)',
             'max cpu usage of S3 (%)'],
        ironman: ['total using RAM of S3, MetaData, Vault processes (MB)',
                  'total cpu usage of S3, MetaData, Vault processes(%)'],
        mdBktSize: '[Metadata] total size of metastores (KB)',
        // mdAttrSize: '[Metadata]total size of dbAttributes (KB)',
        mdLogSize: '[Metadata] total size of log files (KB)',
        // ioStat: 'utilisation of ssd devices (%)',
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
                availStatTypes[type] = [`total using RAM of ${type}`,
                                        `max cpu usage of ${type}`];
            }
        });
    }

    exports.statTypes = availStatTypes;

    exports.timeouts = {
        acquisition: 1000,
    };
})();
