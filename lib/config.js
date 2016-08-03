'use strict'; // eslint-disable-line strict

/*
 * This config file contains default input parameters for s3blaster
 */

const os = require('os');
const fs = require('fs');
const commander = require('commander');

const KB = 1024;
const MB = KB * KB;
const GB = KB * MB;

/*
 * The keys accessKeyId and secretAccessKey can be given by following ways with
 * a decreasing priority level:
 * 1. command line:
 *      --accessKeyId = your_access_key_id
 *      --secretAccessKey = your_secret_access_key
 * 2. config JSON file, in "acc" sub-object:
 *      "accessKeyId": "your_access_key_id"
 *      "secretAccessKey": "your_secret_access_key"
 * 3. environment variable:
 *      ACCESSKEYID=your_access_key_id
 *      SECRETACCESSKEY=your_secret_access_key
 * 4. credential file, default ~/.s3cfg
 *      access_key = your_access_key_id
 *      secret_key = your_secret_access_key
 */
let accessKeyId = 'accessKey1';
let secretAccessKey = 'verySecretKey1';

function getBoolean(val) {
    return (val === 'true');
}
function range(val) {
    const input = val.split(':').map(Number);
    const arr = [];
    for (let i = input[0]; i <= input[2]; i += input[1]) {
        arr.push(i);
    }
    return arr;
}
function listValues(val) {
    return val.split(',').map(Number);
}
function listStrs(val) {
    return val.split(',');
}
function getArr(input) {
    if (!input) return undefined;
    return (input.indexOf(':') > -1) ? range(input) : listValues(input);
}
function getUnit(unit) {
    switch (unit) {
    case 'B': return 1;
    case 'KB': return KB;
    case 'MB': return MB;
    case 'GB': return GB;
    default: return KB;
    }
}

commander.version('0.0.1')
.option('--config <config>', 'Config JSON file')
.option('--accFile <accFile>',
    'File contains S3 accessKeyId and secretAccessKey')
.option('--accessKeyId <accessKeyId>', 'S3 accessKeyId and secretAccessKey')
.option('--secretAccessKey <secretAccessKey>',
    'S3 secretAccessKey\n\nFor monitoring processes')

.option('--user <user>', 'Username')
.option('--publicKey <publicKey>', 'Public key file path')
.option('--privateKey <privateKey>', 'Private key file path')
.option('--password <password>', 'password for publicKey')
.option('--passphrase <passphrase>',
    'passphrase for privateKey\n\nFor connection')

.option('-H, --host <host>', 'Host name')
.option('-P, --port <port>', 'Port number', parseInt)
.option('-w, --forksNb <forksNb>', 'Forks number', parseInt)
.option('--servers <servers>', 'List servers', listStrs)
.option('--signature <signature>', 'Signature version, v2 or v4')
.option('--region <region>', 'AWS regions\n\nFor database')

.option('--bucketsNb <bucketsNb>', 'Number of buckets', parseInt)
.option('-B, --bucketPrefix <bucketPrefix>', 'Prefix for bucket name')
.option('--objectsNb <objectsNb>', 'Number of objects per bucket', parseInt)
.option('--fillObjs <fillObjs>',
    'Flag for filling objects in each bucket', getBoolean)
.option('--fillRange <fillRange>', 'Indices range for filling objects min:max')
.option('--fillThreads <fillThreads>',
    'Number threads for filling objects', parseInt)
.option('-s, --sizes <sizes> or min:step:max', 'data sizes', getArr)
.option('-u, --unit <unit>', 'Data size unit', getUnit)
.option('--partSizes <partSizes> or min:step:max', 'part sizes', getArr)
.option('--prefixKey <prefixKey>', 'Prefix for object keys')
.option('--objMetadata <objMetadata>',
    'Level for filling metadata info for objects')
.option('--mdPath <mdPath>',
    'Path template of metadata store location\n\nFor simulation')

.option('--requests <requests>', 'Ordered list of requests')
.option('--proprReqs <proprReqs>', 'Proportion of requests', listValues)
.option('--range <range>',
    'Indices range for requests min:max,min:max,...', listStrs)
.option('--schedule <schedule>', 'Type of simulation')
.option('--simulDelay <simulDelay>',
    'Delay between two consecutive simulations (in second)', parseInt)
.option('--nextKey <nextKey>',
    'Next key choosing either `rand` (random), `seq` (sequential)')
.option('--paralReqs <paralReqs>  or min:step:max',
    'Number of parallel requests', getArr)
.option('--mpuParalReqs <mpuParalreqs>',
    'Number of parallel requests for uploading parts in MPU', parseInt)
.option('--sendReqRates <sendReqRates>',
    'Array of rates for sending requests', listStrs)
.option('--observationsNb <observationsNb>', 'Number of observations', parseInt)
.option('--workOnCurrObjs <workOnCurrObjs>',
    'Work on uploaded objs', getBoolean)
.option('--dontCleanDB <dontCleanDB>',
    'Flag for cleaning database at the end of simulation', getBoolean)
.option('--noKeyFlag <noKeyFlag>',
    'Accept getting NoSuchKey objects or not', getBoolean)
