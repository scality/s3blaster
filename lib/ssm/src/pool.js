'use strict'; // eslint-disable-line strict

/**
 * Created by mtford on 22/02/2014.
 */
/**
* Re-wrote by Lam Pham Sy on 11/05/2016.
*/

const stdout = require('process').stdout;
const stderr = require('process').stderr;
const config = require('./config');
const Pool = require('generic-pool').Pool;
const ssh = require('./ssh');

class SSHConnectionPool {
    constructor(options) {
        // The below specifies available options
        const defaultOptions = {
            host: '',
            port: null,
            max: 10,
            min: 2,
        };

        this.options = options || defaultOptions;

        this.pool = new Pool({
            name: 'ssh',
            create: this.spawnClient.bind(this),
            destroy: this.destroyClient.bind(this),
            max: this.options.max,
            min: this.options.min,
            username: this.options.username,
            privateKey: this.options.privateKey,
            publicKey: this.options.publicKey,
            idleTimeoutMillis: 30000,
            log: false,
        });
    }

    acquire(callback) {
        let tp = setTimeout(() => {
            tp = null;
            const message = 'Acquisition timed out';
            stderr.write(this.logMessage(`${message}\n`));
            if (callback) callback(message);
        }, config.timeouts.acquisition);
        this.pool.acquire((err, client) => {
            if (err) {
                stderr.write(this.logMessage(`Acquisition failed - ${err}\n`));
            } else {
                if (!(client instanceof ssh.SSHConnection)) {
                    const msg = 'Invalid client returned';
                    throw msg;
                }
            }
            if (tp) {
                clearTimeout(tp);
                callback(err, client);
            }
        });
    }

    release(client) {
        if (client) {
            this.pool.release(client);
        } else {
            stderr.write('Attempted to release a null client...\n');
        }
    }

    spawnClient(callback) {
        const client = new ssh.SSHConnection();
        client.on('ready', () => {
            stdout.write(this.logMessage('Connection established\n'));
            callback(null, client);
        });
        client.on('error', e => {
            stderr.write(this.logMessage(`${e}\n`));
            callback(e, client);
        });
        client.on('end', () => {
            stdout.write(this.logMessage('Connection ended\n'));
        });
        client.on('close', hadError => {
            if (hadError) {
                stderr.write(this.logMessage(
                    'Connection closed due to error\n'));
            } else {
                stdout.write(this.logMessage('Connection closed cleanly\n'));
            }
        });
        client.connect({
            host: this.options.host,
            port: this.options.port,
            username: this.options.username,
            privateKey: this.options.privateKey,
            publicKey: this.options.publicKey,
            passphrase: this.options.passphrase,
            password: this.options.password,
            tryKeyboard: true,
        });
        return client;
    }

    destroyClient(client) {
        client.end();
    }

    /**
     * Terminates all ssh connections in the pool.
     * @param {function} callback - callback
     * @return {this} this
     */
    drain(callback) {
        stdout.write('Closing all\n');
        this.pool.drain(() => {
            this.pool.destroyAllNow(() => {
                stdout.write('All destroyed\n');
                if (callback) callback();
            });
        });
    }

    oneShot(callback) {
        this.acquire.bind(this)((err, client) => {
            if (err || client) {
                callback(err, client);
            } else {
                callback('Unable to obtain an SSH client connection', null);
            }
            if (client) this.release(client);
        });
    }

    toString() {
        return `Pool<${this.options.host}:${this.options.port.toString()}>`;
    }

    /**
     * Log host+port details as well as the message.
     * @param {string} message - message
     * @return {this} this
     */
    logMessage(message) {
        const host = this.options.host;
        const port = this.options.port || '';
        return `SSHConnectionPool[${host}:${port.toString()}] ${message}`;
    }
}

exports.SSHConnectionPool = SSHConnectionPool;
