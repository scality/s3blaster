'use strict'; // eslint-disable-line strict

const cluster = require('cluster');
const s3config = require('aws-sdk').config;
const S3 = require('aws-sdk').S3;
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const stderr = process.stderr;
const stdout = process.stdout;
const execSync = require('child_process').execSync;
const http = require('http');


const pdfCdf = 'pdfCdf';
const stats = 'stats';
const thread = 'parallel';
const live = 'live';
const ssm = 'ssm';
const final = 'summary';

/* Available graph to be plotted:
graphs = {
   avgStd: average and standard-deviabtion graph will be plotted
   pdfCdf: estimated pdf/cdf graphs will be plotted
   statSize: latency vs. sizes graph will be plotted
   thread: latency vs. number of threads graph will be plotted
   live: resources' consuming and real-time perf
};
*/
const graphs = {
    pdfCdf,
    stats,
    thread,
    live,
    final,
};

const dataFiles = {
    pdfCdf,
    stats,
    thread,
    live,
    ssm,
    final,
};

// default config params for s3blaster
const s3Config = require('./config.js').config;
const servers = s3Config.conn.servers;

const ssmSystem = require('./ssm/src/system');
const ssmConfig = require('./ssm/src/config');
const ssmMonitor = require('./ssm/src/monitor');
const latestStates = ssmMonitor.latestStates;
const _ssmTypes = ssmConfig.statTypes;

const mdInfo = require('./ssm/src/ssh').mdInfo;
if (s3Config.db.mdPath) {
    servers.forEach(server => {
        mdInfo.bucketsCommonPath[server] =
            s3Config.db.mdPath.slice().replace(/<server_address>/g, server);
    });
}
mdInfo.bucketsList = [];

// available requests for testing
const requests = ['put', 'list', 'get', 'get-acl', 'delete', 'combine',
                  'multi-upload'];
const avaiReq = [];
let idx = 0;
const PUT_OBJ = idx; avaiReq.push(idx++);
const LST_OBJ = idx; avaiReq.push(idx++);
const GET_OBJ = idx; avaiReq.push(idx++);
const GET_ACL = idx; avaiReq.push(idx++);
const DEL_OBJ = idx; avaiReq.push(idx++);
const COM_OBJ = idx; avaiReq.push(idx++);
const MPU_OBJ = idx; avaiReq.push(idx++);
const LAT_PERF = 'Latency';
const OPR_PERF = 'Oprs/s';

/* simulaton schedule:
 *  (1) `Each`: in each `it` test, a request type and a data size is
 *     simulated for a given number of times before go to next one.
 *  (2) `Mixed`: in each `it` test, request and data size are chosen at
 *     random for testing.
 */
const simulEach = 'Each';
const simulMixed = 'Mixed';

const nextKeyRand = 'rand';
const nextKeySeq = 'seq';

const objMD = {
    COMPACT: 'compact',
    STANDARD: 'standard',
    FULL: 'full',
};

const outputGraph = {
    PDF: 'pdf',
    PNG: 'png',
};

const legendLineLen = 100;

const _folderName = s3Config.plotter.statsFolder ||
    (new Date()).toDateString().replace(/\s/g, '_');

// get path of directory storing output files
const statsFolder = `${s3Config.plotter.dirPath}/${_folderName}/`;

let defaultFileName = `${statsFolder}`;
if (cluster.isWorker) {
    defaultFileName += `worker${cluster.worker.id}/`;
}

const defaultMaxKey = 1000;
const KB = 1024;
const MB = KB * KB;
const GB = KB * MB;

const objToPlotter = {
    id: '',
    workersId: [],
    dir: defaultFileName,
    config: {},     // configuration info
    requests: [],   // array of simulated requests
    threads: [],    // array of #parallel requests
    sizes: [],      // array of object sizes
    percentiles: [],    // array of percentiles
    message: '',    // specified message shown in graphs
    results: [],    // perf stats results
    resultsName: [],    // name of perf
    runTime: '',    // total elapsed time of program
    fitPlot: false, // flag for fit curves
    outputType: outputGraph.PNG,  // file type for graph files
    allRealTimeFiles: [],   // files containing real-time perf of all workers
    procNames: [],  // names of running processes
    arrDataFiles: {},   // object contains stats data files.
        // If cluster.isMaster, arrDataFiles[live] and [final] contains _ssm.txt
        //  and _final.txt files
        // By default, it contains list of all stats data files.
    divisionMarks: [],  // array of division marks,
        // For sequential simulation, the array is for
        //      - each #threads
        //      - each object size
        //      - each request type
        //    Hence, divisionMarks[thread][size][request] contains elapsed time
        //    at which all workers finish their workload for
        //    (thread, size, request)
        // For mixed simulation, the array is for
        //      - each #threads
        //    Hence, divisionMarks[thread][0][0] contains elapsed time
        //    at which all workers finish their workload for given #threads
    legendLineLen,
};