.option('--freqShow <freqShow>', 'Frequency to show stats', parseInt)
.option('--samplingStep <samplingStep>',
    'Sampling step for estimating pdf and cdf', Number)
.option('--percentiles <percentiles>', 'Percentiles', listValues)
.option('-t, --runTime <runTime>', 'Max running time (second)', parseInt)
.option('--ssm <ssm>', 'Enable monitoring processes', getBoolean)
.option('--liveGlobal <liveGlobal>',
    'Enable show both live and global stats', getBoolean)
.option('--rate <rate>', 'Rate for getting live stats, in ms', parseInt)
.option('--ssmTypes <ssmTypes>', 'Array of patterns for monitoring', listStrs)
.option('--displaySSM <displaySSM>',
    'Flag for displaying ssm on console', getBoolean)
.option('--resConsMonitor <resConsMonitor>',
    'Flag for monitoring resources consuming by s3blaster', getBoolean)
.option('--showInputParams <showInputParams>',
    'Flag for showing input parameters\n\nFor graphs', getBoolean)

.option('--statsFolder <statsFolder>', 'Folder stores statistics and graphs')
.option('--graphs <graphs>', 'Graphs to plot')
.option('--outputType <outputType>',
    'Type of output graph files, either pdf or png')
.option('--output <output>', 'Suffix for output files')
.option('--fitPlot <fitPlot>', 'Enable fit feature for plotter', getBoolean)
.option('--message <message>', 'Specified message that displays on all graphs')
.parse(process.argv);

const configFile = commander.config || './config.json';
const accFilePath = commander.accFile || `${os.homedir()}/.s3cfg`;

/* Retrieve accessKeyId and secretAccessKey from a file. They should be
 * stored in the form
 *    access_key = your_access_key_id
 *    secret_key = your_secret_access_key
 * A read key will be over-written by an environment variable if relevant
 */
function getKeys(accFilePath) {
    if (!process.env.ACCESSKEYID || !process.env.SECRETACCESSKEY) {
        try {
            const accFileStat = fs.statSync(accFilePath);
            if (accFileStat.isFile()) {
                const credentials =
                    fs.readFileSync(accFilePath).toString().split('\n');
                credentials.forEach(data => {
                    const param = data.split(' = ').map(val => val.trim());
                    if (param[0] === 'access_key') {
                        accessKeyId = param[1];
                    } else if (param[0] === 'secret_key') {
                        secretAccessKey = param[1];
                    }
                });
            }
        } catch (error) {
            if (commander.accFile) {
                process.stdout.write(`Cannot read file ${accFilePath}\n`);
            }
        }
    }
    if (process.env.ACCESSKEYID) {
        accessKeyId = process.env.ACCESSKEYID;
    }
    if (process.env.SECRETACCESSKEY) {
        secretAccessKey = process.env.SECRETACCESSKEY;
    }
}

/*
 * Recursively update properties of obj1 from obj2 and cmd (CLI)
 * Priority: cmd[key] > obj2[key] > obj1[key]
 */
function updateRecursive(obj1, obj2, cmd) {
    if (!obj2 && !cmd) return obj1;
    Object.keys(obj1).forEach(key => {
        if (obj1[key].constructor === Object) {
            if (!obj2) {
                obj1[key] = // eslint-disable-line
                    updateRecursive(obj1[key], undefined, cmd);
            } else if (obj2[key] && obj2[key].constructor === Object) {
                obj1[key] = // eslint-disable-line
                    updateRecursive(obj1[key], obj2[key], cmd);
            }
        } else {
            if (cmd[key] !== undefined) {
                obj1[key] = cmd[key]; // eslint-disable-line
            } else if (obj2 && obj2[key] !== undefined &&
                obj2[key].constructor !== Object) {
                obj1[key] = obj2[key]; // eslint-disable-line
            }
        }
    });
    return obj1;
}

// get accessKeyId and secretAccessKey if relevant
getKeys(accFilePath);

// get config from json file
let configJson;
try {
    const _configFile = fs.statSync(configFile);
    if (_configFile.isFile()) {
        const data =
            fs.readFileSync(configFile, { encoding: 'utf-8' });
        try {
            configJson = JSON.parse(data);
        } catch (e) {
            process.stderr.write(
                `Failed to parse config JSON file ${configFile}\n`);
        }
    }
} catch (e) {
    process.stderr.write(`Failed to read config JSON file ${configFile}\n`);
}

