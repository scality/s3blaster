'use strict'; // eslint-disable-line strict

/**
 * Created by mtford on 20/02/2014.
 *
 */
/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const async = require('async');
const Pool = require('./pool').SSHConnectionPool;
const StatsMonitor = require('./monitor').StatsMonitor;
const config = require('./config');
const logger = config.logger;

class System {
    constructor() {
        this._pools = [];
        this._monitors = [];
        this._listeners = [];
        this._config = undefined;
    }

    _constructStatsMonitor(server) {
        const sshPool = new Pool(server);
        this._pools.push(sshPool);

        const statsMonitor = new StatsMonitor(sshPool, this._config.rate);
        statsMonitor.start();
        this._monitors.push(statsMonitor);
    }

    _drainPools(callback) {
        logger.info('Closing all SSH connections');
        const drainOperations = this._constructDrainOperations();
        async.parallel(drainOperations, err => {
            if (err) {
                return logger.error(`Error when shutting down SSH _pools:
                    ${err.toString()}
                    which means some connections may be left open`);
            }
            return callback();
        });
    }

    _constructDrainOperations() {
        return this._pools.map(pool => pool.drain);
    }

    start(config) {
        this._config = config;
        this._db = undefined;
        logger.debug('Configuring monitors');

        const servers = this._config.servers;

        servers.forEach(server => {
            logger.info(`Configuring monitor for ${server.name}`);
            logger.info(`Reading account info for ${server.name}`);
            const _server = JSON.parse(JSON.stringify(server));
            _server.max = this._config.poolSize;
            _server.min = this._config.maintainConnections;
            this._constructStatsMonitor(_server);
        });
        logger.info('Started!');
    }

    getInitMDSize(cb) {
        let count = 0;
        this._monitors.forEach(monitor => {
            setTimeout(monitor.getInitMDSize.bind(monitor), 100,
                (err, mdSize) => {
                    if (err) {
                        return cb(err);
                    }
                    count++;
                    if (count === this._monitors.length) {
                        return cb(null, mdSize);
                    }
                    return undefined;
                });
        });
    }

    calculateMDSize(cb) {
        let count = 0;
        this._monitors.forEach(monitor => {
            monitor.calculateMDSize.bind(monitor)((err, mdSize) => {
                count++;
                if (count === this._monitors.length) {
                    return cb(err, mdSize.map(val => val[1] - val[0]));
                }
                return undefined;
            });
        });
    }

    terminate(callback) {
        logger.debug('Shutting down monitors');
        this._monitors.forEach(monitor => {
            monitor.stop();
        });

        this._drainPools(() => {
            if (callback) callback();
        });
    }
}

module.exports = new System();