const statIndexes = {
    STIME: 11,
    UTIME: 12,
    START_TIME: 19,
    RSS: 21,
    VSIZE: 20,
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
 * function creates an array containing all `value`
 * @param {number} len: array length
 * @param {number} value: value for each element of array
 * @return {array} array of `len` elements `value`
 */
function createNewArray(len, value) {
    return new Array(len).fill(value);
}

function getHrTime(start) {
    const end = process.hrtime(start);
    return (end[0] * 1e3 + end[1] / 1e6); // in ms
}

function drawLine(character, len) {
    let str = '';
    for (let idx = 0; idx < len; idx++) {
        str += character;
    }
    str += '|\n';
    return str;
}

/* get requests with their own order */
function getRequests(val) {
    let reqs = [];
    let idx = 0;
    val.split(',').forEach(req => {
        const reqIdx = requests.indexOf(req);
        if (reqIdx > -1) {
            reqs[idx++] = avaiReq[reqIdx];
        }
    });
    if (reqs.length === 0) {
        reqs = avaiReq.slice();
    }
    return reqs;
}

function convertSize(size) {
    if (size < KB) {
        return `${size}B`;
    } else if (size < MB) {
        return `${size / KB}KB`;
    } else if (size < GB) {
        return `${size / MB}MB`;
    }
    return `${size / GB}GB`;
}

const firstColLen = 30;
const serverColLen = Math.max(20, servers[0].toString().length);
const ssmTypes = Object.keys(_ssmTypes);
let nbStatsPerServer = 0;
ssmTypes.forEach(type => {
    if (Array.isArray(_ssmTypes[type].monitor)) {
        nbStatsPerServer += _ssmTypes[type].monitor.length;
    } else {
        nbStatsPerServer++;
    }
});

const lineLen = Math.max(95,
                    firstColLen + 1 + servers.length * (serverColLen + 1));
const line = drawLine('-', lineLen);
const dLine = drawLine('=', lineLen);

function displaySSM(stats, elapsedTime) {
    let str = '';
    str += `${dLine}` +
        `${toFixedLength(`Time: ${elapsedTime}(s)`, firstColLen - 8, 'left')}` +
        'Servers ||';
    servers.forEach(server => {
        str += `${toFixedLength(`${server}`, serverColLen)}|`;
    });
    str += `\n${line}`;
    ssmTypes.forEach(type => {
        const header = _ssmTypes[type].name;
        str += `${toFixedLength(header, firstColLen)}||`;
        servers.forEach(server => {
            const val = stats[server][type] || ' ';
            str += `${toFixedLength(val, serverColLen)}|`;
        });
        str += '\n';
    });
    str += `${line}`;
    stdout.write(str);
}

function genObjs(size) {
    return crypto.randomBytes(size);
}

const charSet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const charSetLength = charSet.length;
function genRandStr(_len) {
    const len = _len || 0;
    let str = '';
    for (let i = 0; i < len; i++) {
        const idx = Math.floor(Math.random() * charSetLength);
        str += `${charSet[idx]}`;
    }
    return str;
}

// min part size for multipart upload
const minPartSize = 0; // 5 * MB;

class S3Blaster {
    constructor() {
        /* for s3 configuration */
        this.assignRecursive.bind(this)(s3Config);
        this.haproxy = (this.port === 80);
        this.nWorkers = s3Config.conn.forksNb;
        if (this.host === 'single') {
            this.host = `${servers[0]}`;
        } else if (this.host === 'balancing') {
            if (cluster.isWorker) {
                this.host =
                    `${servers[cluster.worker.id % servers.length]}`;
            }
            if (cluster.isMaster) {
                this.host = `${servers[0]}`;
            }
        }
        this.signature = s3Config.conn.signature.trim();
        if (this.signature !== 'v2' && this.signature !== 'v4') {
            this.signature = 'v4';
        }

        s3config.update({
            credentials: {
                accessKeyId: s3Config.acc.accessKeyId,
                secretAccessKey: s3Config.acc.secretAccessKey,
            },
            endpoint: `${this.host}:${this.port}`,
            useAccelerateEndpoint: true,
            apiVersions: { s3: '2006-03-01' },
            region: `${this.region}`,
            paramValidation: false,
            sslEnabled: false,
            correctClockSkew: true,
            s3ForcePathStyle: true,
            computeChecksums: false,
            convertResponseTypes: false,
            httpOptions: {
                agent: new http.Agent({
                    keepAlive: true,
                    // keepAliveMsecs: 1000,
                    // maxFreeSockets: 256,
                }),
            },
            signatureVersion: this.signature,
            signatureCache: true,
            s3DisableBodySigning: true,
        });
        this.s3 = new S3(s3config);

        /* for database */
        this.sizes = this.sizes.map(val => val * this.unit);
        this.nbDataSizes = this.sizes.length;
        this.maxKey = s3Config.db.objectsNb;

        this.fillObjs = (s3Config.db.fillObjs === 'yes');
        if (this.fillRange) {
            this.fillRange = this.fillRange.split(':').map(Number);
        } else {
            this.fillRange = ['', ''];
        }

        /* for simulation*/
        // get requests via cmd
        this.reqsToTest = getRequests(s3Config.simul.requests);
        if (this.proprReqs && this.proprReqs.length >= this.reqsToTest.length) {
            this.proprReqs = this.proprReqs.slice(0, this.reqsToTest.length);
        } else {
            this.proprReqs = this.reqsToTest.map(() => 1);
        }

        // indices range of objects for requests: put, get, get-acl, del
        // either 'all' or 'min:max'
        const rAll = s3Config.simul.range.slice(0, this.reqsToTest.length);
        this.range = requests.map(() => [0, this.maxKey]);
        this.reqsToTest.forEach((req, idx) => {
            if (rAll[idx] && rAll[idx] !== 'all') {
                this.range[req] =
                    rAll[idx].split(':').slice(0, 2).map(Number);
            }
        });

        // 2 simul policies
        //  - 'each': requests are tested sequentially by their types
        //  - 'mixed': random request type is chosen for testing
        if (this.schedule !== simulEach && this.schedule !== simulMixed) {
            this.schedule = simulEach;
        }

        // the way for choosing key of object for next request of a same type
        // either 'rand' for random or 'seq' for sequential way
        if (this.nextKey !== nextKeyRand && this.nextKey !== nextKeySeq) {
            this.nextKey = nextKeySeq;
        }
        // number of parallel requests -> 2 ways: '<items>' or 'min:step:max'
        this.paralReqs = s3Config.simul.paralReqs;
        this.observationsNb = s3Config.simul.observationsNb;

        // array of rates for sending requests from each fork of s3blaster
        // Each rate corresponds to a type of request
        // either ['max', 'max'] or [200, 500]
        this.setReqRates(this.sendReqRates);

        this.displayRealTimePerf = this.displaySSM;

        this.prefixName = `${defaultFileName}${this.output}`;
        this.suffixName = '';
        this.message = '';
        this.messageInit = s3Config.plotter.message || '';
        // add a '#' character after '\n'
        this.messageInit = `# ${this.messageInit.replace(/\n/g, '\n# ')}`;

        // disable partSizes if MPU_OBJ is not given
        if (this.reqsToTest.indexOf(MPU_OBJ) === -1) {
            this.partSizes = undefined;
        }
        // for multipart-upload
        if (this.partSizes) {
            this.partSizes = this.partSizes.map(val => Math.floor(val * MB));
        }

        if (this.outputType !== outputGraph.PNG) {
            this.outputType = outputGraph.PDF;
        }

        if (this.showInputParams) {
            Object.keys(this).forEach(opt => {
                if (opt !== 'secretAccessKey' &&
                    opt !== 'password' &&
                    opt !== 'passphrase' &&
                    opt !== 's3') {
                    stdout.write(`${opt}=${this[opt]}\n`);
                }
            });
        }

        /* for other params*/
        // get number of workers
        this.nProcesses = (this.nWorkers === 0) ? 1 : this.nWorkers;
        this.currThreadIdx = 0;
        this.nThreads = this.paralReqs[this.currThreadIdx];
        this.initRThreads = this.paralReqs;
        this.genDelays();

        this.actionFlag = [];
        this.buckets = [];
        this.createdBucketsNb = 0;

        this.initNbOps = this.observationsNb;

        // check min value of part size
        if (this.partSizes) {
            this.partSizes.forEach((size, sizeIdx) => {
                if (size < minPartSize) {
                    stderr.write(`Part size (${size}) is too small. `);
                    stderr.write(`Set it be ${convertSize(minPartSize)}\n`);
                    this.partSizes[sizeIdx] = minPartSize;
                }
            });
        }

        // check compatibility sizes and partSizes
        if (this.partSizes) {
            const minObjSize = Math.min.apply(Math, this.sizes);
            const maxPartSize = Math.max.apply(Math, this.partSizes);
            // if there exists at least a size smaller than one part size
            if (minObjSize < maxPartSize) {
                stderr.write('An object size is smaller than a part size. ');
                // try to re-define part sizes
                if (minObjSize >= minPartSize) {
                    this.partSizes.forEach((size, sizeIdx) => {
                        if (size > minObjSize) {
                            this.partSizes[sizeIdx] = minObjSize;
                        }
                    });
                    stderr.write(`Reset part sizes: ${this.partSizes}\n`);
                } else {
                    stderr.write('Disable multipart upload\n');
                    this.partSizes = undefined;
                }
            }
        }

        // generate simulated objects
        if (this.partSizes) {
            this.values = this.partSizes.map(size => genObjs(size));
        } else {
            this.values = this.sizes.map(size => genObjs(size));
        }
        this.md5s = this.values.map(val =>
            crypto.createHash('md5').update(val).digest('hex'));

        this.currSizeIdx = 0;
        this.currPartSizeIdx = 0;
        this.value = this.values[this.currSizeIdx];
        this.size = this.sizes[this.currSizeIdx];
        if (this.partSizes) {
            this.partSize = this.partSizes[this.currPartSizeIdx];
        }

        this.currActions = [];
        this.actionsNb = 0;
        this.actionIdx = 0;
        // available actions for test
        this.allActions = createNewArray(requests.length, 1);
        this.allActions[PUT_OBJ] = this.put.bind(this);
        this.allActions[GET_OBJ] = this.get.bind(this);
        this.allActions[DEL_OBJ] = this.del.bind(this);
        this.allActions[LST_OBJ] = this.list.bind(this);
        this.allActions[COM_OBJ] = this.comb.bind(this);
        this.allActions[GET_ACL] = this.getAcl.bind(this);
        this.allActions[MPU_OBJ] = this.mpu.bind(this);
        this.actions = [];
        this.fracLoads = [];

        this.threshold = this.observationsNb;

        /* for stats */
        this.count = 0;
        this.threads = 0;
        const zeroArr = createNewArray(this.nbDataSizes, 0);
        const infinityArr = [];
        for (let idx = 0; idx < this.nbDataSizes; idx++) {
            infinityArr.push(Infinity);
        }
        this.nSuccesses = requests.map(() => zeroArr.slice());
        this.nFailures = requests.map(() => zeroArr.slice());
        this.nBytes = requests.map(() => zeroArr.slice());
        this.latSum = requests.map(() => zeroArr.slice());
        this.latSumSq = requests.map(() => zeroArr.slice());
        this.latMin = requests.map(() => infinityArr.slice());
        this.latMax = requests.map(() => zeroArr.slice());
        this.dataToPlot = requests.map(() =>
            this.sizes.map(() => [])
        );
        this.dataForThreadPlot = '';

        this.resetStatsAfterEachTest = false;

        /* for output data files */
        try {
            execSync(`mkdir -p ${defaultFileName}`);
        } catch (e) {
            if (e.code !== 'EEXIST') {
                stderr.write(`cannot create '${statsFolder}' folder\n`);
                return;
            }
        }

        this.statsExt = '_stats.txt';
        this.funcExt = '_func.txt';
        this.threadExt = '_thread.txt';
        this.realTimePerfExt = '_live.txt';
        this.ssmExt = '_ssm.txt';
        this.finalExt = '_summary.txt';
        this.idExt = '.id';

        this.statsFile = '';
        this.threadFile = '';
        this.realTimePerfFile = '';
        this.ssmFile = '';
        this.finalFile = '';
        /* For pdf and cdf */
        this.initFuncFiles = [`pdf${this.funcExt}`, `cdf${this.funcExt}`];
        this.funcFiles = this.initFuncFiles.slice();
        // for sampling latency

        this.pdf = requests.map(() => this.paralReqs.map(() =>
                    this.sizes.map(() => [])));
        this.cdf = requests.map(() => this.paralReqs.map(() =>
                    this.sizes.map(() => [])));

        this.latThread = undefined;
        this.startSimul = undefined;
        this.endSimul = undefined;
        this.latThreshold = Infinity;

        this.currIndx = requests.map(() => 0);
        this.currTime = undefined;
        this.stacks = requests.map(() => [0, 0, 0]);
        this.sendRates = requests.map(() => 0);
        this.ssmStats = '';
        this.realTimePerfStats = '';

        this.storedKeys = [];
        this.keysNb = [];
        this.files = [];
        this.data = [];
        this.perfs = [LAT_PERF, OPR_PERF];
        if (this.percentiles) {
            this.percentilesArr = requests.map(() => this.paralReqs.map(() =>
                        this.sizes.map(() => this.percentiles.map(() => 0))));
        }

        this.monitorMDsize = (this.mdPath && this.mdPath !== '');
        this.getMDsize = this.monitorMDsize;

        this.getMDRetriesNb = 0;
        // max number retries to get metadata sizes
        this.maxRetriesNb = 10 * servers.length;

        this.resConsuming = [0, 0];

        this.setActions(this.reqsToTest, this.proprReqs);
        this.checkConsistentParams();

        // array of workers: false -> not done, true: done
        if (cluster.isMaster) {
            this.workers = new Array(this.nWorkers).fill(0);
            this.testsNb = 0;
        }

        this.prefixKeyRand = genRandStr(8);
        this.startProg = process.hrtime();
    }

    assignRecursive(config) {
        Object.keys(config).forEach(key => {
            if (config[key].constructor === Object) {
                this.assignRecursive.bind(this)(config[key]);
            } else {
                this[key] = config[key]; // eslint-disable-line
            }
        });
    }

    startSSM(cb) {
        if (cluster.isMaster && this.ssm) {
            ssmSystem.start(ssmConfig, err => {
                if (err) {
                    this.ssm = false;
                    ssmSystem.terminate(() => {
                        stdout.write('All ssh connections are closed');
                    });
                }
                // if (this.resConsMonitor) {
                //     this.resConsumingFlag =
                //         setInterval(this.getResConsuming.bind(this),
                //                         this.rate, cb);
                // }
                return cb(err);
            });

            process.on('SIGINT', () => {
                stdout.write('Received SIGINT');
                ssmSystem.terminate(() => {
                    stdout.write('All ssh connections are closed');
                    process.exit();
                });
            });
        } else {
            return cb();
        }
        return undefined;
    }

    // delay between two consecutive sending requests
    genDelays() {
        this.delays = requests.map(() => 0);
        this.reqsToTest.forEach((req, reqIdx) => {
            this.delays[req] = (this.sendReqRates[reqIdx] === Infinity) ? 0 :
                    1000 * this.nThreads / this.sendReqRates[reqIdx];
        });
    }

    printParams() {
        const colLen = Math.floor(legendLineLen / 2);
        let info = [`Host: ${this.host}:${this.port}`,
            `S3Blaster workers nb: ${this.nWorkers}`,
            `Buckets nb: ${this.bucketsNb}`,
            `Objects nb: ${this.maxKey}`,
            `Objset sizes: ${this.sizes.map(size => convertSize(size))}`];
        if (this.partSizes) {
            info.push(`Part sizes: ${this.partSizes.map(size =>
                    convertSize(size))}`);
        }
        info = info.concat([
            `Parallel requests nb per worker (#PR): ${this.paralReqs}`,
            `Simulation schedule: ${this.schedule}`]);

        let reqStr = toFixedLength('#Request ', 15, 'left') +
            toFixedLength('max send rate (ops) ', 30, 'left') +
            toFixedLength('delay (ms) ', 15, 'left') +
            toFixedLength('proportion ', 15, 'left') +
            toFixedLength('range', 15, 'left');
        reqStr = `${toFixedLength(`${reqStr}`, legendLineLen, 'left')}\\n`;
        this.reqsToTest.forEach((req, idx) => {
            const str = toFixedLength(requests[req], 15, 'left') +
                toFixedLength(this.sendReqRates[idx], 30, 'left') +
                toFixedLength(this.delays[req], 15, 'left') +
                toFixedLength(this.fracLoads[idx].toFixed(2), 15, 'left') +
                toFixedLength(this.range[req], 15, 'left');
            reqStr += `#${toFixedLength(`${str}`, legendLineLen, 'left')}\\n`;
        });
        this.message = '';
        info.forEach((msg, idx) => {
            if (idx % 2 === 0) {
                this.message += '#';
            }
            this.message += toFixedLength(msg, colLen, 'left');
            if (idx % 2 === 1) {
                this.message += '\\n';
            }
        });
        this.message += `\\n${reqStr}\\nMessage: ${this.messageInit}\\n`;
    }

    showParams() {
        stdout.write('----- Input params -----\n');
        ['host', 'port', 'nOps', 'runTime', 'bucketPrefix',
            'nBuckets', 'sizes', 'nWorkers', 'rThreads', 'simulPolicy',
            'proprReqs', 'nextKey', 'maxKey', 'freqsToShow']
            .forEach(opt => stdout.write(`${opt}=${this[opt]}\n`));
    }

    checkConsistentParams() {
        if (this.schedule !== simulEach && this.schedule !== simulMixed) {
            stderr.write('Set simul schedule as simulEach\n');
            this.schedule = simulEach;
        }
        // check consistency of nOps and runTime
        if (this.threshold === Infinity && this.runTime === Infinity) {
            stderr.write('Number of operations and running time are currently');
            stderr.write(` infinity. Set running time to be 60s\n`);
            this.runTime = 60;
        }
        if (this.schedule === simulMixed && this.runTime !== Infinity) {
            this.runTime *= this.reqsToTest.length;
        }

        // check consistency of maxKey and range
        if (this.maxKey === Infinity) {
            this.maxKey = 0;
            this.range.forEach(range => {
                if (range[1] > this.maxKey) {
                    this.maxKey = range[1];
                }
            });
            if (this.maxKey === Infinity) {
                this.maxKey = defaultMaxKey;
                this.range.forEach((range, idx) => {
                    this.range[idx][1] = this.maxKey;
                });
            }
        }
        this.range.forEach((arr, idx) => {
            if (!arr) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr = [0, this.maxKey]; // eslint-disable-line
                this.range[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[0] > arr[1]) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr = [0, this.maxKey]; // eslint-disable-line
                this.range[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[0] < 0) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr[0] = 0; // eslint-disable-line
                this.range[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[1] > this.maxKey) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr[1] = this.maxKey; // eslint-disable-line
                this.range[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            }
        });
        if (this.showInputParams) {
            stdout.write('Indices range for each requests:\n');
            this.reqsToTest.forEach(req => {
                stdout.write(`${requests[req]}: ${this.range[req]}\n`);
            });
        }

        if (this.fillObjs && this.fillRange) {
            let modif = false;
            if (this.fillRange[0] < 0) {
                stderr.write(`Wrong input for fill-range: ${this.fillRange}\n`);
                this.fillRange[0] = 0;
                modif = true;
            }
            if (this.fillRange[1] < 0) {
                stderr.write(`Wrong input for fill-range: ${this.fillRange}\n`);
                this.fillRange[1] = this.maxKey;
                modif = true;
            }
            if (this.fillRange[0] > this.fillRange[1]) {
                stderr.write(`Wrong input for fill-range: ${this.fillRange}\n`);
                this.fillRange[0] = 0;
                modif = true;
            }
            if (this.fillRange[1] > this.maxKey) {
                stderr.write(`Max key of fill-range is out of range:
                    ${this.fillRange}\n`);
                this.fillRange[1] = this.maxKey;
                modif = true;
            }
            if (modif) {
                stderr.write(`Reset fill-range: ${this.fillRange}\n`);
            }
        }

        if (Object.keys(objMD).every(type => this.objMetadata !== type)) {
            this.objMetadata = objMD.compact;
        }

        if (this.nextKey !== nextKeyRand &&
            this.nextKey !== nextKeySeq) {
            this.nextKey = nextKeyRand;
            stderr.write('wrong arg for `nextKey`. Set it as nextKeyRand');
        }
        if (this.reqsToTest.length !== this.sendReqRates.length) {
            this.setReqRates.bind(this)();
        }
        if (cluster.isMaster) {
            // create file gathering results from all workers
            this.finalFile = this.prefixName + this.suffixName + this.finalExt;
            objToPlotter.arrDataFiles[dataFiles.final] = this.finalFile;
            if (this.ssm) {
                this.ssmFile = this.prefixName + this.suffixName +
                                            this.ssmExt;
                objToPlotter.arrDataFiles[dataFiles.ssm] = this.ssmFile;
            }
        }
        // update message if relevant
        this.printParams.bind(this)();

        // update objToPlotter
        if (cluster.isMaster) {
            objToPlotter.id =
                `${this.prefixName}${this.suffixName}_master${this.idExt}`;
        } else {
            objToPlotter.id =
                `${this.prefixName}${this.suffixName}_worker${this.idExt}`;
            process.send({
                workerId: objToPlotter.id,
            });
        }
        objToPlotter.config = {
            host: `${this.host}:${this.port}`,
            forks: `${this.nWorkers}`,
            bucketsNb: `${this.bucketsNb}`,
            objsNb: `${this.maxKey}`,
            proportion: `${this.fracLoads.map(frac => frac.toFixed(3))}`,
            range: `${this.range}`,
            sendReqRates: `${this.sendReqRates} (ops/s)`,
            delay: `${this.delays}`,
            schedule: `${this.schedule}`,
            prefixName: `${this.prefixName}`,
        };
        objToPlotter.requests = this.reqsToTest;
        objToPlotter.threads = this.paralReqs;
        objToPlotter.sizes = this.sizes;
        objToPlotter.percentiles = this.percentiles;
        objToPlotter.message = this.message;
        objToPlotter.resultsName = [
            'Number of successes',
            'Average of latency (ms)',
            'Standard-deviation of latency (ms)',
            'Number of parallel requests',
            'Average number of operations/s'];
        if (this.percentiles) {
            this.percentiles.forEach(perc => {
                objToPlotter.resultsName.push(
                    `${toFixedLength(`${perc * 100}%`, 10)}`);
            });
        }
        objToPlotter.fitPlot = this.fitPlot;
        objToPlotter.outputType = this.outputType;
        objToPlotter.results = requests.map(() => this.paralReqs.map(() =>
                    this.sizes.map(() => [])));

        /* only for Master: get realTimePerfFiles from all workers */
        if (cluster.isMaster) {
            objToPlotter.divisionMarks = this.paralReqs.map(() =>
                this.sizes.map(() => requests.map(() => 0)));
        }

        stdout.write(`Program starts...\n`);
        const header = `${toFixedLength('PID', 6)}` +
            `${toFixedLength('#Threads', 6)}` +
            `${toFixedLength('Operation', 14)}` +
            `${toFixedLength('Size', 10)}` +
            `${toFixedLength('#OK', 10)}` +
            `${toFixedLength('#Ops/s', 10)}` +
            `${toFixedLength('Min Lat', 10)}` +
            `${toFixedLength('Max Lat', 10)}` +
            `${toFixedLength('Avg Lat', 10)}` +
            `${toFixedLength('Std-dev Lat', 10)}\n`;
        stdout.write(header);
    }

    getInitMDSize(cb) {
        setTimeout(ssmSystem.getInitMDSize.bind(ssmSystem), 100, err => {
            if (err) {
                this.getMDRetriesNb++;
                if (this.getMDRetriesNb > this.maxRetriesNb) {
                    return cb(err);
                }
                return process.nextTick(this.getInitMDSize.bind(this), cb);
            }
            this.getMDRetriesNb = 0;
            return cb();
        });
    }

    calculateMDSize(cb) {
        ssmSystem.calculateMDSize.bind(ssmSystem)((err, mdSize) => {
            if (err) {
                this.getMDRetriesNb++;
                if (this.getMDRetriesNb > this.maxRetriesNb) {
                    return cb(err);
                }
                return process.nextTick(this.calculateMDSize.bind(this),
                                            cb);
            }
            return cb(null, mdSize);
        });
    }

    // Note: in the case of clustering, master creates also buckets that allows
    // it to clean databases at the end of simulation.
    init(cb) {
        this.resetPdfCdf();
        this.reqsToTest.forEach(req => {
            this.resetDataStats.bind(this)(req);
        });
        this.createdBucketsNb = 0;

        this.startSSM.bind(this)(err => {
            if (!err) {
                if (cluster.isMaster) {
                    this.monitorStats.bind(this)();
                }
            }
            if (this.ssm && (cluster.isWorker ||
                (cluster.isMaster && this.nWorkers === 0))) {
                this.realTimePerf();
            }
            this.createBuckets(err => {
                if (err) {
                    return cb(err);
                }
                if (cluster.isMaster && this.ssm) {
                    if (this.monitorMDsize) {
                        this.getInitMDSize.bind(this)(err => {
                            if (err) {
                                stderr.write(`Error get MD size: ${err}\n`);
                                this.getMDsize = false;
                            } else {
                                this.getMDsize = true;
                            }
                        });
                    }

                    this.createSsmFile(err => {
                        if (err) {
                            stderr.write(`Error create ssm file: ${err}`);
                            this.ssm = false;
                            ssmSystem.terminate(() => {
                                process.exit(0);
                            });
                        }
                    });
                }

                if (cluster.isMaster && this.nWorkers > 0) {
                    return cb();
                }

                return this.fillObjects(err => {
                    if (err) return cb(err);
                    return this.createDataFiles(cb);
                });
            });
        });
    }

    /**
     * set requests for each `it` test
     * @param {array} _actions: array of integer values each of which
     *  corresponds to index of requests: PUT_OBJ, LST_OBJ, GET_OBJ, DEL_OBJ
     *  or COM_OBJ. It is used to create a mask to choose requests in
     *  this.reqsToTest for tests. The request defined by this.reqsToTest[idx]
     *  is chosen to test if this.actionFlag[idx] = true;
     * @param {array} _fracs: array of numbers each of which
     *  corresponds to proportional frequency of testing requests
     * @return {this} this
     */
    setActions(_actions, _fracs) {
        let actions = _actions.slice();
        if (!_actions || _actions.length === 0) {
            actions = this.reqsToTest.slice();
        }
        const fracs = _fracs || this.proprReqs;

        this.currActions = [];
        this.actions = [];
        this.actionFlag = createNewArray(requests.length, -0);
        actions.forEach(action => {
            this.actionFlag[action] = true;
            this.actions.push(this.allActions[action]);
        });
        this.currActions = actions.slice();
        this.actionIdx = 0;
        this.actionsNb = this.currActions.length;
        this.threshold = this.observationsNb;
        if (this.schedule === simulMixed) {
            this.threshold *= (this.currActions.length * this.sizes.length);
        }
        if (this.maxKey === Infinity && this.observationsNb !== Infinity) {
            this.maxKey = this.threshold;
        }
        this.currSizeIdx = 0;
        this.value = this.values[this.currSizeIdx];
        this.size = this.sizes[this.currSizeIdx];
        this.setFracLoads(fracs);

        if (this.showInputParams) {
            stdout.write('requests [proportion]: ');
            this.currActions.forEach((action, idx) => {
                stdout.write(`${requests[action]}`);
                stdout.write(`[${this.fracLoads[idx].toFixed(2)}], `);
            });
            stdout.write(`\n`);
        }
    }

    /**
     * set proportions for each requests in `it` test
     * @param {array} fracs: array of numbers each of which
     *  corresponds to proportional frequency of testing requests
     * @return {this} this
     */
    setFracLoads(fracs) {
        if (fracs && fracs.length === this.actionsNb) {
            const fracLoads = fracs.map(frac => Number(frac));
            // normalize it
            const sum = fracLoads.reduce((a, b) => a + b, 0);
            if (sum > 0) {
                this.fracLoads = fracLoads.map(val => val / sum);
            }
        } else {
            if (fracs && fracs.length !== this.actionsNb) {
                stderr.write('input for `setFracLoads` must have ');
                stderr.write(`${this.actionsNb} numbers. `);
                stderr.write('Uniform proportion of requests are used.\n');
            }
            const frac = 1 / this.actionsNb;
            this.fracLoads = this.currActions.map(() => frac);
        }
    }

    /**
     * set data sizes for tests
     * @param {array} sizes: array of data sizes
     * @return {this} this
     */
    setSizes(sizes) {
        if (sizes.constructor === Array) {
            this.sizes = sizes;
            this.size = sizes[0];
            this.values = sizes.map(size =>
                crypto.randomBytes(size)
            );
            if (sizes.length !== this.nbDataSizes) {
                this.nbDataSizes = sizes.length;
                this.reqsToTest.forEach(req => {
                    this.resetDataStats(req);
                });
                this.dataToPlot = requests.map(() =>
                    this.sizes.map(() => [])
                );
            }
        } else {
            stderr.write(`input 'sizes' must be an array of number\n`);
        }
    }

    /**
     * set array of number of threads for tests
     * @param {array} arrThreads: array of data sizes
     * @return {this} this
     */
    setThreads(arrThreads) {
        if (arrThreads.constructor === Array) {
            this.paralReqs = arrThreads.slice();
            this.currThreadIdx = 0;
            this.nThreads = arrThreads[0];
        } else {
            if (arrThreads < 0) {
                this.paralReqs = this.initRThreads;
            } else {
                stderr.write(`input 'threads' must be an array of number\n`);
            }
        }
    }

    /**
     * set frequency to display/store stats
     * @param {number} nb: stats will be displayed/stored after `nb`
     *                      operations
     * @return {this} this
     */
    setFreqsToShow(nb) {
        if (nb > 0) {
            this.freqShow = nb;
        }
    }

    /**
     * set flag to reset stats after each `it` test
     * @param {boolean} flag: `true` -> stats will be reset after each
     *                              `it` test. `false` is otherwise.
     * @return {this} this
     */
    setResetStatsFlag(flag) {
        this.resetStatsAfterEachTest = flag;
    }

    setPrefixSuffixName(prefixName, suffixName) {
        if (prefixName !== defaultFileName) {
            this.prefixName = prefixName;
        }
        this.suffixName = suffixName;
    }

    /**
     * set list of requests to test
     * @param {array} reqsToTest: array of requests to tests. It
     * @return {this} this
     */
    setReqsToTest(reqsToTest) {
        if (reqsToTest !== this.reqsToTest) {
            this.reqsToTest = [];
            reqsToTest.forEach(req => {
                if (avaiReq.indexOf(req) > -1) {
                    this.reqsToTest.push(req);
                } else {
                    stderr.write('input `reqsToTest` contains wrong ' +
                                    `request ${req}\n`);
                }
            });
            if (this.reqsToTest.length === 0) {
                throw new Error(`no request to test\n`);
            }
            this.dataToPlot = requests.map(() =>
                this.sizes.map(() => [])
            );
        }
    }

    setNbOps(nOps) {
        if (nOps !== this.observationsNb) {
            if (nOps > 0) {
                this.observationsNb = parseInt(nOps, 10);
            } else {
                this.observationsNb = this.initNbOps;
            }
            this.threshold = this.observationsNb;
            this.freqShow = Math.ceil(this.observationsNb / 10);
        }
    }

    setReqRates(reqRates) {
        if (reqRates && Array.isArray(reqRates) &&
            reqRates.length >= this.reqsToTest.length) {
            this.sendReqRates =
                reqRates.slice(0, this.reqsToTest.length).map(rate => {
                    if (rate === 'max') {
                        return Infinity;
                    }
                    return Number(rate);
                });
        } else {
            stderr.write('Wrong input for sending request rates. ' +
                         'Set it being unlimited\n');
            this.sendReqRates = this.reqsToTest.map(() => Infinity);
        }
    }

    /**
     * function creates file storing stats:
     *  - average and standard, and percentiles
     *  - estimated pdf & cdf
     *  - latency and #operations/s vs. sizes
     *  - latency and #operations/s vs. #parallel requests
     *  - latency and #operations/s vs. elapsed time
     *  deviation of request latency
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createDataFiles(cb) {
        this.statsFile = this.prefixName + this.suffixName + this.statsExt;
        this.funcFiles.forEach((funcFile, idx) => {
            this.funcFiles[idx] = this.prefixName + this.initFuncFiles[idx];
        });
        this.threadFile = this.prefixName + this.suffixName + this.threadExt;
        this.realTimePerfFile = this.prefixName + this.suffixName +
                                    this.realTimePerfExt;

        objToPlotter.arrDataFiles[dataFiles.stats] = this.statsFile;
        objToPlotter.arrDataFiles[dataFiles.pdfCdf] = this.funcFiles;
        objToPlotter.arrDataFiles[dataFiles.thread] = this.threadFile;
        objToPlotter.arrDataFiles[dataFiles.live] = this.realTimePerfFile;

        function genConfigPart() {
            return `# Configuration info\n# Date ${new Date()}\n` +
                   `${this.message}\n# End_configuration\n`;
        }

        function createStatsFile(cb) {
            let label = `${toFixedLength('#Successes', 10)}` +
                        `${toFixedLength('#Paral-req', 10)}` +
                        `${toFixedLength('Average', 10)}` +
                        `${toFixedLength('Std.-dev.', 10)}`;
            if (this.percentiles) {
                this.percentiles.forEach(perc => {
                    label += `${toFixedLength(`${perc * 100}%`, 10)}`;
                });
            }
            const groupSizeLen = label.length;
            const groupReqLen = groupSizeLen * this.sizes.length;
            let content = genConfigPart.bind(this)();
            /* add column headers*/
            content += '#';
            this.reqsToTest.forEach(req => {
                content +=
                    `${toFixedLength(requests[req], groupReqLen, 'center')} ||`;
            });
            content += '\n#';
            this.reqsToTest.forEach(() => {
                this.sizes.forEach(size => {
                    content +=
                        `${toFixedLength(size, groupSizeLen, 'center')} |`;
                });
            });
            content += '\n';
            this.reqsToTest.forEach(() => {
                this.sizes.forEach(() => {
                    content += label;
                });
            });
            content += `\n`;
            /* create files */
            fs.writeFile(this.statsFile, content, cb);
        }

        function createFuncFiles(cb) {
            let count = 0;
            this.funcFiles.forEach(funcFile => {
                fs.writeFile(funcFile, `#\n`, err => {
                    if (err) {
                        cb(err); return;
                    }
                    count += 1;
                    if (count === this.funcFiles.length) {
                        cb(); return;
                    }
                });
            });
        }

        function createThreadFile(cb) {
            let content = genConfigPart.bind(this)();
            /* add column headers*/
            content += `# ${toFixedLength('#Thread', 8)} ` +
                       `${toFixedLength('Size', 8)} `;
            this.reqsToTest.forEach(req => {
                content += ` ${toFixedLength(requests[req], 16)} `;
            });
            content += `\n`;
            /* create files */
            fs.writeFile(this.threadFile, content, cb);
        }

        function createRealTimePerfFile(cb) {
            let content = genConfigPart.bind(this)();
            /* add column headers*/
            content += `# ${toFixedLength('#Thread', 8)} ` +
                       `${toFixedLength('Size', 8)} `;
            this.reqsToTest.forEach(req => {
                content += ` ${toFixedLength(requests[req], 16)} `;
            });
            content += `\n`;
            /* create files */
            fs.writeFile(this.realTimePerfFile, content, cb);
        }

        let count = 0;
        const funcsArr = [createStatsFile, createFuncFiles, createThreadFile,
            createRealTimePerfFile];
        funcsArr.forEach(func => {
            func.bind(this)(err => {
                if (err) {
                    cb(err); return;
                }
                count += 1;
                if (count === funcsArr.length) {
                    cb(); return;
                }
            });
        });
    }

    /**
     * function creates file storing ssm stats:
     * @param {function} cb: callback function
     * @return {function} callback
     */
    createSsmFile(cb) {
        function genConfigPart() {
            return `# Configuration info\n# Date ${new Date()}\n` +
                   `${this.message}\n# End_configuration\n`;
        }

        let content = genConfigPart.bind(this)();
        /* add column headers*/
        content += `# ${toFixedLength('#Thread', 8)} ` +
                   `${toFixedLength('Size', 8)} `;
        this.reqsToTest.forEach(req => {
            content += ` ${toFixedLength(requests[req], 16)} `;
        });
        content += `\n`;
        /* create files */
        fs.writeFile(this.ssmFile, content, cb);
    }

    printStats(idx, _sizeIdx) {
        const sizeIdx = _sizeIdx || this.currSizeIdx;
        this.currRunTime = getHrTime(this.startSimul);
        const nSuccesses = this.nSuccesses[idx][sizeIdx];
        // const nFailures = this.nFailures[idx][sizeIdx];
        const nOpsSec = this.nSuccesses[idx][sizeIdx] * 1e3 /
                                                        this.currRunTime;
        const latMu = this.latSum[idx][sizeIdx] / nSuccesses;
        const latSigma = Math.sqrt(this.latSumSq[idx][sizeIdx] /
                                    nSuccesses - latMu * latMu);
        const latMin = this.latMin[idx][sizeIdx].toFixed(2);
        const latMax = this.latMax[idx][sizeIdx].toFixed(2);
        if (!this.ssm || this.liveGlobal) {
            stdout.write(`${toFixedLength(process.pid, 6)}`);
            stdout.write(`${toFixedLength(this.nThreads, 6)}`);
            stdout.write(`${toFixedLength(requests[idx], 14)}`);
            stdout.write(
                `${toFixedLength(convertSize(this.sizes[sizeIdx]), 10)}`);
            stdout.write(`${toFixedLength(nSuccesses, 10)}`);
            stdout.write(`${toFixedLength(nOpsSec.toFixed(2), 10)}`);
            stdout.write(`${toFixedLength(latMin, 10)}`);
            stdout.write(`${toFixedLength(latMax, 10)}`);
            stdout.write(`${toFixedLength(latMu.toFixed(2), 10)}`);
            stdout.write(`${toFixedLength(latSigma.toFixed(2), 10)}\n`);
        }
        let valuesToPlot =
            [nSuccesses.toFixed(0), latMu.toFixed(2), latSigma.toFixed(2),
                this.nThreads.toFixed(0), nOpsSec.toFixed(2)];
        if (this.percentiles) {
            this.computePercentiles(idx, sizeIdx);
            valuesToPlot = valuesToPlot.concat(
                this.percentilesArr[idx][this.currThreadIdx][sizeIdx]);
        }
        this.dataToPlot[idx][sizeIdx].push(valuesToPlot);
    }

    /*
     * Update objToPlotter.results[req][thread][size] contains an array
     * [#ok, lat_avg, lat_std, #thread, #ops_avg, {percentiles}]
     */
    updateResForPlotter() {
        this.reqsToTest.forEach(req => {
            objToPlotter.results[req][this.currThreadIdx]
                [this.currSizeIdx] = this.dataToPlot[req][this.currSizeIdx]
                    [this.dataToPlot[req][this.currSizeIdx].length - 1];
        });
    }
    /**
     * Configuration info is stored on top of the file
     * Data was stored with the structure of columns which are divided in
     * groups. Each group corresponds to a type of request. A group is composed
     * of sub-groups each for a data size. In each sub-group:
     * - 1st col: #successes
     * - 2nd col: #parallel requests
     * - 3rd cols: average latency
     * - 4th cols: standard-deviation latency
     * - next columns: for percentiles
     * @param {function} cb: callback function
     * @return {function} callback
     */
    updateDataFile(cb) {
        if (cluster.isMaster && this.nWorkers > 0) {
            cb(); return;
        }
        let next = true;
        let idx = 0;
        let content = '';
        while (next) {
            next = false;
            this.reqsToTest.forEach(req => { // eslint-disable-line
                this.sizes.forEach((size, sizeIdx) => {
                    if (this.dataToPlot[req][sizeIdx][idx]) {
                        next = true;
                    } else {
                        next = next || false;
                    }
                    let value = this.dataToPlot[req][sizeIdx][idx];
                    if (!value) {
                        value = ['?0/1', '?0/1', '?0/1', '?0/1', '?0/1'];
                        if (this.percentiles) {
                            for (let idxp = 0; idxp < this.percentiles.length;
                                idxp++) {
                                value.push('?0/1');
                            }
                        }
                    }
                    content += `${toFixedLength(value[0], 10)}` +
                               `${toFixedLength(value[3], 10)}` +
                               `${toFixedLength(value[1], 10)}` +
                               `${toFixedLength(value[2], 10)}`;
                    if (this.percentiles) {
                        for (let idxp = 0; idxp < this.percentiles.length;
                            idxp++) {
                            content += `${toFixedLength(value[idxp + 5], 10)}`;
                        }
                    }
                });
            });
            content += '\n';
            idx++;
        }
        fs.appendFile(this.statsFile, content, err => {
            if (err) {
                return cb(err);
            }
            if (this.resetStatsAfterEachTest) {
                return this.resetDataToPlot(cb);
            }
            return cb();
        });
    }

    /**
     * Configuration info is stored on top of the file
     * Data was stored with the structure of columns. First column
     *  contains number presenting latency sizes. Next columns are
     *  grouped by requet types for test. Each group is composed of sub-graphs
     *  each for a number of threads. Each sub-group contains columns each for
     *  a data size.
     * @param {function} cb: callback function
     * @return {function} callback
     */
    updateFuncFiles(cb) {
        /* compute pdf and cdf */
        this.finalizePdfCdf();
        let count = 0;
        const funcArr = [this.pdf, this.cdf];

        let headerContent;
        this.funcFiles.forEach((file, fileIdx) => {
            headerContent = `# Configuration info\n`;
            /* add metadata info */
            headerContent += `# host ${this.host}:${this.port}\n`;
            headerContent += `# bucketsNb ${this.bucketsNb}\n`;
            headerContent += `# processesNb ${this.nProcesses}\n`;
            headerContent += `# threadsNb ${this.nThreads}\n`;
            headerContent += `# nOps ${this.threshold}\n`;
            headerContent += '# sizes';
            this.sizes.forEach(size => {
                headerContent += ` ${size}`;
            });
            headerContent += `\n# requests`;
            this.reqsToTest.forEach(req => {
                headerContent += ` ${req}`;
            });
            headerContent += `\n# End_configuration\n`;
            /* add column headers*/
            headerContent += '# Data size';
            let label = '';
            this.reqsToTest.forEach(idx => {
                label += `${requests[idx]}  `;
            });
            this.sizes.forEach(size => {
                const len = (label.length - size.toString().length) / 2;
                const space = toFixedLength(' ', len);
                headerContent += space + size.toString() + space;
            });
            headerContent += `\n# Latency `;
            this.sizes.forEach(() => {
                headerContent += label;
            });
            headerContent += `\n`;

            /* distribution function */
            const distr = funcArr[fileIdx];
            // init
            let samplesNb = 0;
            distr.forEach(distrPerReq => {  // for each request
                distrPerReq.forEach(distrPerThr => { // for each #threads
                    distrPerThr.forEach(distrPerSize => { // for each obj size
                        if (distrPerSize.length > samplesNb) {
                            samplesNb = distrPerSize.length;
                        }
                    });
                });
            });
            const data = new Array(samplesNb).fill('');
            // construct data
            this.reqsToTest.forEach(req => {
                const distrPerReq = distr[req];
                distrPerReq.forEach(distrPerThr => { // for each #threads
                    distrPerThr.forEach(distrPerSize => { // for each obj size
                        for (let idx = 0; idx < samplesNb; idx++) {
                            const lat = distrPerSize[idx];
                            if (lat) {
                                data[idx] +=
                                    `${toFixedLength(lat.toFixed(3), 7)}  `;
                            } else {
                                data[idx] += `${toFixedLength('?0/1', 7)}  `;
                            }
                        }
                    });
                });
            });

            let dataContent = '';
            data.forEach((str, idx) => {
                dataContent +=
                `${toFixedLength((this.samplingStep * idx).toFixed(1), 9)} ` +
                    `${data[idx]}\n`;
            });

            fs.writeFile(file, headerContent, err => {
                if (err) {
                    cb(err); return;
                }
                fs.appendFile(file, dataContent, err => {
                    if (err) {
                        cb(err); return;
                    }
                    count += 1;
                    if (count === this.funcFiles.length) {
                        cb(); return;
                    }
                });
            });
        });
    }

    /**
     * Configuration info is stored on top of the file
     * Data was stored with the structure of columns. First column
     *  contains number of threads. Second column contains data size.
     *  Next columns are group by two
     * - 1st col: average value
     * - 2nd col: standard deviation
     * - 3rd col: average #operations/s
     * Each group of two columns corresponds to a request type
     * @param {number} reqIdx: index of current request (optinal)
     * @return {function} callback
     */
    updateThreadStats() {
        let dataContent = '';
        this.sizes.forEach((size, sizeIdx) => {
            dataContent += `${toFixedLength(this.nThreads, 10)} ` +
                           `${toFixedLength(size, 16)} `;
            this.reqsToTest.forEach(actIdx => {
                const arr = this.dataToPlot[actIdx][sizeIdx][
                            this.dataToPlot[actIdx][sizeIdx].length - 1];
                if (arr && arr.length > 2) {
                    dataContent += `${toFixedLength(arr[1], 10)} ` +
                                   `${toFixedLength(arr[2], 10)} ` +
                                   `${toFixedLength(arr[4], 10)} `;
                }
            });
            dataContent += `\n`;
        });
        this.dataForThreadPlot += dataContent;
    }

    updateThreadFile(cb) {
        fs.appendFile(this.threadFile, this.dataForThreadPlot, cb);
    }

    /**
     * Configuration info is stored on top of the file
     * Data was stored with the structure of columns. First column
     *  contains run time. Next columns contains ssm stats
     *  These columns are divided in groups each corresponds to
     *      a server. Each column in a group corresponds to a monitored pattern
     *      that is defined in ssm/src/config.js
     * @param {function} cb: callback function
     * @return {function} callback
     */
    updateSsmFile(cb) {
        fs.appendFile(this.ssmFile, this.ssmStats, cb);
    }

    /**
     * Configuration info is stored on top of the file
     * Data was stored with the structure of columns. First column
     *  contains run time. Next columns contains real-time perf stats
     *  These columns are divided in groups each
     *      corresponds to a request. There are 3 columns per sub-group for:
     *      1) live average latency
     *      2) live standard-deviabtion latency
     *      3) live number of operations/second
     *  The 'real-time' term means that perfs are measured for the last second.
     * @param {function} cb: callback function
     * @return {function} callback
     */
    updateRealTimePerfFile(cb) {
        fs.appendFile(this.realTimePerfFile, this.realTimePerfStats, cb);
    }

    updateStatsFiles(cb) {
        objToPlotter.runTime = (getHrTime(this.startProg) / 1e3).toFixed(0);
        let nbStatsFile = 3;
        let count = 0;

        // update live file of successful workers
        if (cluster.isMaster) {
            if (this.nWorkers === 0) {
                objToPlotter.procNames[0] = 'Master';
                objToPlotter.allRealTimeFiles[0] =
                    `${statsFolder}` +
                    `${this.output}${this.realTimePerfExt}`;
            } else {
                let id = 0;
                for (let idx = 1; idx <= this.nWorkers; idx++) {
                    if (this.workers[idx - 1] === this.testsNb) {
                        objToPlotter.procNames[id] = `Worker${idx}`;
                        objToPlotter.allRealTimeFiles[id] =
                            `${statsFolder}worker${idx}/` +
                            `${this.output}${this.realTimePerfExt}`;
                        id++;
                    }
                }
                // update number of processes if relevant
                this.nProcesses = id;
            }
        }

        if (cluster.isMaster && this.nWorkers > 0) {
            if (this.ssm) {
                return this.updateSsmFile.bind(this)(cb);
            }
            return cb();
        } else if (cluster.isMaster && this.nWorkers === 0 && this.ssm) {
            nbStatsFile++;
            this.updateSsmFile.bind(this)(err => {
                if (err) {
                    return cb(err);
                }
                count += 1;
                if (count === nbStatsFile) {
                    return cb();
                }
                return undefined;
            });
        }

        this.updateFuncFiles.bind(this)(err => {
            if (err) {
                return cb(err);
            }
            count += 1;
            if (count === nbStatsFile) {
                return cb();
            }
            return undefined;
        });

        this.updateThreadFile.bind(this)(err => {
            if (err) {
                return cb(err);
            }
            this.dataForThreadPlot = '';
            count += 1;
            if (count === nbStatsFile) {
                return cb();
            }
            return undefined;
        });

        this.updateRealTimePerfFile.bind(this)(err => {
            if (err) {
                return cb(err);
            }
            count += 1;
            if (count === nbStatsFile) {
                return cb();
            }
            return undefined;
        });
        return undefined;
    }

    resetStats(idx) {
        this.count = 0;
        this.threads = 0;
        if (this.resetStatsAfterEachTest || this.paralReqs.length > 1) {
            this.resetDataStats.bind(this)(idx);
        }
    }

    resetDataStats(req) {
        const zeroArr = createNewArray(this.nbDataSizes, 0);
        const infinityArr = [];
        for (let idx = 0; idx < this.nbDataSizes; idx++) {
            infinityArr.push(Infinity);
        }
        this.latSum[req] = zeroArr.slice();
        this.latSumSq[req] = zeroArr.slice();
        this.nBytes[req] = zeroArr.slice();
        this.nSuccesses[req] = zeroArr.slice();
        this.nFailures[req] = zeroArr.slice();
        this.latMin[req] = infinityArr.slice();
        this.latMax[req] = zeroArr.slice();
        if (this.resetStatsAfterEachTest) {
            this.pdf[req][this.currThreadIdx] = this.sizes.map(() => []);
            this.cdf[req][this.currThreadIdx] = this.sizes.map(() => []);
        }
    }

    resetPdfCdf() {
        this.pdf = requests.map(() => this.paralReqs.map(() =>
                    this.sizes.map(() => [])));
        this.cdf = requests.map(() => this.paralReqs.map(() =>
                    this.sizes.map(() => [])));
    }

    resetDataToPlot(cb) {
        this.reqsToTest.forEach((req, reqIdx) => {
            this.sizes.forEach((size, sizeIdx) => {
                this.dataToPlot[reqIdx][sizeIdx] = [];
            });
        });
        cb();
    }

    createBucket(bucketName, cb) {
        const begin = process.hrtime();
        this.s3.createBucket({ Bucket: bucketName }, err => {
            const end = process.hrtime(begin);
            if (!err) {
                return cb(null, end);
            }
            stderr.write(`createBucket: ${err.code}..`);
            return cb((err.code === 'BucketAlreadyExists' ||
                    err.code === 'BucketAlreadyOwnedByYou') ? null : err.code);
        });
    }

    deleteBucket(bucketName, cb) {
        const begin = process.hrtime();
        this.s3.deleteBucket({ Bucket: bucketName }, err => {
            const end = process.hrtime(begin);
            if (err) {
                stderr.write(`delete ${bucketName} ${err}\n`);
                return cb(err);
            }
            return cb(null, end);
        });
    }

    listAllObjects(bucketName, callback, prefix, marker, lat, totalNbObjs) {
        this.listObject(bucketName, (err, value, time, nObjs, nextMarker) => {
            if (!err) {
                if (nextMarker) {
                    return this.listAllObjects(bucketName, callback, prefix,
                                            nextMarker, time, nObjs);
                }
                return callback(null, value, time / nObjs);
            }
            return callback(err);
        }, null, prefix, marker, lat, totalNbObjs);
    }

    listObject(bucketName, callback, maxKeys, prefix, marker, cumLat, nObjs) {
        const params = {
            Bucket: bucketName,
            MaxKeys: maxKeys || 1000,
            Prefix: prefix,
            Marker: marker,
        };
        const begin = process.hrtime();
        this.s3.listObjects(params, (err, value) => {
            let lat = getHrTime(begin);
            if (err) {
                stderr.write(`list ${bucketName} NOK: `);
                stderr.write(`${err.code} ${err.message}\n`);
                return callback(err);
            }
            let nextMarker;
            const currNbObjs = value.Contents.length;
            if (currNbObjs === 0) {
                return callback(null, value, cumLat, nObjs);
            }
            if (value.IsTruncated) {
                nextMarker = value.Contents[currNbObjs - 1].Key;
            }
            lat += cumLat;
            const newNbObjs = nObjs + currNbObjs;
            return callback(null, value, lat, newNbObjs, nextMarker);
        });
    }

    /* get min value of 2D array */
    getMinValue(arr) {
        let arr1D = [];
        this.currActions.forEach(idx => {
            arr1D = arr1D.concat(arr[idx]);
        });
        return Math.min.apply(Math, arr1D);
    }

    updateStats(req, sizeIdx, time) {
        let lat = time;
        this.stacks[req][0]++;
        this.stacks[req][1] += lat;
        this.stacks[req][2] += lat * lat;
        this.latSum[req][sizeIdx] += lat;
        this.latSumSq[req][sizeIdx] += lat * lat;
        this.nBytes[req][sizeIdx] += this.size;
        this.nSuccesses[req][sizeIdx]++;
        if (lat < this.latMin[req][sizeIdx]) {
            this.latMin[req][sizeIdx] = lat;
        }
        if (lat > this.latMax[req][sizeIdx]) {
            this.latMax[req][sizeIdx] = lat;
        }
        lat = Math.floor(lat / this.samplingStep);
        if (!this.pdf[req][this.currThreadIdx][sizeIdx][lat]) {
            this.pdf[req][this.currThreadIdx][sizeIdx][lat] = 1;
        } else {
            this.pdf[req][this.currThreadIdx][sizeIdx][lat]++;
        }
    }

    finalizePdfCdf() {
        /* normalize pdf, and then compute cdf */
        this.pdf.forEach((pdfPerReq, idxA) => { // for each request
            pdfPerReq.forEach((pdfPerThr, idxB) => { // for each #threads
                pdfPerThr.forEach((pdf, idxC) => { // for each obj size
                    if (pdf.length > 0) {
                        const sum = pdf.reduce((a, b) => a + b);
                        if (sum > 0) {
                            // normalize pdf
                            pdf.forEach((val, idx) => {
                                this.pdf[idxA][idxB][idxC][idx] = val / sum;
                            });
                            /* compute cdf from pdf */
                            pdf.reduce((a, b, idx) => {
                                this.cdf[idxA][idxB][idxC][idx] = a + b;
                                return this.cdf[idxA][idxB][idxC][idx];
                            }, 0);
                        }
                    }
                });
            });
        });
    }

    computeAllPercentiles() {
        this.pdf.forEach((pdfPerReq, idxA) => {
            pdfPerReq.forEach((pdfPerThr, idxB) => {
                pdfPerThr.forEach((pdf, idxC) => {
                    if (pdf.length > 0) {
                        pdf.reduce((a, b, idx) => {
                            this.cdf[idxA][idxB][idxC][idx] = a + b;
                            return this.cdf[idxA][idxB][idxC][idx];
                        }, 0);
                        // normalize _cdf
                        const max = this.cdf[idxA][idxB][idxC]
                                        [this.cdf[idxA][idxB][idxC].length - 1];
                        if (max > 0) {
                            // normalize cdf
                            this.cdf[idxA][idxB][idxC].forEach((val, idx) => {
                                this.cdf[idxA][idxB][idxC][idx] = val / max;
                            });
                            let percIndx = 0;
                            this.percentiles.forEach((marker, idx) => {
                                while (!this.cdf[idxA][idxB][idxC][percIndx] ||
                                    this.cdf[idxA][idxB][idxC][percIndx] <
                                        marker) {
                                    percIndx++;
                                }
                                this.percentilesArr[idxA][idxB][idxC][idx] =
                                                percIndx * this.samplingStep;
                            });
                        }
                    }
                });
            });
        });
    }

    computePercentiles(req, sizeIdx) {
        const thrIdx = this.currThreadIdx;
        if (this.pdf[req][thrIdx][sizeIdx].length > 0) {
            this.pdf[req][thrIdx][sizeIdx].reduce((a, b, idx) => {
                this.cdf[req][thrIdx][sizeIdx][idx] = a + b;
                return this.cdf[req][thrIdx][sizeIdx][idx];
            }, 0);
            // normalize this.cdf
            const max = this.cdf[req][thrIdx][sizeIdx]
                                    [this.cdf[req][thrIdx][sizeIdx].length - 1];
            if (max > 0) {
                this.cdf[req][thrIdx][sizeIdx].forEach((val, idx) => {
                    this.cdf[req][thrIdx][sizeIdx][idx] = val / max;
                });
                let percIndx = 0;
                this.percentiles.forEach((marker, idx) => {
                    while (!this.cdf[req][thrIdx][sizeIdx][percIndx] ||
                        this.cdf[req][thrIdx][sizeIdx][percIndx] < marker) {
                        percIndx++;
                    }
                    this.percentilesArr[req][thrIdx][sizeIdx][idx] =
                                                percIndx * this.samplingStep;
                });
            }
        }
    }

    createBuckets(cb) {
        const bucketName = `${this.bucketPrefix}${this.createdBucketsNb}`;
        stdout.write(`creating bucket ${bucketName}..`);
        this.createBucket(bucketName, err => {
            if (err) {
                return cb(`error creating bucket ${bucketName}: ${err}\n`);
            }
            stdout.write(`createBuckets done\n`);
            this.buckets.push(bucketName);
            mdInfo.bucketsList.push(bucketName);
            this.storedKeys[bucketName] = this.sizes.map(() => []);
            this.keysNb[bucketName] = this.sizes.map(() => 0);
            this.createdBucketsNb += 1;
            if (this.createdBucketsNb === this.bucketsNb) {
                return cb();
            }
            return process.nextTick(this.createBuckets.bind(this), cb);
        });
    }

    cleanBucket(bucketName, cb) {
        const maxParalDelsNbPerBkt = parseInt(1e3 / this.createdBucketsNb, 10);
        this.listObject(bucketName, (err, value) => {
            if (err) {
                return cb(err);
            }
            if (value.Contents.length === 0) {
                return cb();
            }
            let count = 0;
            value.Contents.forEach(obj => {
                const object = {
                    Key: obj.Key,
                    Bucket: bucketName,
                };
                this.s3.deleteObject(object, err => {
                    if (err) {
                        if (err.toString().split(':')[0] !== 'NoSuchKey') {
                            return cb(err);
                        }
                        count -= 1;
                    }
                    count += 1;
                    if (count === value.Contents.length) {
                        setTimeout(this.cleanBucket.bind(this), 100, bucketName,
                                    cb);
                    }
                    return undefined;
                });
            });
            return undefined;
        }, maxParalDelsNbPerBkt);
    }

    /**
     * Create objects in each bucket
     * @param {function} cb: callback function
     * @param {number} _keyMin: key min of filling objects
     * @param {number} _keyMax: key max of filling objects
     * @param {number} _threadsNb: number of threads for filling objects
     * @return {this}: this
     */
    fillObjects(cb, _keyMin, _keyMax, _threadsNb) {
        if (cluster.isMaster && this.nWorkers > 0) {
            return cb();
        }
        if (!this.fillObjs) {
            return cb();
        }

        const threadsNb = _threadsNb || this.fillThreads ||
                                Math.max.apply(Math, this.paralReqs);

        const keyMin = _keyMin || this.fillRange[0] || 0;
        const keyMax = _keyMax || this.fillRange[1] || this.maxKey;
        const fillObsNb = keyMax - keyMin;
        if (fillObsNb === 0) {
            return cb();
        }

        stdout.write(`filling ${fillObsNb} objects in each bucket..`);
        let count = 0;
        let bucketIndx = 0;
        let sizeIndx = 0;
        let createdObjsNb = 0;
        const totalObjsNb = fillObsNb * this.sizes.length * this.buckets.length;

        function putObj(cb) {
            count++;
            if (count % (fillObsNb + 1) === 0) {
                sizeIndx++;
                if (sizeIndx >= this.sizes.length) {
                    sizeIndx = 0;
                    bucketIndx++;
                }
            }

            if (count > totalObjsNb) {
                return undefined;
            }

            const bucket = this.buckets[bucketIndx];
            const keyIndx = keyMin + ((count - 1) % (keyMax - keyMin));
            const size = this.sizes[sizeIndx];
            const key = this.genKey(keyIndx, size);
            const value = this.values[sizeIndx];
            const object = {
                Key: key,
                Bucket: bucket,
                Body: value,
                ContentLength: size,
            };

            if (this.objMetadata === objMD.STANDARD ||
                this.objMetadata === objMD.FULL) {
                object.ACL = 'bucket-owner-full-control';
                object.ContentMD5 = this.md5s[this.currSizeIdx];
                object.ContentType = 'text/plain';
            }

            if (this.objMetadata === objMD.FULL) {
                object.CacheControl = 'max-age=1';
                object.ContentDisposition = 's3blaster';
                object.ContentEncoding = 'noEncoding';
                object.ContentLanguage = 'French';
                object.Expires =
                    new Date('Wed Dec 31 2050 16:00:00 GMT-0800 (PST)');
                object.GrantFullControl = 'WRITE_ACP';
                object.GrantRead = 'true';
                object.GrantReadACP = 'true';
                object.GrantWriteACP = 'true';
                object.Metadata = {
                    UKS: crypto.randomBytes(20).toString('hex'),
                };
                object.RequestPayer = 'requester';
                object.StorageClass = 'STANDARD';
                object.WebsiteRedirectLocation = 'WebsiteRedirectLocation';
            }

            return this.s3.putObject(object, err => {
                if (err) {
                    stdout.write(`fill ${object.Key} to ${bucket}: ${err}\n`);
                    return cb(err);
                }
                if (this.workOnCurrObjs &&
                    !this.storedKeys[bucket][sizeIndx][object.Key]) {
                    this.storedKeys[bucket][sizeIndx][object.Key] = true;
                    this.keysNb[bucket][sizeIndx]++;
                }

                createdObjsNb++;
                if (createdObjsNb % 1000 === 0) {
                    process.stdout.write(`filled ${createdObjsNb} objets\n`);
                }

                if (createdObjsNb === totalObjsNb) {
                    stdout.write(`fillObjects done\n`);
                    return cb();
                }
                return putObj.bind(this)(cb);
            });
        }

        for (let idx = 0; idx < threadsNb; idx++) {
            process.nextTick(putObj.bind(this), cb);
        }
        return undefined;
    }

    clearDataSimul(cb) {
        // If clustering is enable, only master can clean databases
        if (cluster.isWorker) {
            return cb();
        }
        if (this.dontCleanDB) {
            // in there are workers, gatherResults should be launched once all
            // workers finish.
            if (cluster.isMaster && this.nWorkers === 0) {
                return this.gatherResults(cb);
            }
            return cb();
        }

        stdout.write('cleaning databases..');
        let count = 0;
        return this.buckets.forEach(bucketName => {
            this.cleanBucket(bucketName, err => {
                if (err) {
                    return cb(err);
                }
                stdout.write(`deleting bucket ${bucketName}..\n`);
                return this.deleteBucket(bucketName, err => {
                    if (err) {
                        return cb(err);
                    }
                    stdout.write(`bucket ${bucketName} is deleted\n`);
                    count += 1;
                    if (count === this.buckets.length) {
                        this.buckets = [];
                        this.createdBucketsNb = 0;
                        stdout.write('clearDB done\n');
                        if (cluster.isMaster && this.nWorkers === 0) {
                            return this.gatherResults(cb);
                        }
                        return cb();
                    }
                    return undefined;
                });
            });
        });
    }

    doSimul(cb) {
        let doneWorkersNb = 0;
        this.currTime = process.hrtime();
        if (this.actionFlag[COM_OBJ]) {
            [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                this.resetStats(req);
            });
        }
        this.currActions.forEach(req => {
            this.resetStats(req);
        });

        this.currIndx = requests.map((req, reqIdx) => this.range[reqIdx][0]);

        // generate delays here since delays could vary if there are multiple
        // number of parallel requests
        this.genDelays();

        if (!this.actionFlag.every(req => req === -0)) {
            this.latThread = requests.map(() =>
                createNewArray(this.nThreads, 0)
            );
            this.startSimul = process.hrtime();
            if (cluster.isMaster) {
                while (!cluster.workers ||
                    Object.keys(cluster.workers).length < this.nWorkers) {
                    cluster.fork();
                }
                for (const i in cluster.workers) {
                    if (cluster.workers[i]) {
                        cluster.workers[i].on('message', msg => { //eslint-disable-line
                            if (msg.done) {
                                // stdout.write(`Worker to master: ${msg}\n`);
                                doneWorkersNb++;
                                if (doneWorkersNb ===
                                    Object.keys(cluster.workers).length) {
                                    this.testsNb++;
                                    doneWorkersNb = 0;
                                    objToPlotter.divisionMarks[msg.thread]
                                        [msg.size][msg.request] = msg.time;
                            // stdout.write('All workers done, continue all\n');
                                    for (const id in cluster.workers) {
                                        if (cluster.workers[id]) {
                                            this.workers[id - 1]++;
                                            cluster.workers[id].send(
                                                'continue');
                                        }
                                    }
                                }
                            }
                            if (msg.workerId) {
                                // stdout.write(`Workerid to master: ${msg}\n`);
                                objToPlotter.workersId.push(msg.workerId);
                            }
                        });
                    }
                }
                if (this.nWorkers === 0) {
                    for (let idx = 0; idx < this.nThreads; idx++) {
                        this.threads++;
                        if (this.schedule === simulMixed) {
                            this.setNextRandomAction.bind(this)();
                        }
                        process.nextTick(this.actions[this.actionIdx].bind(this)
                                            , cb, idx);
                    }
                } else {
                    cluster.on('exit', worker => {
                        stdout.write(`Worker #${worker.id} has disconnected\n`);
                        if (!cluster.workers ||
                            Object.keys(cluster.workers).length === 0) {
                            // update number of processes if relevant
                            this.nProcesses = 0;
                            this.workers.forEach(nb => {
                                if (nb === this.testsNb) {
                                    this.nProcesses++;
                                }
                            });
                            setTimeout(this.gatherResults.bind(this), 100, cb);
                        }
                    });
                }
            } else {
                for (let idx = 0; idx < this.nThreads; idx++) {
                    this.threads++;
                    if (this.schedule === simulMixed) {
                        this.setNextRandomAction.bind(this)();
                    }
                    process.nextTick(this.actions[this.actionIdx].bind(this),
                                        cb, idx);
                }
            }
        } else {
            cb();
        }
    }

    /* get next random action index according to this.fracLoads */
    getNextRandActionIndx() {
        let randNb = Math.random();
        let idx = 0;
        while (randNb >= 0) {
            randNb -= this.fracLoads[idx];
            idx++;
        }
        return (idx - 1);
    }

    setNextRandomAction() {
        this.currSizeIdx = Math.floor(Math.random() * this.sizes.length);
        this.size = this.sizes[this.currSizeIdx];
        this.value = this.values[this.currSizeIdx];
        this.actionIdx = this.getNextRandActionIndx();
    }

    doNextTest(reqIdx, cb) {
        /* if current data size is the last one
         *  - current request is done, disable it
         *  - go next request
         *      if current request is the last one, do next `threadsNb`
         * otherwise, go next data size
         */
        function doNextDataSize() {
            if (this.currSizeIdx === this.sizes.length - 1) {
                this.actionFlag[reqIdx] = false;
                /* if current request is the last one -> simul is done */
                if (this.actionIdx === this.actions.length - 1) {
                    if (reqIdx === COM_OBJ) {
                        [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                            this.printStats(req);
                        });
                    }
                    this.currSizeIdx = 0;
                    return false; // will call next threadsNb
                }
                this.currSizeIdx = 0;
                this.actionIdx++;
            } else {
                this.currSizeIdx++;
            }
            return true; // will do next action/datasize
        }

        /* if current thread number is the last one
         *  - return to call callback to finish
         * otherwise, go next threads number. It then requires reset actions
         *    and data sizes indices.
         */
        function doNextThread() {
            if (this.schedule === simulMixed) {
                if (this.actionFlag[COM_OBJ]) {
                    [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                        this.resetStats(req);
                    });
                }
                this.currActions.forEach(req => {
                    this.resetStats(req);
                });
            } else {
                if (this.actionFlag[COM_OBJ]) {
                    [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                        this.resetStats(req);
                    });
                } else {
                    this.resetStats(reqIdx);
                }
            }

            this.updateThreadStats();
            if (this.currThreadIdx === this.paralReqs.length - 1) {
                this.currThreadIdx = 0;
                this.nThreads = this.paralReqs[0];
                return false; // will call cb
            }
            this.currThreadIdx++;
            this.nThreads = this.paralReqs[this.currThreadIdx];

            //  for simulEach only, reset data size and action indices
            if (this.schedule === simulEach) {
                this.currSizeIdx = 0;
                this.actionIdx = 0;
                this.setActions(this.currActions);
            }

            return true; // will do next thread
        }

        if (this.schedule === simulMixed) {
            if (!doNextThread.bind(this)()) {
                return cb();
            }
        } else {
            /* decide for next data size */
            if (!doNextDataSize.bind(this)()) {
                /* decide for next nThreads */
                if (!doNextThread.bind(this)()) {
                    return cb();
                }
            }
        }
        this.size = this.sizes[this.currSizeIdx];
        this.value = this.values[this.currSizeIdx];
        return setTimeout(this.doSimul.bind(this), this.simulDelay, cb);
    }

    doNextAction(reqIdx, cb, threadIdx) {
        this.endSimul = process.hrtime(this.startSimul);
        const runTime = this.endSimul[0] + this.endSimul[1] / 1e9;
        /* if a request with a data size simulation runned for given 'threshold'
         *      number of iterations -> prepare for next simulation
         * otherwise, do next action
         */
        if (this.count >= this.threshold || runTime > this.runTime) {
            this.threads--;
            if (this.threads === 0) {
                // to separate blocks each corresponds to a simulation
                this.realTimePerfStats += '\n';

                const elapsedTime =
                    (getHrTime(this.startProg) / 1e3).toFixed(0);
                if (cluster.isWorker) {
                    if (this.schedule === simulEach) {
                        process.send({
                            done: cluster.isMaster ? 0 : cluster.worker.id,
                            thread: this.currThreadIdx,
                            size: this.currSizeIdx,
                            request: reqIdx,
                            time: elapsedTime,
                        });
                    } else {
                        process.send({
                            done: cluster.isMaster ? 0 : cluster.worker.id,
                            thread: this.currThreadIdx,
                            size: 0,
                            request: 0,
                            time: elapsedTime,
                        });
                    }
                } else if (this.nWorkers === 0) {
                    if (this.schedule === simulEach) {
                        if (elapsedTime > objToPlotter.divisionMarks
                            [this.currThreadIdx][this.currSizeIdx][reqIdx]) {
                            objToPlotter.divisionMarks[this.currThreadIdx]
                                [this.currSizeIdx][reqIdx] = elapsedTime;
                        }
                    } else {
                        if (elapsedTime > objToPlotter.divisionMarks
                            [this.currThreadIdx][0][0]) {
                            objToPlotter.divisionMarks[this.currThreadIdx]
                                [0][0] = elapsedTime;
                        }
                    }
                }

                if (this.schedule === simulMixed) {
                    this.currActions.forEach(reqIdx => {
                        this.sizes.forEach((size, sizeIdx) => {
                            this.printStats(reqIdx, sizeIdx);
                        });
                    });
                    this.updateResForPlotter();
                } else {
                    this.printStats(reqIdx);
                    this.updateResForPlotter();
                }

                if (cluster.isWorker) {
                    // get message from Master
                    process.once('message', msg => {
        // stdout.write(`Worker ${process.pid} received message ${msg}\n`);
                        if (msg === 'continue') {
                            this.doNextTest.bind(this)(reqIdx, cb);
                        }
                    });
                } else if (this.nWorkers === 0) {
                    this.doNextTest.bind(this)(reqIdx, cb);
                }
            }
        } else {
            /* number of operations is not enough -> continue */
            if (this.schedule === simulMixed) {
                this.setNextRandomAction.bind(this)();
            }
            return this.actions[this.actionIdx].bind(this)(cb, threadIdx);
        }
        return undefined;
    }

    genKey(keyIndx, _size) {
        const size = _size || this.size;
        const workerId = (cluster.isMaster) ? 0 : cluster.worker.id;
        return this.prefixKey ? `${this.prefixKey}_Id${keyIndx}` :
            `${this.prefixKeyRand}_Wker${workerId}_Size${size}_Id${keyIndx}`;
    }

    getNextKey(reqIndx, lower, upper) {
        const min = lower || 0;
        const max = upper || this.maxKey;
        let keyIndx;
        if (this.nextKey === nextKeySeq) {
            keyIndx = (this.currIndx[reqIndx]++) % (max - min) + min;
        } else {
            keyIndx = min + Math.floor(Math.random() * (max - min));
        }
        return this.genKey(keyIndx);
    }

    // only master runs this function
    monitorStats() {
        if (!this.ssm) {
            return;
        }
        const elapsedTime = (getHrTime(this.startProg) / 1e3).toFixed(0);
        let strToFile = `${elapsedTime} `;
        /* create string for display */
        /* update content for stats file */
        servers.forEach(server => {
            ssmTypes.forEach(type => {
                const val = latestStates[server][type];
                if (val && val !== ' ') {
                    if (type === 'ioStat') {
                        let ssdUsed = 0;
                        val.split(' ').forEach(nb => {
                            ssdUsed += Number(nb);
                        });
                        strToFile +=
                        `${toFixedLength(ssdUsed.toFixed(2), serverColLen)} `;
                    } else {
                        strToFile += `${toFixedLength(val, serverColLen)} `;
                    }
                } else {
                    let naStr = ' ';
                    _ssmTypes[type].monitor.forEach(() => {
                        naStr += '?0/1 ';
                    });
                    strToFile += `${toFixedLength(naStr, serverColLen)}`;
                }
            });
        });
        if (this.displaySSM) {
            displaySSM(latestStates, elapsedTime);
            // if (this.resConsMonitor) {
            //     str += 'Resource consuming by s3blaster:\n' +
            //         `Max cpu usage: ${this.resConsuming[1]}(%)\n` +
            //         `Total memory usage: ${this.resConsuming[0]}(MB)\n`;
            // }
        }
        // get resources consuming by s3blaster
        if (this.resConsMonitor) {
            this.resConsuming.forEach(val => {
                strToFile += `${toFixedLength(val.toFixed(2), 10)} `;
            });
        }
        strToFile += `\n`;
        this.ssmStats += strToFile;

        setTimeout(this.monitorStats.bind(this), this.rate);
    }

    // processing processes run this function
    realTimePerf() {
        if (!this.ssm) {
            return;
        }
        const elapsedTime = (getHrTime(this.startProg) / 1e3).toFixed(0);
        let header = `${dLine}`;
        if (this.displaySSM) {
            header +=
                `${toFixedLength(`Host: ${this.host}:${this.port}`, 25)} ||` +
                `${toFixedLength(`Elapsed time: ${elapsedTime}(s)`, 25)} ||` +
                `${toFixedLength(
                        `Object size: ${convertSize(this.size)}`, 25)}||` +
                `${toFixedLength(`#Paral-Reqs: ${this.nThreads}`, 25)}` +
                `\n${line}`;
            stdout.write(`${header}`);
        }
        let strToFile = `${elapsedTime} `;
        let str = `${toFixedLength('Request', 7)} ||` +
            `Latency: avg    std-dev|| nOps/sec:    send      receive\n${line}`;
        this.reqsToTest.forEach(req => {
            if (this.stacks[req][0] > 0) {
                str += `${toFixedLength(requests[req], 8)} ||    `;
                const avg = this.stacks[req][1] / this.stacks[req][0];
                const stddev = Math.sqrt(
                    this.stacks[req][2] / this.stacks[req][0] - avg * avg);
                const avgSendRate = (this.sendRates[req] * 1000 /
                                        this.rate).toFixed(0);
                const avgRecRate = (this.stacks[req][0] * 1000 /
                                        this.rate).toFixed(0);
                str += ` ${toFixedLength(avg.toFixed(2), 8)}`;
                str += ` ${toFixedLength(stddev.toFixed(2), 8)}||        `;
                str += ` ${toFixedLength(avgSendRate, 8)}`;
                str += ` ${toFixedLength(avgRecRate, 8)}`;
                str += `\n`;

                strToFile += ` ${toFixedLength(avg.toFixed(2), 8)}`;
                strToFile += ` ${toFixedLength(stddev.toFixed(2), 8)}`;
                strToFile += ` ${toFixedLength(avgRecRate, 8)}`;
            } else {
                strToFile += ` ${toFixedLength('?0/1', 8)}`;
                strToFile += ` ${toFixedLength('?0/1', 8)}`;
                strToFile += ` ${toFixedLength('?0/1', 8)}`;
            }
            this.stacks[req] = [0, 0, 0];
            this.sendRates[req] = 0;
        });
        str += `\n`;
        strToFile += `\n`;
        if (this.displayRealTimePerf) {
            stdout.write(`${str}`);
        }
        this.realTimePerfStats += strToFile;

        setTimeout(this.realTimePerf.bind(this), this.rate);
    }

    put(cb, threadIdx) {
        this.count++;
        const key = this.getNextKey(PUT_OBJ, this.range[PUT_OBJ][0],
                                    this.range[PUT_OBJ][1]);

        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const object = {
            Key: key,
            Bucket: bucketName,
            Body: this.value,
            ContentLength: this.size,
        };

        if (this.objMetadata === objMD.STANDARD ||
            this.objMetadata === objMD.FULL) {
            object.ACL = 'bucket-owner-full-control';
            object.ContentMD5 = this.md5s[this.currSizeIdx];
            object.ContentType = 'text/plain';
        }

        if (this.objMetadata === objMD.FULL) {
            object.CacheControl = 'max-age=1';
            object.ContentDisposition = 's3blaster';
            object.ContentEncoding = 'noEncoding';
            object.ContentLanguage = 'French';
            object.Expires =
                new Date('Wed Dec 31 2050 16:00:00 GMT-0800 (PST)');
            object.GrantFullControl = 'WRITE_ACP';
            object.GrantRead = 'true';
            object.GrantReadACP = 'true';
            object.GrantWriteACP = 'true';
            object.Metadata = {
                UKS: crypto.randomBytes(20).toString('hex'),
            };
            object.RequestPayer = 'requester';
            object.StorageClass = 'STANDARD';
            object.WebsiteRedirectLocation = 'WebsiteRedirectLocation';
        }

        const sizeIdx = this.currSizeIdx;
        this.sendRates[PUT_OBJ]++;

        const start = process.hrtime();
        this.s3.putObject(object, err => {
            const time = getHrTime(start);

            if (err) {
                this.nFailures[PUT_OBJ][sizeIdx]++;
                stderr.write(`put ${key} to ${object.Bucket}: ${err}\n`);
            } else {
                if (this.workOnCurrObjs &&
                    !this.storedKeys[bucketName][sizeIdx][key]) {
                    this.storedKeys[bucketName][sizeIdx][key] = true;
                    this.keysNb[bucketName][sizeIdx]++;
                }
                this.latThread[PUT_OBJ][threadIdx] += time;
                this.updateStats(PUT_OBJ, sizeIdx, time);
                if (this.nSuccesses[PUT_OBJ][sizeIdx] %
                        this.freqShow === 0) {
                    this.printStats(PUT_OBJ, sizeIdx);
                }
            }
            return this.doNextAction.bind(this)(PUT_OBJ, cb, threadIdx);
        });
    }

    get(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const sizeIdx = this.currSizeIdx;

        let key;
        if (this.workOnCurrObjs) {
            const idx = Math.floor(Math.random() *
                                        this.keysNb[bucketName][sizeIdx]);
            key = Object.keys(this.storedKeys[bucketName][sizeIdx])[idx];
            if (!key) {
                // if all objects are deleted, go next simul
                if (this.schedule === simulEach) {
                    if (this.keysNb.every(perBkt =>
                        perBkt[this.currSizeIdx] === 0)) {
                        this.count = this.threshold;
                        return this.doNextAction.bind(this)(GET_OBJ, cb,
                                                                threadIdx);
                    }
                } else { // mixed simulation
                    return this.doNextAction.bind(this)(GET_OBJ, cb, threadIdx);
                }
            }
        } else {
            key = (this.getNextKey(GET_OBJ, this.range[GET_OBJ][0],
                                    this.range[GET_OBJ][1]));
        }

        const object = {
            Key: key,
            Bucket: bucketName,
            Range: `bytes=0-${this.size}`,
        };
        this.sendRates[GET_OBJ]++;
        const start = process.hrtime();
        this.s3.getObject(object, err => {
            const time = getHrTime(start);
            if (err && (!(this.noKeyFlag &&
                        err.toString().split(':')[0] === 'NoSuchKey'))) {
                this.nFailures[GET_OBJ][sizeIdx]++;
                stderr.write(`get ${object.Key} ${object.Bucket}: ${err}\n`);
            // if (err) {
            //     this.nFailures[GET_OBJ][sizeIdx]++;
            //     stderr.write(`get ${object.Key} ${object.Bucket}: ${err}\n`);
            } else {
                this.latThread[GET_OBJ][threadIdx] += time;
                this.updateStats(GET_OBJ, sizeIdx, time);
                if (this.nSuccesses[GET_OBJ][sizeIdx] %
                        this.freqShow === 0) {
                    this.printStats(GET_OBJ, sizeIdx);
                }
            }
            return this.doNextAction.bind(this)(GET_OBJ, cb, threadIdx);
        });
        return undefined;
    }

    getAcl(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const sizeIdx = this.currSizeIdx;
        let key;
        if (this.workOnCurrObjs) {
            const idx = Math.floor(Math.random() *
                                        this.keysNb[bucketName][sizeIdx]);
            key = Object.keys(this.storedKeys[bucketName][sizeIdx])[idx];
            if (!key) {
                // if all objects are deleted, go next simul
                if (this.schedule === simulEach) {
                    if (this.keysNb.every(perBkt =>
                        perBkt[this.currSizeIdx] === 0)) {
                        this.count = this.threshold;
                        return this.doNextAction.bind(this)(GET_ACL, cb,
                                                    threadIdx);
                    }
                } else { // mixed simulation
                    return this.doNextAction.bind(this)(GET_ACL, cb, threadIdx);
                }
            }
        } else {
            key = (this.getNextKey(GET_ACL, this.range[GET_OBJ][0],
                                    this.range[GET_OBJ][1]));
        }

        const object = {
            Key: key,
            Bucket: bucketName,
        };
        this.sendRates[GET_ACL]++;
        const start = process.hrtime();
        this.s3.getObjectAcl(object, err => {
            const time = getHrTime(start);
            if (err && (!(this.noKeyFlag &&
                        err.toString().split(':')[0] === 'NoSuchKey'))) {
                this.nFailures[GET_ACL][sizeIdx]++;
                stderr.write(`get ${object.Key} error: ${err}\n`);
            } else {
                this.latThread[GET_ACL][threadIdx] += time;
                this.updateStats(GET_ACL, sizeIdx, time);
                if (this.nSuccesses[GET_ACL][sizeIdx] %
                        this.freqShow === 0) {
                    this.printStats(GET_ACL, sizeIdx);
                }
            }
            this.doNextAction.bind(this)(GET_ACL, cb, threadIdx);
        });
        return undefined;
    }

    del(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const sizeIdx = this.currSizeIdx;
        let key;
        if (this.workOnCurrObjs) {
            const idx = Math.floor(Math.random() *
                                        this.keysNb[bucketName][sizeIdx]);
            key = Object.keys(this.storedKeys[bucketName][sizeIdx])[idx];
            if (!key) {
                 // if all objects are deleted, go next simul
                if (this.schedule === simulEach) {
                    if (this.keysNb.every(perBkt =>
                        perBkt[this.currSizeIdx] === 0)) {
                        this.count = this.threshold;
                        return this.doNextAction.bind(this)(DEL_OBJ, cb,
                                                            threadIdx);
                    }
                } else { // mixed simulation
                    return this.doNextAction.bind(this)(DEL_OBJ, cb, threadIdx);
                }
            }
        } else {
            key = this.getNextKey(DEL_OBJ, this.range[DEL_OBJ][0],
                                    this.range[DEL_OBJ][1]);
        }

        const object = {
            Key: key,
            Bucket: bucketName,
        };
        this.sendRates[DEL_OBJ]++;
        const start = process.hrtime();
        this.s3.deleteObject(object, err => {
            const time = getHrTime(start);
            if (err && (!(this.noKeyFlag &&
                        err.toString().split(':')[0] === 'NoSuchKey'))) {
                this.nFailures[DEL_OBJ][sizeIdx]++;
                // stderr.write(`del error: ${err}\n`);
            } else {
                if (this.workOnCurrObjs &&
                    this.storedKeys[bucketName][sizeIdx][key]) {
                    delete this.storedKeys[bucketName][sizeIdx][key];
                    this.keysNb[bucketName][sizeIdx]--;
                }
                this.latThread[DEL_OBJ][threadIdx] += time;
                this.updateStats(DEL_OBJ, sizeIdx, time);
                if (this.nSuccesses[DEL_OBJ][sizeIdx] %
                        this.freqShow === 0) {
                    this.printStats(DEL_OBJ, sizeIdx);
                }
            }
            return this.doNextAction.bind(this)(DEL_OBJ, cb, threadIdx);
        });
        return undefined;
    }

    list(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const sizeIdx = this.currSizeIdx;

        function listCb(err, value, time) {
            if (err) {
                this.nFailures[LST_OBJ][sizeIdx]++;
                stderr.write(`list error: ${err}\n`);
                return cb(err);
            }
            if (this.schedule === simulEach && this.count >= 1e3) {
                this.count = this.threshold;
            }
            this.latThread[LST_OBJ][threadIdx] += time;
            this.updateStats(LST_OBJ, sizeIdx, time);
            if (this.nSuccesses[LST_OBJ][sizeIdx] %
                    this.freqShow === 0) {
                this.printStats(LST_OBJ, sizeIdx);
            }
            return this.doNextAction.bind(this)(LST_OBJ, cb, threadIdx);
        }
        const workerId = (cluster.isMaster) ? 0 : cluster.worker.id;
        const prefix = this.prefixKey ||
            `${this.prefixKeyRand}_Wker${workerId}_Size${this.size}`;
        this.sendRates[LST_OBJ]++;
        this.listAllObjects(bucketName, listCb.bind(this), prefix, null, 0, 0);
    }

    /* put->get->del object */
    comb(cb, threadIdx) {
        this.count++;
        const key = this.getNextKey(COM_OBJ);
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const object = {
            Key: key,
            Bucket: bucketName,
            // Body: new Buffer(this.value),
            Body: this.value,
        };
        const params = {
            Key: key,
            Bucket: bucketName,
        };
        const sizeIdx = this.currSizeIdx;
        let actionTime = 0;

        function delObj() {
            const start = process.hrtime();
            this.s3.deleteObject(params, err => {
                const time = getHrTime(start);
                if (err && (!(this.noKeyFlag &&
                            err.toString().split(':')[0] === 'NoSuchKey'))) {
                    this.nFailures[DEL_OBJ][0]++;
                    stderr.write(`del ${key} error: ${err}\n`);
                } else {
                    actionTime += time;
                    this.latThread[DEL_OBJ][threadIdx] += time;
                    this.latThread[COM_OBJ][threadIdx] += actionTime;
                    this.updateStats(DEL_OBJ, sizeIdx, time);
                    this.updateStats(COM_OBJ, sizeIdx, actionTime);
                    if (this.nSuccesses[COM_OBJ][sizeIdx] %
                            this.freqShow === 0) {
                        this.printStats(DEL_OBJ, sizeIdx);
                        this.printStats(COM_OBJ, sizeIdx);
                    }
                }
                return this.doNextAction.bind(this)(DEL_OBJ, cb, threadIdx);
            });
        }

        function getObj() {
            const start = process.hrtime();
            this.s3.getObject(params, err => {
                const time = getHrTime(start);
                if (err && (!(this.noKeyFlag &&
                            err.toString().split(':')[0] === 'NoSuchKey'))) {
                    this.nFailures[GET_OBJ][sizeIdx]++;
                    stderr.write(`get ${key} error: ${err}\n`);
                } else {
                    actionTime += time;
                    this.latThread[GET_OBJ][threadIdx] += time;
                    this.updateStats(GET_OBJ, sizeIdx, time);
                    if (this.nSuccesses[GET_OBJ][sizeIdx] %
                            this.freqShow === 0) {
                        this.printStats(GET_OBJ, sizeIdx);
                    }
                    this.sendRates[DEL_OBJ]++;
                }
                setTimeout(delObj.bind(this), this.delays[GET_OBJ]);
                return undefined;
            });
        }

        this.sendRates[PUT_OBJ]++;
        const start = process.hrtime();
        this.s3.putObject(object, err => {
            const time = getHrTime(start);
            if (err) {
                this.nFailures[PUT_OBJ][sizeIdx]++;
                stderr.write(`put ${key} error: ${err}\n`);
            } else {
                actionTime += time;
                this.latThread[PUT_OBJ][threadIdx] += time;
                this.updateStats(PUT_OBJ, sizeIdx, time);
                if (this.nSuccesses[PUT_OBJ][sizeIdx] %
                        this.freqShow === 0) {
                    this.printStats(PUT_OBJ, sizeIdx);
                }
                this.sendRates[GET_OBJ]++;
            }
            setTimeout(getObj.bind(this), this.delays[PUT_OBJ]);
            return undefined;
        });
    }

    /* mulipart upload */
    mpu(cb, threadIdx) {
        if (!this.partSizes) {
            stderr.write('Part sizes are not defined. Done');
            cb(); return;
        }
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.bucketsNb)];
        const key = this.getNextKey(MPU_OBJ, this.range[MPU_OBJ][0],
                                    this.range[MPU_OBJ][1]);

        const params = {
            Key: key,
            Bucket: bucketName,
        };
        const sizeIdx = this.currSizeIdx;
        this.sendRates[MPU_OBJ]++;

        const partsNb = Math.ceil(this.size / this.partSize);
        const arrETags = [];

        const retriesNb = new Array(partsNb).fill(0);
        const maxRetriesNb = 3;

        let abortMPU = true;

        let partIdx = 0;
        let uploadedPartsNb = 0;
        function uploadPart(data, cb, _partNumber) {
            partIdx++;
            if (partIdx > partsNb) {
                return undefined;
            }
            const partNumber = _partNumber || partIdx;
            const objLen = (partNumber < partsNb) ?
                            this.partSize : this.size % this.partSize;
            const object = (partNumber < partsNb) ?
                            this.value : genObjs(objLen);
            const partParams = {
                Bucket: data.Bucket,
                Key: data.Key,
                PartNumber: partNumber,
                UploadId: data.UploadId,
                // Body: new Buffer(object),
                Body: object,
                ContentLength: objLen,
            };
            // stderr.write(`[${partParams.Key}] uploading ${partNumber} of `);
            // stderr.write(`${convertSize(objLen)}..\n`);
            return this.s3.uploadPart(partParams, (err, res) => {
                if (err) {
                    if (retriesNb[partParams.PartNumber - 1] >= maxRetriesNb) {
                        // to abort MPU only one time
                        if (abortMPU) {
                            abortMPU = false;
                            return cb(err);
                        }
                        return undefined;
                    }
                    retriesNb[partParams.PartNumber - 1]++;
                    stderr.write(`[${partParams.Key}] Retry `);
                    stderr.write(`${retriesNb[partParams.PartNumber - 1]} `);
                    stderr.write('times uploading part ');
                    stderr.write(`${partParams.PartNumber}\n`);
                    return setTimeout(uploadPart.bind(this), 1000, data, cb,
                                        partParams.PartNumber);
                }
                arrETags[partParams.PartNumber] = {
                    ETag: res.ETag,
                    PartNumber: partParams.PartNumber,
                };
                uploadedPartsNb++;
                stdout.write(`done ${uploadedPartsNb} vs. ${partsNb} total\n`);
                if (uploadedPartsNb === partsNb) {
                    return cb(null, arrETags);
                }
                return setTimeout(uploadPart.bind(this), this.delays[MPU_OBJ],
                                    data, cb);
            });
        }

        function mpuUpload(data, cb) {
            for (let idx = 0; idx < Math.min(this.mpuParalReqs, partsNb);
                idx++) {
                process.nextTick(uploadPart.bind(this), data, cb);
            }
        }
        const start = process.hrtime();
        this.s3.createMultipartUpload(params, (err, data) => {
            if (err) {
                this.nFailures[MPU_OBJ][sizeIdx]++;
                stderr.write(`error create mpu ${params.Bucket}: ${err}\n`);
                return process.nextTick(this.doNextAction.bind(this), MPU_OBJ,
                                        cb, threadIdx);
            }
            return mpuUpload.bind(this)(data, (err, mpuDat) => {
                if (err) {
                    this.nFailures[MPU_OBJ][sizeIdx]++;
                    stderr.write(`upload mpu ${params.Bucket}: ${err}\n`);
                    return this.s3.abortMultipartUpload(data, err => {
                        if (err) {
                            stderr.write(`Failed abort MPU ${data}: ${err}\n`);
                        }
                        return process.nextTick(this.doNextAction.bind(this),
                                    MPU_OBJ, cb, threadIdx);
                    });
                }
                const multiParams = {
                    Bucket: data.Bucket,
                    Key: data.Key,
                    UploadId: data.UploadId,
                    MultipartUpload: {
                        Parts: mpuDat,
                    },
                };
                return this.s3.completeMultipartUpload(multiParams, err => {
                    const time = getHrTime(start);
                    if (err) {
                        this.nFailures[MPU_OBJ][sizeIdx]++;
                        stderr.write(`Failed complete ${data}: ${err}\n`);
                        return this.s3.abortMultipartUpload(data, err => {
                            if (err) {
                                stderr.write(`Failed abort MPU: ${err}\n`);
                            }
                        });
                    }
                    if (!this.storedKeys[bucketName][sizeIdx][key]) {
                        this.storedKeys[bucketName][sizeIdx][key] = true;
                        this.keysNb[bucketName][sizeIdx]++;
                    }
                    this.latThread[MPU_OBJ][threadIdx] += time;
                    this.updateStats(MPU_OBJ, sizeIdx, time);
                    if (this.nSuccesses[MPU_OBJ][sizeIdx] %
                            this.freqShow === 0) {
                        this.printStats(MPU_OBJ, sizeIdx);
                    }

                    return process.nextTick(this.doNextAction.bind(this),
                                MPU_OBJ, cb, threadIdx);
                });
            });
        });
    }

    getResConsuming(cb) {
        fs.readFile(`/proc/${process.pid}/stat`, 'utf8', (err, data) => {
            if (err) {
                return cb(err);
            }
            const parts = data.substr(data.lastIndexOf(')') + 2).split(' ');
            const statObject = {
                stime: parseFloat(parts[statIndexes.STIME]),
                utime: parseFloat(parts[statIndexes.UTIME]),
                startTime: parseFloat(parts[statIndexes.START_TIME]),
                rss: parseFloat(parts[statIndexes.RSS]),
                vsize: parseFloat(parts[statIndexes.VSIZE]),
            };
            return cb(null, statObject);
        });
    }

    readData(cb) {
        if (this.nWorkers === 0) {
            this.files.push(`${statsFolder}` +
                `${this.output}${this.threadExt}`);
        } else {
            for (let idx = 1; idx <= this.nWorkers; idx++) {
                if (this.workers[idx - 1] === this.testsNb) {
                    this.files.push(`${statsFolder}` +
                        `worker${idx}/${this.output}${this.threadExt}`);
                }
            }
        }
        let count = 0;
        this.files.forEach(file => {
            this.data[file] = [];
            const rl = readline.createInterface({
                input: fs.createReadStream(file),
            });
            rl.on('line', line => {
                if (line[0] !== '#' && line.length > 1) {
                    this.data[file].push(line.slice(1).trim().
                                        split(/[\s,]+/).map(Number));
                }
            });
            rl.on('close', err => {
                if (err) return cb(err);
                count++;
                if (count === this.files.length) {
                    return cb();
                }
                return undefined;
            });
        });
    }

    getData(req, size, thread, perf, _sizesNb) {
        const sizesNb = _sizesNb || this.sizes.length;
        const arr = [];

        let row = 0;
        let col = 2;    // the first 2 columns are data-size and #threads
        const reqIdx = this.reqsToTest.indexOf(req);
        // multiply by 3 since there are 3 columns per request
        //  average, std-dev, operations/s
        col += reqIdx * 3;
        if (perf === OPR_PERF) {
            col += 2;
        }
        row = 0;
        const threadIdx = this.paralReqs.indexOf(thread);
        row += sizesNb * threadIdx;
        const sizeIdx = this.sizes.indexOf(size);
        row += sizeIdx;

        if (col < 0 || row < 0) {
            return 'N/A';
        }

        this.files.forEach(file => {
            const dataEachFork = this.data[file];
            if (dataEachFork[row] && dataEachFork[row][0] === thread &&
                dataEachFork[row][1] === size) {
                arr.push(dataEachFork[row][col]);
            }
        });
        if (arr.length > 0) {
            const sum = arr.reduce((a, b) => a + b);
            let avg = sum / arr.length;
            if (perf === OPR_PERF) {
                avg *= this.nProcesses;
            }
            return avg.toFixed(3);
        }

        return 'N/A';
    }

    getAllData(cb, mdSize) {
        let str = '# Configuration info\n' +
                  `# date ${new Date()}\n` +
                  `${this.message}\n` +
                  '# End_configuration\n';

        const tab = '     ';
        let header = `#${toFixedLength(' ', 10)}`;
        let threadStr = `${toFixedLength('#paralReqs', 10)}`;
        this.paralReqs.forEach(thread => {
            threadStr += `${toFixedLength(thread,
                                            this.perfs.length * 10)}${tab}`;
            this.perfs.forEach(perf => {
                header += `${toFixedLength(perf, 10)}`;
            });
            header += tab;
        });
        threadStr += `\n`;
        header += `\n`;
        str += `#${dLine}# SUMMARY RESULTS:\n` +
            `# Note: ${OPR_PERF} is multiplied by number of processes ` +
            `(${this.nProcesses})\n`;

        this.sizes.forEach(size => {
            str += `#\n# Size: ${convertSize(size)}\n${threadStr}${header}`;
            this.reqsToTest.forEach(req => {
                str += `# ${toFixedLength(requests[req], 10)}`;
                this.paralReqs.forEach(thread => {
                    this.perfs.forEach(perf => {
                        const avg = this.getData(req, size, thread, perf);
                        str += ` ${toFixedLength(avg, 10)}`;
                    });
                    str += tab;
                });
                str += '\n';
            });
        });
        stdout.write(`Average perf. over all forks.\n`);
        stdout.write(str);

        if (mdSize) {
            stdout.write(`Metadata size of all buckets [${this.buckets}]:\n`);
            str += `#${line}` +
                `# Metadata size of all buckets [${this.buckets}]:\n`;
            servers.forEach(server => {
                stdout.write(`${server}: ${mdSize[server]}KB\n`);
                str += `# ${server}: ${mdSize[server]}KB\n`;
            });
        }
        str += `#${dLine}#\n# Next lines are for plotting graphs..\n`;

        const hdParams = `# ${toFixedLength('#paralReqs', 12)}` +
            `${toFixedLength('obj size', 10)}`;
        let hdReqs = '';
        this.perfs.forEach(perf => {
            hdReqs += `${toFixedLength(perf, 10)}`;
        });
        header = `${hdParams} `;
        this.reqsToTest.forEach(req => {
            header +=
                `${toFixedLength(requests[req], hdReqs.length, 'center')}`;
        });
        header += `\n#${toFixedLength(' ', hdParams.length)}`;
        this.reqsToTest.forEach(() => {
            header += hdReqs;
        });
        header += '\n';
        str += header;
        this.paralReqs.forEach(thread => {
            this.sizes.forEach(size => {
                str +=
                    `${toFixedLength(thread, 12)} ${toFixedLength(size, 10)}`;
                this.reqsToTest.forEach(req => {
                    this.perfs.forEach(perf => {
                        const avg = this.getData(req, size, thread, perf);
                        str += ` ${toFixedLength(avg, 10)}`;
                    });
                });
                str += '\n';
            });
        });
        // write to final file
        fs.writeFile(this.finalFile, str, cb);
    }

    gatherResults(cb) {
        stdout.write('gathering results...\n');
        this.readData(err => {
            stdout.write(`files: ${this.files}\n`);
            if (err) {
                return cb(err);
            }
            if (this.ssm && this.getMDsize) {
                return this.calculateMDSize.bind(this)((err, mdSize) => {
                    if (err) {
                        stderr.write(`Error get MD size: ${err}\n`);
                    }
                    if (this.ssm) {
                        ssmSystem.terminate(() => {
                            stdout.write('All ssh connections are closed');
                        });
                    }
                    return this.getAllData(cb, mdSize);
                });
            }
            return this.getAllData(cb);
        });
    }
}

