'use strict'; // eslint-disable-line strict

/*
 * This config file contains default input parameters for s3blaster
 */

const cluster = require('cluster');
const fs = require('fs');
const commander = require('commander');
const readlineSync = require('readline-sync');

function listStrs(val) {
    return val.split(',');
}

commander.version('0.0.1')
.option('--servers [servers]', 'List servers', listStrs)
.option('--user [user]', 'Username')
.option('--pub-key [pubKey]', 'Public key file path')
.option('--prv-key [prvKey]', 'Private key file path')
.option('--acc-file [accFile]', 'File contains accessKeyId and secretAccessKey')
.option('--passphrase [passphrase]', 'passphrase for privateKey')
.option('--password [password]', 'password for publicKey')
.option('--servers-list [serversList]', 'File contains list of servers')
.option('--md-path [mdPath]', 'Path template of metadata store location. \
    If relevant, <server_address> will be used for address of server')
.option('--ssm [ssm]', 'Enable ssh-system-monitor')
.parse(process.argv);

/* Retrieve accessKeyId and secretAccessKey from a file. They should be
 * stored in the form
 *    accessKeyId:your_access_key_id
 *    secretAccessKey:your_secret_access_key
 *    user:your_user
 *    password:your_password
 *    publicKey:path_to_your_public_key_file
 *    privateKey:path_to_your_private_key_file
 *    passphrase:passphrase_for_your_private_key
 */
function getSecretInfo(accFilePath) {
    try {
        const accFile = fs.statSync(accFilePath);
        if (accFile) {
            const credentials = fs.readFileSync(accFilePath).toString().split('\n');
            credentials.forEach(data => {
                const param = data.split(':');
                if (param[0] === 'accessKeyId') {
                    accessKeyId = param[1];
                } else if (param[0] === 'secretAccessKey') {
                    secretAccessKey = param[1];
                } else if (param[0] === 'user' && !user) {
                    user = param[1];
                } else if (param[0] === 'password' && !password) {
                    password = param[1];
                } else if (param[0] === 'publicKey' && !publicKey) {
                    publicKey = param[1];
                } else if (param[0] === 'privateKey' && !privateKey) {
                    privateKey = param[1];
                } else if (param[0] === 'passphrase' && !passphrase) {
                    passphrase = param[1];
                }
            });
        }
    } catch (e) {

    }

    // check access keys
    if (!accessKeyId) {
        accessKeyId = readlineSync.question('Enter accessKeyId: ');
    }
    if (!secretAccessKey) {
        secretAccessKey = readlineSync.question('Enter secretAccessKey: ',
            { hideEchoBack: true });
    }

    // check keys and password for ssm
    if (cluster.isMaster && commander.ssm && commander.ssm === 'true') {
        if (!user || (!publicKey && !privateKey)) {
            process.stderr.write('\nIt requires extra-information to monitor ');
            process.stderr.write('resources\' consuming on servers\n')
        }
        if (!user) {
            user = readlineSync.question('Enter user for ssh connections: ');
        }
        if (!publicKey) {
            publicKey = readlineSync.questionPath(
                'Enter path for your publicKey: ', {
                    exists: true,
                    isFile: true,
                });
            password = readlineSync.question(
                'Enter password for your publicKey: ',
                    { hideEchoBack: true });
            if (!publicKey) {
                privateKey = readlineSync.questionPath(
                    'Enter path for your privateKey: ', {
                        exists: true,
                        isFile: true,
                    });
                passphrase = readlineSync.question(
                    'Enter passphrase for privateKey: ',
                        { hideEchoBack: true });
            }
        }
    }
}

const accFilePath = commander.accFile || './.credentials';
const serversListFilePath = commander.serversList || './config.json';
let user = commander.user;
let publicKey = commander.pubKey;
let privateKey = commander.prvKey;
let passphrase = commander.passphrase;
let password = commander.password;
let accessKeyId;
let secretAccessKey;
let servers = commander.servers || undefined;
// path template of metadata store location
// <server_address> will be replaced by address of corresponding server
let mdPath = commander.mdPath || undefined;

getSecretInfo(accFilePath);

if (!servers || !mdPath) {
    try {
        const serversListFile = fs.statSync(serversListFilePath);
        if (serversListFile) {
            const data =
                fs.readFileSync(serversListFilePath, { encoding: 'utf-8' });
            if (!servers) {
                servers = JSON.parse(data).servers;
            }
            if (!mdPath) {
                mdPath = JSON.parse(data).mdPath.join('');
            }
        }
    } catch (e) {
        if (!servers) {
            servers = ['localhost'];
        }
    }
}

// verify servers
if (!servers.every(server => server.trim().length > 0)) {
    throw new Error('List of servers contains a null address');
}

