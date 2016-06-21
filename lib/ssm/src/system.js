'use strict'; // eslint-disable-line strict

/**
 * Created by mtford on 20/02/2014.
 *
 */
/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const async = require('async');
const fs = require('fs');
const stdout = require('process').stdout;
const stderr = require('process').stderr;
const readlineSync = require('readline-sync');
const Client = require('ssh2').Client;

const Pool = require('./pool').SSHConnectionPool;
const StatsMonitor = require('./monitor').StatsMonitor;
// const config = require('./config');

const connState = {
    WAIT: 'wait',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
};

class System {
    constructor() {
        this._pools = [];
        this._monitors = [];
        this._listeners = [];
        this._config = undefined;
        this.state = connState.DISCONNECTED;
        this.currSSHConfig = {
            state: '',
            user: '',
            publicKey: '',
            privateKey: '',
            password: '',
            passphrase: '',
        };
    }

    checkSshConnection(server, cb) {
        const client = new Client();
        client.on('ready', () => {
            client.end();
            cb();
        });
        client.on('error', err => {
            cb(err);
        });
        client.connect({
            readyTimeout: 99999,
            host: server.host,
            port: server.port || 22,
            username: server.username,
            publicKey: server.publicKey,
            password: server.password,
            privateKey: server.privateKey,
            passphrase: server.passphrase,
        });
    }

    checkAllConnections(servers, cb, _serverIdx) {
        this.state = connState.WAIT;
        let serverIdx = _serverIdx || 0;
        let server = servers[serverIdx];
        let tryNext = true;
        let pubKeyPath;
        let prvKeyPath;

        this.checkSshConnection(server, err => {
            if (err) {
                stderr.write(`Failed ssh to ${server.host}: ${err}\n`);
                const tryNextQ =
                    readlineSync.question('Try with new ssh config (y/n)? ');
                tryNext = (tryNextQ && tryNextQ.toUpperCase() === 'Y');
                if (tryNext) {
                    stdout.write('Just enter to use current value\n');
                    this.currSSHConfig.state = 'update';
                    this.currSSHConfig.user = readlineSync.question(
                        `Enter user[${server.username}]: `) || server.user;
                    pubKeyPath = readlineSync.question(
                        'Enter path for your publicKey: ');
                    this.currSSHConfig.password = readlineSync.question(
                        'Enter password for your publicKey: ',
                            { hideEchoBack: true }) || server.password;
                    prvKeyPath = readlineSync.question(
                        'Enter path for your privateKey: ');
                    this.currSSHConfig.passphrase = readlineSync.question(
                        'Enter passphrase for privateKey: ',
                            { hideEchoBack: true }) || server.passphrase;
                    if (pubKeyPath) {
                        try {
                            this.currSSHConfig.publicKey =
                                fs.readFileSync(pubKeyPath).toString();
                        } catch (e) {
                            stderr.write('Wrong path for publicKey\n');
                            this.currSSHConfig.publicKey = server.publicKey;
                        }
                    } else {
                        this.currSSHConfig.publicKey = server.publicKey;
                    }
                    if (prvKeyPath) {
                        try {
                            this.currSSHConfig.privateKey =
                                fs.readFileSync(prvKeyPath).toString();
                        } catch (e) {
                            stderr.write('Wrong path for publicKey\n');
                            this.currSSHConfig.privateKey = server.privateKey;
                        }
                    } else {
                        this.currSSHConfig.privateKey = server.privateKey;
                    }
                } else {
                    return cb(`Failed ssh to ${server.host}: ${err}`);
                }
            } else {
                serverIdx++;
                if (serverIdx >= servers.length) {
                    return cb();
                }
                server = servers[serverIdx];
            }

            if (tryNext) {
                if (this.currSSHConfig.state) {
                    server.username = this.currSSHConfig.user;
                    server.privateKey = this.currSSHConfig.privateKey;
                    server.publicKey = this.currSSHConfig.publicKey;
                    server.passphrase = this.currSSHConfig.passphrase;
                    server.password = this.currSSHConfig.password;
                }
                process.nextTick(this.checkAllConnections.bind(this), servers,
                                    cb, serverIdx);
            }
            return undefined;
        });
    }

    _constructStatsMonitor(server) {
        const sshPool = new Pool(server);
        this._pools.push(sshPool);

        const statsMonitor = new StatsMonitor(sshPool, this._config.rate);
        statsMonitor.start();
        this._monitors.push(statsMonitor);
    }

    _drainPools(callback) {
        stdout.write('Closing all SSH connections\n');
        const drainOperations = this._constructDrainOperations();
        async.parallel(drainOperations, err => {
            if (err) {
                return stderr.write(`Error when shutting down SSH _pools:
                    ${err.toString()}
                    which means some connections may be left open\n`);
            }
            return callback();
        });
    }

    _constructDrainOperations() {
        return this._pools.map(pool => pool.drain.bind(pool));
    }

    start(config, cb) {
        this._config = config;
        stdout.write('Configuring monitors\n');

        const servers = this._config.servers;

        this.checkAllConnections(servers, err => {
            if (err) {
                this.state = connState.DISCONNECTED;
                return cb(connState.DISCONNECTED);
            }
            this.state = connState.CONNECTED;
            servers.forEach(server => {
                stdout.write(`Configuring monitor for ${server.name}\n`);
                const _server = JSON.parse(JSON.stringify(server));
                _server.max = this._config.poolSize;
                _server.min = this._config.maintainConnections;
                this._constructStatsMonitor(_server);
            });
            stdout.write('Started!\n');
            return cb();
        });
    }

    getInitMDSize(cb) {
        if (this.state === connState.DISCONNECTED) {
            return cb(`SSH connection: ${this.state}`);
        } else if (this.state === connState.WAIT) {
            setTimeout(this.getInitMDSize.bind(this), 1000, cb);
        } else {
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
        return undefined;
    }

    calculateMDSize(cb) {
        if (this.state !== connState.CONNECTED) {
            return cb(`Cannot compute MD size as connection: ${this.state}`);
        }
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
        return undefined;
    }

    terminate(callback) {
        stdout.write('Shutting down monitors\n');
        this._monitors.forEach(monitor => {
            monitor.stop();
        });

        this._drainPools(() => {
            if (callback) callback();
        });
    }
}

module.exports = new System();