module.exports = S3Blaster;
S3Blaster.requests = {
    putObj: PUT_OBJ,
    getObj: GET_OBJ,
    delObj: DEL_OBJ,
    comObj: COM_OBJ,
    lstObj: LST_OBJ,
    getAcl: GET_ACL,
};

S3Blaster.requestsString = {
    reqs: requests,
};

S3Blaster.simulPolicy = {
    each: simulEach,
    mixed: simulMixed,
};

S3Blaster.statsFolder = {
    path: statsFolder,
};

S3Blaster.nextKey = {
    rand: nextKeyRand,
    seq: nextKeySeq,
};

S3Blaster.ssm = {
    servers,
    ssmTypes,
    ssmTypesObj: ssmConfig.statTypes,
    nbStatsPerServer,
};

S3Blaster.objToPlotter = objToPlotter;

S3Blaster.graphs = graphs;
S3Blaster.dataFiles = dataFiles;
S3Blaster.outputGraph = outputGraph;

/* ==== For Test running directly from this file ==== */
function execution(cb) {
    const Plotter = require('../index').Plotter;
    const blaster = new S3Blaster();
    let plotter = undefined;

    function init(done) {
        blaster.init(err => {
            if (err) {
                process.stderr.write(err);
                return done(err);
            }
            plotter = new Plotter();
            return done();
        });
    }

    function run(done) {
        blaster.doSimul(done);
    }

    function end(done) {
        blaster.updateDataFile(err => {
            if (err) {
                return done(err);
            }
            return blaster.updateStatsFiles(err => {
                if (err) {
                    return done(err);
                }
                return blaster.clearDataSimul(err => {
                    if (err) {
                        return done(err);
                    }
                    return plotter.plotData(err => {
                        if (err) {
                            process.stdout.write(err);
                        }
                        return done();
                    });
                });
            });
        });
    }

    init(err => {
        if (err) return cb(err);
        return run(err => {
            if (err) return cb(err);
            return end(cb);
        });
    });
}

if (require.main === module) {
    execution(err => {
        if (err) {
            process.stderr.write(err);
        }
        process.exit();
    });
}

S3Blaster.execution = execution;