/* Params for s3blaster -> modify them if relevent */
const config = {
    acc: {
        user,
        publicKey,
        privateKey,
        passphrase,
        password,
        accessKeyId,
        secretAccessKey,
    },
    conn: {
        // host is either:
        // - ip or dns of a single server
        // - 'single', first one of servers is used
        // - 'balancing', i.e. each fork connects to a server
        host: 'single',
        port: 8000, // port 80 -> using haproxy
        forksNb: 0,
        servers,
    },
    db: {
        bucketsNb: 1,
        bucketPrefix: 'bktscalityr',
        objectsNb: 100,
        fillObjs: 100,  // number of objects created initially in each bucket
        // object sizes: either '<items>' or 'min:step:max'
        sizes: '1,8,40,100',
        // unit: 'B', 'KB', 'MB', 'GB'
        unit: 'KB',
        // part size for multipartUpload, in MB
        partSize: 10,
        // prefix for keys. If it's not defined, a default template is used
        // prefixKey: 'prefixKey',
        // level for filling pseudo-metadata info for each object
        // either 'compact', 'standard' or 'full'
        objMetadata: 'full',
        // path template of metadata store location
        // <server_address> will be replaced by address of corresponding server
        mdPath,
    },
    simul: {
        // available reqs: put, get, get-acl, delete, list,
        //  combine(put->get->delete)
        requests: 'put,get,delete',
        proprReqs: [1, 1, 1],       // proportion of requests
        // indices range of objects for requests
        // either 'all' or 'min:max'
        range: ['all', 'all', 'all'],
        // 2 simul schedule
        //  - 'each': requests are tested sequentially by their types
        //  - 'mixed': random request type is chosen for testing
        schedule: 'mixed',
        // delay between two consecutive simulations (in second)
        simulDelay: 10,
        // the way for choosing key of object for next request of a same type
        // either 'rand' for random or 'seq' for sequential way
        nextKey: 'rand',
        // number of parallel requests -> 2 ways: '<items>' or 'min:step:max'
        paralReqs: '1',
        mpuParalReqs: 1,
        // array of rates for sending requests from each fork of s3blaster
        // Each rate corresponds to a type of request
        // either ['max', 'max'] or [200, 500]
        sendReqRates: ['max', 'max', 'max'],
        observationsNb: 1000000,
        getAnyKey: false,
        dontCleanDB: false,
        noKeyFlag: false,   // accepting flag for getting NoSuchKey objects
        freqShow: 10,     // frequency to show stats on console
        samplingStep: 1,     // sampling step for estimating pdf and cdf (ms)
        percentiles: [60, 80, 90, 95, 99, 100], // percentiles
        runTime: 600,       // in second
        ssm: false,          // ssh-system-monitor
        liveGlobal: false,   // enable show both live and global stats
        rate: 1000,         // rate for getting live stats, in ms
        // choose servers' stats for monitoring: either 'all' or a list of
        //  - 'swapUsed': swap usage
        //  - 'cpuUsage': %CPU time spent in user space
        //  - 'memUsed':  memory usage
        //  - 'repdMap':  cpu usage of RepdMapServer process
        //  - 'ioStat':   %util of all ssd disks
        //  - 'bucketd':   max %cpu usage of every bucketd processes
        //  - 'repd':   %cpu usage of repd processes
        //  - 'supervisord':   %cpu usage of supervisord processes
        //  - 'vaultd':   %cpu usage of vaultd processes
        //  - 's3':   max %cpu usage of every S3 process
        //  - 'ironman':  sum %cpu usage of all S3, MetaData, Vault processes
        ssmTypes: 'all',
        // dynamic extra processes for monitoring, e.g. 'pattern1,pattern2'
        // Note: the given pattern will be used to monitor the desired process
        // Return max %cpu usage of all processes found by each pattern
        monitors: 'sproxyd',
        // flag for showing ssm on console
        displaySSM: true,
        // flag for showing resources consuming by s3blaster
        resConsMonitor: false,
    },
    plotter: {
        // folder stores statistics and graphs. This folder locates in the
        // directory of s3blaster.js
        statsFolder: 'hello/1',
        // available graphs to plot:
        //  - 'avg-std' for average and standard-deviabtion of request latency
        //  - 'pdf-cdf' for estimated probability and cumulative distr. func.
        //  - 'size' for request latency vs. object sizes
        //  - 'paral-req' for request latency vs. parallel requests number
        //  - 'live' for live stats and ssm results
        // 2 ways: 'all' or '<items>'
        graphs: 'all',
        // type of output graph files, either 'pdf' or 'png'
        outputType: 'pdf',
        // suffix for output graph files
        // output: '_Apr20_13h10_S3rel10_Sproxyd',
        output: 'test',
        fitPlot: false,  // flag for fitting function
        // specified message that displays on all graphs
        message: 'S3 branch: rel/1.0 + Sproxyd,\n',
    },
    probe: {
        // coefficients for the cost function
        // cost := coef1 * average_latency + coef2 / operations/ms
        coefs: [1, 1],
    },
};

exports.config = config;
