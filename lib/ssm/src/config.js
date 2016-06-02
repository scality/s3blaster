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
const Winston = require('winston');
const _ = require('underscore');
const fs = require('fs');

Winston.level = 'info';

(() => {
    _.defaults(exports, config); // Import the root configuration.

    _.defaults(exports, { // Fill in the gaps
        servers: [],
        rate: s3Config.simul.rate,
        poolSize: 10,
        maintainConnections: 2,
        logLevel: 'info',
    });

    exports.serverDefaults = {
        name: null,
        host: null,
        port: null,
    };

    const Logger = new (Winston.Logger)({
        levels: {
            verbose: 0,
            trace: 1,
            debug: 2,
            info: 3,
            warn: 4,
            error: 5,
            fatal: 6,
        },
        colors: {
            verbose: 'grey',
            trace: 'white',
            debug: 'green',
            info: 'green',
            warn: 'yellow',
            error: 'red',
            fatal: 'red',
        },
        transports: [
            new (Winston.transports.Console)({
                json: false,
                timestamp: true,
                level: exports.logLevel,
                prettyPrint: true,
                colorize: true,
                silent: false,
            }),
        ],
        exitOnError: false,
    });

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
                    Logger.error(`Unable to load private key at
                        ${server.privateKey} ${err}`);
                    server.privateKey = ''; // eslint-disable-line
                }
            }
            if (server.hasOwnProperty('publicKey')) {
                try {
                    server.publicKey =  // eslint-disable-line
                                fs.readFileSync(server.publicKey).toString();
                } catch (err) {
                    Logger.error(`Unable to load public key at
                        ${server.publicKey} ${err}`);
                    server.publicKey = ''; // eslint-disable-line
                }
            }
        });
    }

    processServers();

    exports.logger = Logger;

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
        s3: ['total using RAM of IronMan-S3 (MB)',
             'max cpu usage of IronMan-S3 (%)'],
        ioStat: 'utilisation of ssd devices (%)',
        ironman: ['total using RAM of IronMan processes (MB)',
                  'total cpu usage of IronMan processes(%)'],
        mdBktSize: '[Metadata] total size of metastores (KB)',
        // mdAttrSize: '[Metadata]total size of dbAttributes (KB)',
        mdLogSize: '[Metadata]total size of log files (KB)',
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
                                        `total cpu usage of ${type}`];
            }
        });
    }

    exports.statTypes = availStatTypes;

    exports.timeouts = {
        acquisition: 1000,
    };
})();