/* Params for s3blaster -> modify them if relevent */
const configInit = {
    acc: {
        user: 'root',
        publicKey: `${os.homedir()}/.ssh/id_rsa.pub`,
        privateKey: `${os.homedir()}/.ssh/id_rsa`,
        passphrase: '',
        password: '',
        accessKeyId,
        secretAccessKey,
    },
    conn: {
        // host is either:
        // - ip or dns of a single server
        // - 'single', first one of servers is used
        // - 'balancing', i.e. each fork connects to a server
        host: 'localhost',
        port: 8000, // port 80 -> using haproxy
        forksNb: 0,
        servers: ['localhost'],
        signature: 'v4',
        region: 'eu-west-1',
    },
    db: {
        bucketsNb: 1,
        bucketPrefix: 'bucketname',
        objectsNb: 100,
        fillObjs: false,  // flag for fillin objects in each bucket
        fillRange: '0:1', // indices range for filling objects min:max
        fillThreads: 64,
        // object sizes: either '<items>' or 'min:step:max'
        sizes: '1, 10',
        // unit: 'B', 'KB', 'MB', 'GB'
        unit: 'KB',
        // part size for multipartUpload, in MB
        partSizes: '5',
        // prefix for keys. If it's not defined, a default template is used
        // prefixKey: 'prefixKey',
        // level for filling pseudo-metadata info for each object
        // either 'compact', 'standard' or 'full'
        objMetadata: 'compact',
        // path template of metadata store location
        // <server_address> will be replaced by address of corresponding server
        mdPath: '',
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
        schedule: 'each',
        // delay between two consecutive simulations (in second)
        simulDelay: 0,
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
        observationsNb: 1000,
        workOnCurrObjs: true,
        dontCleanDB: false,
        noKeyFlag: false,   // accepting flag for getting NoSuchKey objects
        freqShow: 1000,     // frequency to show stats on console
        samplingStep: 1,     // sampling step for estimating pdf and cdf (ms)
        percentiles: [60, 80, 90, 95, 99, 100], // percentiles
        runTime: 600,       // in second
        ssm: false,          // ssh-system-monitor
        liveGlobal: false,   // enable show both live and global stats
        rate: 1000,         // rate for getting live stats, in ms
        // choose servers' stats for monitoring: either 'all' or a list of
        //  - 's3':   max %cpu and total memory usage of S3 process
        //  - 'vaultd':   max %cpu and total memory usage of vaultd process
        //  - 'bucketd':   max %cpu and total memory usage of bucketd process
        //  - 'repdMap':   max %cpu and total memory usage of repdMap process
        //  - 'repd':   max %cpu and total memory usage of repd process
        //  - 'sproxyd':   max %cpu and total memory usage of sproxyd process
        //  - 'nginx':   max %cpu and total memory usage of nginx process
        //  - 'supervisord':   max %cpu and total memory usage of supervisord
        //  - 'filebeat':   max %cpu and total memory usage of filebeat process
        //  - 'ioStat':   %util of all ssd disks
        //  - 'mdBktSize':   size of metastore
        //  - 'mdLogSize':   size of log metadata
        ssmTypes: 'all',
        // Dynamic extra processes for monitoring, e.g. 'pattern1,pattern2'
        // Note: the given pattern will be used to monitor the desired process
        // Return max %cpu and total memory usage of all processes found by
        // each pattern.
        // monitors: 'S3',
        // flag for showing ssm on console
        displaySSM: true,
        // flag for showing resources consuming by s3blaster
        resConsMonitor: false,
        // flag for showing input parameters
        showInputParams: false,
    },
    plotter: {
        // folder stores statistics and graphs. This folder locates in the
        // directory of s3blaster.js
        statsFolder: 'hello/scality',
        // available graphs to plot:
        //  - 'avg-std' for average and standard-deviabtion of request latency
        //  - 'pdf-cdf' for estimated probability and cumulative distr. func.
        //  - 'stat-size' for request latency vs. object sizes
        //  - 'paral-req' for request latency vs. parallel requests number
        //  - 'live' for live stats and ssm results
        // 2 ways: 'all' or '<items>'
        graphs: 'all',
        // type of output graph files, either 'pdf' or 'png'
        outputType: 'pdf',
        // suffix for output graph files
        output: 'test',
        fitPlot: false,  // flag for fitting function
        // specified message that displays on all graphs
        message: 'message',
    },
};

const config = updateRecursive(configInit, configJson, commander);

/* post-processing */
function postProcessConfig() {
    // check wheter servers contains host
    if (config.conn.host !== 'single' && config.conn.host !== 'balancing') {
        if (config.conn.servers.every(server => server !== config.conn.host)) {
            process.stderr.write(`Servers list should contain host\n`);
            config.conn.servers.push(config.conn.host);
        }
    }

    if (config.acc.publicKey && config.acc.publicKey[0] === '~') {
        config.acc.publicKey =
            config.acc.publicKey.replace('~', `${os.homedir()}`);
    }
    if (config.acc.privateKey && config.acc.privateKey[0] === '~') {
        config.acc.privateKey =
            config.acc.privateKey.replace('~', `${os.homedir()}`);
    }

    if (typeof config.db.sizes === 'string') {
        config.db.sizes = getArr(config.db.sizes);
    }

    if (typeof config.db.unit === 'string') {
        config.db.unit = getUnit(config.db.unit);
    }
    if (typeof config.db.partSizes === 'string') {
        config.db.partSizes = getArr(config.db.partSizes);
    }
    if (typeof config.simul.paralReqs === 'string') {
        config.simul.paralReqs = getArr(config.simul.paralReqs);
    }
    config.simul.percentiles = config.simul.percentiles.map(val => val / 100);
    config.simul.simulDelay = config.simul.simulDelay * 1000;
}

postProcessConfig(config);

exports.config = config;
