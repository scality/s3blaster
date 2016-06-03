'use strict'; // eslint-disable-line strict

const cluster = require('cluster');
const commander = require('commander');
const config = require('aws-sdk').config;
const S3 = require('aws-sdk').S3;
const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');
const stderr = process.stderr;
const stdout = process.stdout;
const execSync = require('child_process').execSync;
const http = require('http');
const spawn = require('child_process').spawn;

/* Available graph to be plotted:
graphs = {
   avgStd: average and standard-deviabtion graph will be plotted
   pdfCdf: estimated pdf/cdf graphs will be plotted
   statSize: latency vs. sizes graph will be plotted
   thread: latency vs. number of threads graph will be plotted
   live: resources' consuming and real-time perf
};
*/
const avgStdGraph = 'avg-std';
const pdfCdfGraph = 'pdf-cdf';
const statSizeGraph = 'stat-size';
const threadGraph = 'thread';
const liveGraph = 'live';
const finalGraph = 'summary';

const graphs = {
    avgStd: avgStdGraph,
    pdfCdf: pdfCdfGraph,
    statSize: statSizeGraph,
    thread: threadGraph,
    live: liveGraph,
    final: finalGraph,
};

// default config params for s3blaster
const s3Config = require('./config.js').config;
const servers = s3Config.conn.servers;

const ssmSystem = require('./ssm/src/system');
const ssmConfig = require('./ssm/src/config');
const ssmMonitor = require('./ssm/src/monitor');
const latestStates = ssmMonitor.latestStates;
const _ssmTypes = ssmConfig.statTypes;
const allTypesLen = Object.keys(_ssmTypes).length;

const mdInfo = require('./ssm/src/ssh').mdInfo;
if (s3Config.db.mdPath) {
    mdInfo.bucketsCommonPath = servers.map(server =>
        s3Config.db.mdPath.slice().replace(/<server_address>/g, server)
    );
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

commander.version('0.0.1')
.option('--stats-folder [statsFolder]>',
                                    'Folder contains statistics and graphs')
.parse(process.argv);

let calledFileName = 's3blaster';
if (process.argv[2]) {
    const lastSlashIdx = process.argv[2].lastIndexOf('/') || 0;
    calledFileName = process.argv[2].slice(lastSlashIdx + 1,
                            process.argv[2].length - 3);
}

const _folderName = commander.statsFolder || s3Config.plotter.statsFolder ||
    (new Date()).toDateString().replace(/\s/g, '_');
const statsFolder = `./results/${_folderName}/`;
let defaultFileName = `${statsFolder}`;
if (cluster.isWorker) {
    defaultFileName += `worker${cluster.worker.id}/`;
}

const defaultMaxKey = 1000;
const KB = 1024;
const MB = KB * KB;
const GB = KB * MB;

const objToPlotter = {
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
    outputType: outputGraph.PDF,  // file type for graph files
    allRealTimeFiles: [],   // files containing real-time perf of all workers
    procNames: [],  // names of running processes
    arrDataFiles: [],   // array of stats data files.
        // If cluster.isMaster, arrDataFiles[live] and [final] contains _ssm.txt
        //  and _final.txt files
        // By default, it contains list of all stats data files.
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
const ssmTypes = Object.keys(_ssmTypes); // getSsmTypes();
let nbStatsPerServer = 0;
ssmTypes.forEach(type => {
    if (Array.isArray(_ssmTypes[type])) {
        nbStatsPerServer += _ssmTypes[type].length;
    } else {
        nbStatsPerServer++;
    }
});

const lineLen = Math.max(95,
                    firstColLen + 1 + servers.length * (serverColLen + 1));
const line = drawLine('-', lineLen);
const dLine = drawLine('=', lineLen);
const ioStatIndx = ssmTypes.indexOf('ioStat');

function displaySSM(stats, elapsedTime) {
    let str = '';
    str += `${dLine}` +
        `${toFixedLength(`Time: ${elapsedTime}(s)`, firstColLen - 8, 'left')}` +
        'Servers ||';
    servers.forEach(server => {
        str += `${toFixedLength(`${server}`, serverColLen)}|`;
    });
    str += `\n${line}`;
    ssmTypes.forEach((type, typeIdx) => {
        const header = Array.isArray(_ssmTypes[type]) ?
                                            `${type}[Mem(MB) %CPU]` : type;
        str += `${toFixedLength(header, firstColLen)}||`;
        for (let idx = 0; idx < servers.length; idx++) {
            const val = stats[idx * ssmTypes.length + typeIdx] || ' ';
            str += `${toFixedLength(val, serverColLen)}|`;
        }
        str += '\n';
    });
    str += `${line}`;
    stdout.write(str);
}

function genObjs(size) {
    // const upStream = new stream.Readable;
    // upStream.push(crypto.randomBytes(size));
    // upStream.push(null);
    // return upStream;
    return crypto.randomBytes(size);
}

// min part size for multipart upload
const minPartSize = 0; // 5 * MB;

function helpS3blaster() {
    stdout.write(`Run directly s3blaster test via mocha with arguments:\n`);
    stdout.write(`(o)Host:\n`);
    stdout.write(`  -H, --host: host address\n`);
    stdout.write(`  -P, --port: port\n`);
    stdout.write(`(o)Clustering:\n`);
    stdout.write('  -w, --n-forks: number of forks\n');
    stdout.write(`(o)Request type:\n`);
    stdout.write('  --requests <items>: ordered list of requests. ');
    stdout.write(`Available requests: ${requests}\n`);
    stdout.write(`(o)Proportion of requests:\n`);
    stdout.write('  -p, --propr-reqs: proportion of requests\n');
    stdout.write(`(o)Simulation policy:\n`);
    stdout.write('  -m, --simul: type of simulation, ');
    stdout.write(`either 'each' for simulEach, 'mixed' for simulMixed\n`);
    stdout.write(`(o)Number of observations:\n`);
    stdout.write(`  -n, --n-obsers: number of observations\n`);
    stdout.write(`(o)Bucket:\n`);
    stdout.write(`  -B, --bucket-prefix: prefix for bucket name\n`);
    stdout.write(`  --n-buckets: number of buckets\n`);
    stdout.write(`  --n-objs: number of objects per bucket\n`);
    stdout.write(`(o)Data sizes:\n`);
    stdout.write(`  -s, --sizes <items> or min:step:max\n`);
    stdout.write('  -u, --unit: data size unit, ');
    stdout.write(`either 'B', 'KB', 'MB' or 'GB'\n`);
    stdout.write(`(o)Number of paralle requests:\n`);
    stdout.write('  -N, --paral-reqs <items>  or min:step:max\n');
    stdout.write(`(o)Graphs to plot:\n`);
    stdout.write('  -g, --graphs <items>: `a` for avg-std, `p` for pdf-cdf, ');
    stdout.write(`'s' for data sizes, 't' for threads, 'l' for live\n`);
    stdout.write(`(o)Suffix for output files:\n`);
    stdout.write(`  -f, --output: suffix for output files\n`);
    stdout.write(`(o)Max simulation running time:\n`);
    stdout.write(`  -t, --run-time: max running time per test (second)\n`);
    stdout.write(`(o)Object key:\n`);
    stdout.write('  --prefix-key: prefix for object keys\n');
    stdout.write('  --next-key: next key choosing either `rand` (random),');
    stdout.write(' `seq` (sequential)\n');
    stdout.write(`(o)Initialization bucket:\n`);
    stdout.write('  --fill-objs: number of objects created in buckets\n');
    stdout.write(`(o)Get objects:\n`);
    stdout.write('  --ok-nokey: accept for getting NoSuchKey objects\n');
    stdout.write('  --get-anyKey: flag for get any key\n');
    stdout.write(`(o)Frequency to show:\n`);
    stdout.write('  --freq-show: frequency to show stats\n');
    stdout.write(`(o)Indices range for requests:\n`);
    stdout.write('  --range <min:max,min:max,...>: array requests range\n');
    stdout.write('  --r-put min:max: indices range for put requests\n');
    stdout.write('  --r-get min:max: indices range for get requests\n');
    stdout.write('  --r-getacl min:max: indices range for get acl\n');
    stdout.write('  --r-del min,max: indices range for delete requests\n');
    stdout.write(`(o)Estimating probability and cumulative distr. funcs:\n`);
    stdout.write('  --samling-step: sampling step\n');
    stdout.write(`(o)Setting for Plotter:\n`);
    stdout.write('  --fit-plot: enable fit feature for plotter\n');
    stdout.write(`(o)Setting for live and global stats:\n`);
    stdout.write('  --live-global: enable show both live and global stats\n');
    stdout.write(`(o)Sending requests rate:\n`);
    stdout.write('  --req-rates: array of rates for sending requests\n');
    stdout.write(`(o)Clean database:\n`);
    stdout.write('  --dontCleanDB: flag clean DB at the end of simulation\n');
    stdout.write(`(o)Monitoring servers:\n`);
    stdout.write('  --ssm: enable monitoring servers via ssh requests\n');
    stdout.write(`(o)Output files storing statistics and graphs:\n`);
    stdout.write('  --stats-folder: folder contains statistics and graphs\n');
    stdout.write('  -f, --output: suffix for output files\n');
    stdout.write('  --output-type: ');
    stdout.write('Type of output graph files, either pdf or png\n');
    stdout.write('  --message: specified message shown on all graphs\n');
    stdout.write(`(o)Optimizing performance:\n`);
    stdout.write('  --coefs: coefficients for cost function\n');
    stdout.write(`(o)Multipart upload:\n`);
    stdout.write('  --part-size: part size for multipartUpload, in MB\n');
    stdout.write('  --mpu-paralreqs: number of parallel requests for ' +
                    'uploading parts in mpu\n');
}

class S3Blaster {
    constructor(host, port) {
        commander.version('0.0.1')
        .option('-P, --port <port>', 'Port number', parseInt)
        .option('-H, --host [host]', 'Host name')
        .option('-w, --n-forks <nForks>', 'Forks number', parseInt)
        .option('-m, --simul [simul]', 'Type of simulation')
        .option('-N, --paral-reqs <items>  or min:step:max',
                    'Number of parallel requests', getArr)
        .option('-n, --n-obsers <nObsers>', 'Number of observations', parseInt)
        .option('--n-buckets <nBuckets>', 'Number of buckets', parseInt)
        .option('-B, --bucket-prefix [bucketPrefix]', 'Prefix for bucket name')
        .option('-s, --sizes <items> or min:step:max', 'data sizes', getArr)
        .option('-u, --unit [unit]', 'Data size unit')
        .option('--obj-metadata [objMetadata]',
            'Level for filling metadata info for objects')
        .option('--n-objs [nObjs]', 'Number of objects per bucket', parseInt)
        .option('--fill-objs [fillObjs]',
                    'Number of objects created in each bucket', parseInt)
        .option('--prefix-key [prefixKey]', 'Prefix for object keys')
        .option('--next-key [nextKey]',
                'Next key choosing either `rand` (random), `seq` (sequential)')
        .option('--ok-nokey', 'Accept getting NoSuchKey objects or not')
        .option('--requests <items>', 'Ordered list of requests')
        .option('-p, --propr-reqs <items>', 'Proportion of requests',
                                                                    listValues)
        .option('--range [range]',
            'Indices range for requests min:max,min:max,...', listStrs)
        .option('--r-put [rPut]', 'Indices range for put requests min:max')
        .option('--r-get [rGut]', 'Indices range for get requests min:max')
        .option('--r-getacl [rGetacl]',
            'Indices range for get ACL requests min:max')
        .option('--r-mpu [rMpu]', 'Indices range for multipartUpload min:max')
        .option('--sampling-step [samplingStep]',
            'Sampling step for estimating pdf and cdf')
        .option('--percentiles <items>', 'Percentiles', listValues)
        .option('--freq-show [freqShow]', 'Frequency to show stats')
        .option('--simul-delay [simulDelay]',
            'Delay between two consecutive simulations (in second)', parseInt)
        .option('-t, --run-time [time]', 'Max running time (second)', parseInt)
        .option('--live-global [liveGlobal]',
            'Enable show both live and global stats')
        .option('--ssm [ssm]', 'Enable ssh-system-monitor')
        .option('--display-ssm [displaySsm]',
            'Flag for displaying ssm on console')
        .option('--res-consMonitor [resConsMonitor]',
            'Flag for monitoring resources consuming by s3blaster')
        .option('--rate [rate]', 'Rate for getting live stats, in ms', parseInt)
        .option('--req-rates [reqRates]',
            'array of rates for sending requests', listStrs)
        .option('-f, --output [output]', 'Suffix for output files')
        .option('--dontCleanDB [dontCleanDB]',
            'Flag for cleaning database at the end of simulation')
        .option('--fit-plot [fitPlot]', 'Enable fit feature for plotter')
        .option('  --output-type [outputType]',
            'type of output graph files, either pdf or png\n')
        .option('--message [message]',
            'Specified message that displays on all graphs')
        .option('--coefs <items>', 'Coefficients for cost function', listValues)
        .option('--part-sizes <items> or min:step:max', 'part sizes', getArr)
        .option('--mpu-paralreqs [mpuParalreqs]',
            'Number of parallel requests for uploading parts in MPU', parseInt)
        .option('--get-anyKey [getAnyKey]', 'Flag for get any key')
        .parse(process.argv);

        /* for account */
        config.accessKeyId = s3Config.acc.accessKeyId;
        config.secretAccessKey = s3Config.acc.secretAccessKey;

        /* for connections */
        this.host = commander.host || host || s3Config.conn.host || 'localhost';
        this.port = commander.port || port || s3Config.conn.port || 8000;
        this.haproxy = (this.port === 80);
        this.nWorkers = s3Config.conn.forksNb || 0;
        if (!isNaN(commander.nForks)) {
            this.nWorkers = commander.nForks;
        }
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

        config.endpoint = `${this.host}:${this.port}`;
        config.apiVersions = { s3: '2006-03-01' };
        config.sslEnabled = false;
        config.s3ForcePathStyle = true;
        config.httpOptions = {
            agent: new http.Agent({ keepAlive: true }),
        };
        this.s3 = new S3();

        /* for database */
        this.nBuckets = commander.nBuckets || s3Config.db.bucketsNb || 1;
        this.bucketPrefix = commander.bucketPrefix ||
                            s3Config.db.bucketPrefix || 'foo';
        this.sizes = commander.sizes || getArr(s3Config.db.sizes) || 1;
        this.unit = getUnit(commander.unit || s3Config.db.unit || 'KB');
        this.objMetadata = commander.objMetadata || s3Config.db.objMetadata ||
                            objMD.COMPACT;

        this.sizes = this.sizes.map(val => val * this.unit);
        this.nbDataSizes = this.sizes.length;
        this.maxKey = commander.nObjs || s3Config.db.objectsNb || Infinity;
        if (commander.fillObjs === undefined) {
            this.fillObjs = s3Config.db.fillObjs || 0;
        } else {
            this.fillObjs = parseInt(commander.fillObjs, 10);
        }

        /* for simulation*/
        // get requests via cmd
        this.reqsToTest = getRequests(commander.requests ||
                                        s3Config.simul.requests);
        this.fracs = commander.proprReqs || s3Config.simul.proprReqs;
        if (this.fracs && this.fracs.length >= this.reqsToTest.length) {
            this.fracs = this.fracs.slice(0, this.reqsToTest.length);
        } else {
            this.fracs = this.reqsToTest.map(() => 1);
        }

        // indices range of objects for requests: put, get, get-acl, del
        // either 'all' or 'min:max'
        let rAll;
        if (commander.range) {
            rAll = commander.range.slice(0, this.reqsToTest.length);
        } else {
            rAll = s3Config.simul.range ?
                    s3Config.simul.range.slice(0, this.reqsToTest.length) : [];
        }
        this.rAll = requests.map(() => [0, this.maxKey]);
        this.reqsToTest.forEach((req, idx) => {
            if (req === PUT_OBJ) {
                this.rPut = commander.rPut || rAll[idx];
                if (!this.rPut || this.rPut === 'all') {
                    this.rPut = [0, this.maxKey];
                } else {
                    this.rPut = this.rPut.split(':').map(Number);
                }
                if (this.rPut.length === 2) {
                    this.rAll[PUT_OBJ] = this.rPut.slice();
                }
            } else if (req === GET_OBJ) {
                this.rGet = commander.rGet || rAll[idx];
                if (!this.rGet || this.rGet === 'all') {
                    this.rGet = [0, this.maxKey];
                } else {
                    this.rGet = this.rGet.split(':').map(Number);
                }
                if (this.rGet.length === 2) {
                    this.rAll[GET_OBJ] = this.rGet.slice();
                }
            } else if (req === GET_ACL) {
                this.rGetAcl = commander.rGetAcl || rAll[idx];
                if (!this.rGetAcl || this.rGetAcl === 'all') {
                    this.rGetAcl = [0, this.maxKey];
                } else {
                    this.rGetAcl = this.rGetAcl.split(':').map(Number);
                }
                if (this.rGetAcl.length === 2) {
                    this.rAll[GET_ACL] = this.rGetAcl.slice();
                }
            } else if (req === DEL_OBJ) {
                this.rDel = commander.rDel || rAll[idx];
                if (!this.rDel || this.rDel === 'all') {
                    this.rDel = [0, this.maxKey];
                } else {
                    this.rDel = this.rDel.split(':').map(Number);
                }
                if (this.rDel.length === 2) {
                    this.rAll[DEL_OBJ] = this.rDel.slice();
                }
            } else if (req === MPU_OBJ) {
                this.rMpu = commander.rMpu || rAll[idx];
                if (!this.rMpu || this.rMpu === 'all') {
                    this.rMpu = [0, this.maxKey];
                } else {
                    this.rMpu = this.rMpu.split(':').map(Number);
                }
                if (this.rMpu.length === 2) {
                    this.rAll[MPU_OBJ] = this.rMpu.slice();
                }
            }
        });

        // 2 simul policies
        //  - 'each': requests are tested sequentially by their types
        //  - 'mixed': random request type is chosen for testing
        const _simul = commander.simul || s3Config.simul.schedule;
        this.simulPolicy = simulEach;
        if (_simul && _simul === 'mixed') {
            this.simulPolicy = simulMixed;
        }

        // delay between two consecutive simulations
        this.simulDelay =
            commander.simulDelay || s3Config.simul.simulDelay || 0;

        // the way for choosing key of object for next request of a same type
        // either 'rand' for random or 'seq' for sequential way
        this.nextKey =
                    commander.nextKey || s3Config.simul.nextKey || nextKeyRand;
        this.prefixKey = commander.prefixKey || s3Config.db.prefixKey;
        // number of parallel requests -> 2 ways: '<items>' or 'min:step:max'
        this.rThreads =
            commander.paralReqs || getArr(s3Config.simul.paralReqs) || [1, 2];
        this.nOps =
            commander.nObsers || s3Config.simul.observationsNb || Infinity;

        this.percentiles = commander.percentiles || s3Config.simul.percentiles;
        if (this.percentiles) {
            this.percentiles = this.percentiles.map(val => val / 100);
        }

        // array of rates for sending requests from each fork of s3blaster
        // Each rate corresponds to a type of request
        // either ['max', 'max'] or [200, 500]
        this.reqRates = commander.reqRates || s3Config.simul.sendReqRates;
        if (!this.reqRates) {
            this.reqRates = this.reqsToTest.map(() => Infinity);
        }
        this.setReqRates(this.reqRates);

        // accepting flag for getting NoSuchKey objects
        this.noKeyFlag = commander.okNokey || s3Config.simul.noKeyFlag || false;
        this.freqsToShow = commander.freqShow || s3Config.simul.freqShow || 100;
        this.runTime = commander.runTime || s3Config.simul.runTime || Infinity;
        // ssh-system-monitor
        this.ssm = commander.ssm || s3Config.simul.ssm || false;
        if (this.ssm === 'false') {
            this.ssm = false;
        }
        this.displaySSM = commander.displaySsm || s3Config.simul.displaySSM ||
                            false;
        if (this.displaySSM === 'false') {
            this.displaySSM = false;
        }

        this.displayRealTimePerf = this.displaySSM;

        // monitoring resources consuming by s3blaster
        this.resConsMonitor = commander.resConsMonitor ||
            s3Config.simul.resConsMonitor || false;
        if (this.resConsMonitor === 'false') {
            this.resConsMonitor = false;
        }

        // enable show both live and global stats
        this.liveGlobal =
            commander.liveGlobal || s3Config.simul.liveGlobal || false;
        if (this.liveGlobal === 'false') {
            this.liveGlobal = false;
        }

        this.output = commander.output || s3Config.plotter.output || '';
        this.prefixName = `${defaultFileName}${this.output}`;
        this.suffixName = '';
        this.messageInit = commander.message || s3Config.plotter.message || '';
        // add a '#' character after '\n'
        this.messageInit = `# ${this.messageInit.replace(/\n/g, '\n# ')}`;
        // rate for getting live stats, in ms
        this.samplingRatio = commander.rate || s3Config.simul.rate || 1000;

        this.coefs = commander.coefs || s3Config.probe.coefs || [1, 1];

        // for multipart-upload
        this.partSizes = commander.partSizes || getArr(s3Config.db.partSizes);
        if (this.partSizes) {
            this.partSizes = this.partSizes.map(val => Math.floor(val * MB));
        }
        this.mpuThread = commander.mpuParalreqs ||
                            s3Config.simul.mpuParalReqs || 10;

        this.dontCleanDB = commander.dontCleanDB || s3Config.simul.dontCleanDB;
        this.dontCleanDB = (this.dontCleanDB === 'true');

        this.fitPlot = commander.fitPlot || s3Config.plotter.fitPlot;
        this.outputType = commander.outputType || s3Config.plotter.outputType;
        if (this.outputType !== outputGraph.PNG) {
            this.outputType = outputGraph.PDF;
        }

        this.getAnyKey = commander.getAnyKey || s3Config.simul.getAnyKey;
        this.getAnyKey = (this.getAnyKey === 'true');

        Object.keys(this).forEach(opt => stdout.write(`${opt}=${this[opt]}\n`));

        /* for other params*/
        // get number of workers
        this.nProcesses = (this.nWorkers === 0) ? 1 : this.nWorkers;
        this.currThreadIdx = 0;
        this.nThreads = this.rThreads[this.currThreadIdx];
        this.initRThreads = this.rThreads;
        this.genDelays();

        this.actionFlag = [];
        this.buckets = [];
        this.createdBucketsNb = 0;

        this.initNbOps = this.nOps;

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

        this.threshold = this.nOps;

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
        this.statsFile = '';
        this.threadFile = '';
        this.realTimePerfFile = '';
        this.ssmFile = '';
        this.finalFile = '';
        /* For pdf and cdf */
        this.initFuncFiles = [`pdf${this.funcExt}`, `cdf${this.funcExt}`];
        this.funcFiles = this.initFuncFiles.slice();
        // for sampling latency
        this.step = commander.samplingStep || s3Config.simul.step || 1; // ms

        this.pdf = requests.map(() => this.sizes.map(() => []));
        this.cdf = requests.map(() => this.sizes.map(() => []));

        this.latThread = undefined;
        this.startSimul = undefined;
        this.endSimul = undefined;
        this.latThreshold = Infinity;

        this.currIndx = requests.map(() => 0);

        if (cluster.isMaster) {
            if (this.ssm) {
                ssmSystem.start(ssmConfig);

                // so the program will not close instantly
                process.stdin.resume();

                process.on('SIGINT', () => {
                    stdout.write('Received SIGINT');
                    ssmSystem.terminate(() => {
                        process.exit(0);
                    });
                });

                if (this.resConsMonitor) {
                    this.resConsumingFlag =
                        setInterval(this.getResConsuming.bind(this),
                                        this.samplingRatio);
                }
            }
        }
        this.currTime = undefined;
        this.stacks = requests.map(() => [0, 0, 0]);
        this.sendRates = requests.map(() => 0);
        this.ssmStats = '';
        this.realTimePerfStats = '';

        this.storedKeys = [];
        this.files = [];
        this.data = [];
        this.perfs = [LAT_PERF, OPR_PERF];
        this.doneForksNb = 0;
        if (this.percentiles) {
            this.percentilesArr = requests.map(() => this.sizes.map(() =>
                                            this.percentiles.map(() => 0)));
        }

        this.getMDsize = true;

        this.getMDRetriesNb = 0;
        // max number retries to get metadata sizes
        this.maxRetriesNb = 10 * servers.length;

        this.resConsuming = [0, 0];

        this.setActions(this.reqsToTest, this.fracs);
        this.checkConsistentParams();

        this.startProg = process.hrtime();
    }

    // delay between two consecutive sending requests
    genDelays() {
        this.delays = requests.map(() => 0);
        this.reqsToTest.forEach((req, reqIdx) => {
            this.delays[req] = (this.reqRates[reqIdx] === Infinity) ? 0 :
                    1000 * this.nThreads / this.reqRates[reqIdx];
        });
    }

    printParams() {
        let reqStr = '';
        this.reqsToTest.forEach((req, idx) => {
            reqStr += `# Request ${requests[req]}: ` +
                `max sending rate: ${this.reqRates[idx]} (ops/s), ` +
                `delay: ${this.delays[req]} (ms), ` +
                `proportion: ${this.fracLoads[idx].toFixed(2)}, ` +
                `range: ${this.rAll[req]}\n`;
        });
        this.message = `${this.messageInit}\n` +
            `# Host: ${this.host}:${this.port}\n` +
            `# Forks nb: ${this.nWorkers}\n` +
            `# Buckets nb: ${this.nBuckets}\n` +
            `# Objects nb: ${this.maxKey}\n` +
            `# Objset sizes: ${this.sizes.map(size => convertSize(size))}\n`;
        if (this.partSizes) {
            this.message +=
            `# Part sizes: ${this.partSizes.map(size => convertSize(size))}\n`;
        }
        this.message += `${reqStr}` +
            `# Nb of parallel requests: ${this.rThreads}\n` +
            `# Simulation schedule: ${this.simulPolicy}`;
    }

    showParams() {
        stdout.write('----- Input params -----\n');
        ['host', 'port', 'nOps', 'runTime', 'bucketPrefix',
            'nBuckets', 'sizes', 'nWorkers', 'rThreads', 'simulPolicy',
            'proprReqs', 'nextKey', 'maxKey', 'freqsToShow']
            .forEach(opt => stdout.write(`${opt}=${this[opt]}\n`));
    }

    setParams(params) {
        if (params === undefined) return;
        if (params.nbBuckets !== undefined) {
            this.nBuckets = parseInt(params.nbBuckets, 10);
        }
        if (params.nbWorkers !== undefined && cluster.isMaster) {
            this.nWorkers = parseInt(params.nbWorkers, 10);
            this.nProcesses = (this.nWorkers === 0) ? 1 : this.nWorkers;
        }
        if (params.prefSufName !== undefined) {
            this.setPrefixSuffixName.bind(this)(params.prefSufName[0],
                                                params.prefSufName[1]);
        }
        /* Note: `nOps` must be set before `freqsToShow`, `simulPolicy`,
         *   `maxKey`
         */
        if (params.nOps !== undefined) {
            this.setNbOps.bind(this)(params.nOps);
        }
        /* Note: `reqsToTest` must be set before `distrFuncParams` */
        if (params.reqsToTest !== undefined) {
            this.setReqsToTest.bind(this)(params.reqsToTest);
        }
        if (params.samplingStep) {
            this.step = Number(params.samplingStep);
        }
        if (params.resetStatsAfterEachTest !== undefined) {
            this.setResetStatsFlag.bind(this)(params.resetStatsAfterEachTest);
        }
        if (params.simulPolicy !== undefined) {
            this.simulPolicy = params.simulPolicy;
        }
        if (params.freqsToShow !== undefined) {
            this.setFreqsToShow.bind(this)(params.freqsToShow);
        }
        if (params.sizes !== undefined) {
            this.setSizes.bind(this)(params.sizes);
        }
        if (params.arrThreads !== undefined) {
            this.setThreads.bind(this)(params.arrThreads);
        }
        if (params.runTime) {
            this.runTime = Number(params.runTime); // in seconds
        }
        if (params.latThreshold) {
            this.latThreshold = Number(params.latThreshold);
        }
        if (params.nextKey) {
            this.nextKey = params.nextKey;
        }
        if (params.nObjs) {
            if (parseInt(params.nObjs, 10) > 0) {
                this.maxKey = parseInt(params.nObjs, 10);
            }
        }
        if (params.rPut) {
            this.rPut = params.rPut.map(nb => parseInt(nb, 10));
        }
        if (params.rGet) {
            this.rGet = params.rGet.map(nb => parseInt(nb, 10));
        }
        if (params.rGetAcl) {
            this.rGetAcl = params.rGetAcl.map(nb => parseInt(nb, 10));
        }
        if (params.rDel) {
            this.rDel = params.rDel.map(nb => parseInt(nb, 10));
        }
        if (params.rMpu) {
            this.rMpu = params.rMpu.map(nb => parseInt(nb, 10));
        }
        if (params.noKeyFlag) {
            this.noKeyFlag = params.noKeyFlag;
        }
        if (params.host) {
            this.host = params.host;
            config.endpoint = `${this.host}:${this.port}`;
        }
        if (params.port) {
            this.port = params.port;
            config.endpoint = `${this.host}:${this.port}`;
        }
        if (params.rThreads) {
            this.rThreads = params.rThreads.slice();
            this.nThreads = this.rThreads[0];
        }
        if (params.liveGlobal) {
            this.liveGlobal = params.liveGlobal;
        }
        if (params.reqRates) {
            this.setReqRates.bind(this)(params.reqRates);
        }
        this.checkConsistentParams();
    }

    checkConsistentParams() {
        if (this.simulPolicy !== simulEach && this.simulPolicy !== simulMixed) {
            stderr.write('Set simul schedule as simulEach\n');
            this.simulPolicy = simulEach;
        }
        // check consistency of nOps and runTime
        if (this.threshold === Infinity && this.runTime === Infinity) {
            stderr.write('Number of operations and running time are currently');
            stderr.write(` infinity. Set running time to be 60s\n`);
            this.runTime = 60;
        }
        if (this.simulPolicy === simulMixed && this.runTime !== Infinity) {
            this.runTime *= this.reqsToTest.length;
        }

        // check consistency of maxKey and rPut, rGet, rDel
        if (this.maxKey === Infinity) {
            this.maxKey = Math.max(this.rPut[1], this.rGet[1], this.rGetAcl[1],
                                    this.rDel[1]);
            if (this.maxKey === Infinity) {
                this.maxKey = defaultMaxKey;
                this.rPut[1] = this.maxKey;
                this.rGet[1] = this.maxKey;
                this.rGetAcl[1] = this.maxKey;
                this.rDel[1] = this.maxKey;
                this.rMpu[1] = this.maxKey;
            }
        }
        if (!this.rAll) {
            this.rAll = requests.map(() => [0, this.maxKey]);
        }
        this.reqsToTest.forEach(action => {
            if (action === PUT_OBJ) {
                this.rAll[PUT_OBJ] = this.rPut.slice();
            } else if (action === GET_OBJ) {
                this.rAll[GET_OBJ] = this.rGet.slice();
            } else if (action === GET_ACL) {
                this.rAll[GET_ACL] = this.rGetAcl.slice();
            } else if (action === DEL_OBJ) {
                this.rAll[DEL_OBJ] = this.rDel.slice();
            } else if (action === MPU_OBJ) {
                this.rAll[MPU_OBJ] = this.rMpu.slice();
            }
        });
        this.rAll.forEach((arr, idx) => {
            if (!arr) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr = [0, this.maxKey]; // eslint-disable-line
                this.rAll[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[0] > arr[1]) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr = [0, this.maxKey]; // eslint-disable-line
                this.rAll[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[0] < 0) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr[0] = 0; // eslint-disable-line
                this.rAll[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            } else if (arr[1] > this.maxKey) {
                stderr.write(`wrong format for ${requests[idx]}: ${arr}. `);
                arr[1] = this.maxKey; // eslint-disable-line
                this.rAll[idx] = arr;
                stderr.write(`Reset it as ${arr}\n`);
            }
        });
        stdout.write('Indices range for each requests:\n');
        this.reqsToTest.forEach(req => {
            stdout.write(`${requests[req]}: ${this.rAll[req]}\n`);
        });

        if (!this.getAnyKey) {
            if (this.rGet &&
                (this.rGet[1] !== this.maxKey || this.rGet[0] !== 0)) {
                this.getAnyKey = true;
            }

            if (!this.fillObjs || this.fillObjs < 1) {
                this.getAnyKey = false;
            }
        }

        if (this.nextKey !== nextKeyRand &&
            this.nextKey !== nextKeySeq) {
            this.nextKey = nextKeyRand;
            stderr.write('wrong arg for `nextKey`. Set it as nextKeyRand');
        }
        if (this.reqsToTest.length !== this.reqRates.length) {
            this.setReqRates.bind(this)();
        }
        if (cluster.isMaster) {
            // create file gathering results from all workers
            this.finalFile = this.prefixName + this.suffixName + this.finalExt;
            objToPlotter.arrDataFiles[graphs.final] = this.finalFile;
        }
        // update message if relevant
        this.printParams.bind(this)();

        // update objToPlotter
        objToPlotter.config = {
            host: `${this.host}:${this.port}`,
            forks: `${this.nWorkers}`,
            bucketsNb: `${this.nBuckets}`,
            objsNb: `${this.maxKey}`,
            proportion: `${this.fracLoads.map(frac => frac.toFixed(3))}`,
            range: `${this.rAll}`,
            sendReqRates: `${this.reqRates} (ops/s)`,
            delay: `${this.delays}`,
            schedule: `${this.simulPolicy}`,
            prefixName: `${this.prefixName}`,
        };
        objToPlotter.requests = this.reqsToTest;
        objToPlotter.threads = this.rThreads;
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
        objToPlotter.results = requests.map(() => this.rThreads.map(() =>
                    this.sizes.map(() => [])));

        /* only for Master: get realTimePerfFiles from all workers */
        if (cluster.isMaster) {
            objToPlotter.procNames = new Array(this.nProcesses).fill(' ');
            if (this.nWorkers === 0) {
                objToPlotter.allRealTimeFiles[0] =
                    `${statsFolder}` +
                    `${this.output}${this.realTimePerfExt}`;
                objToPlotter.procNames[0] = 'Master';
            } else {
                for (let idx = 1; idx <= this.nWorkers; idx++) {
                    objToPlotter.allRealTimeFiles[idx - 1] =
                        `${statsFolder}` +
                        `worker${idx}/${this.output}${this.realTimePerfExt}`;
                    objToPlotter.procNames[idx - 1] = `Worker${idx}`;
                }
            }
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
        setTimeout(ssmSystem.calculateMDSize.bind(ssmSystem), 100,
            (err, mdSize) => {
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
        if (this.ssm) {
            if (cluster.isMaster) {
                this.monitorStats();
            }
            if (cluster.isWorker || (cluster.isMaster && this.nWorkers === 0)) {
                this.realTimePerf();
            }
        }
        this.resetPdfCdf();
        this.reqsToTest.forEach(req => {
            this.resetDataStats.bind(this)(req);
        });
        this.createdBucketsNb = 0;
        this.createBuckets(err => {
            if (err) {
                return cb(err);
            }
            if (cluster.isMaster && this.ssm) {
                this.getInitMDSize.bind(this)(err => {
                    if (err) {
                        stderr.write(`Error get MD size: ${err}\n`);
                        this.getMDsize = false;
                    } else {
                        this.getMDsize = true;
                    }
                });

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
            }, this.fillObjs);
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
        const fracs = _fracs || this.fracs;

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
        this.threshold = this.nOps;
        if (this.simulPolicy === simulMixed) {
            this.threshold *= (this.currActions.length * this.sizes.length);
        }
        if (this.maxKey === Infinity && this.nOps !== Infinity) {
            this.maxKey = this.threshold;
        }
        this.currSizeIdx = 0;
        this.value = this.values[this.currSizeIdx];
        this.size = this.sizes[this.currSizeIdx];
        this.setFracLoads(fracs);

        stdout.write('requests [proportion]: ');
        this.currActions.forEach((action, idx) =>
            stdout.write(`${requests[action]}[${this.fracLoads[idx]}], `));
        stdout.write(`\n`);
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
            this.rThreads = arrThreads.slice();
            this.currThreadIdx = 0;
            this.nThreads = arrThreads[0];
        } else {
            if (arrThreads < 0) {
                this.rThreads = this.initRThreads;
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
            this.freqsToShow = nb;
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
        if (nOps !== this.nOps) {
            if (nOps > 0) {
                this.nOps = parseInt(nOps, 10);
            } else {
                this.nOps = this.initNbOps;
            }
            this.threshold = this.nOps;
            this.freqsToShow = Math.ceil(this.nOps / 10);
        }
    }

    setReqRates(reqRates) {
        if (reqRates && Array.isArray(reqRates) &&
            reqRates.length >= this.reqsToTest.length) {
            this.reqRates =
                reqRates.slice(0, this.reqsToTest.length).map(rate => {
                    if (rate === 'max') {
                        return Infinity;
                    }
                    return Number(rate);
                });
        } else {
            stderr.write('Wrong input for sending request rates. ' +
                         'Set it being unlimited\n');
            this.reqRates = this.reqsToTest.map(() => Infinity);
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
        objToPlotter.arrDataFiles.push(this.statsFile, this.funcFiles,
                                 this.threadFile, this.realTimePerfFile);

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
        [createStatsFile, createFuncFiles, createThreadFile,
            createRealTimePerfFile].forEach(func => {
                func.bind(this)(err => {
                    if (err) {
                        cb(err); return;
                    }
                    count += 1;
                    if (count === objToPlotter.arrDataFiles.length) {
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
        this.ssmFile = this.prefixName + this.suffixName +
                                    this.ssmExt;
        objToPlotter.arrDataFiles[graphs.live] = this.ssmFile;

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

    printStats(idx) {
        this.currRunTime = getHrTime(this.startSimul);
        const nSuccesses = this.nSuccesses[idx][this.currSizeIdx];
        // const nFailures = this.nFailures[idx][this.currSizeIdx];
        const nOpsSec = this.nSuccesses[idx][this.currSizeIdx] * 1e3 /
                                                        this.currRunTime;
        const latMu = this.latSum[idx][this.currSizeIdx] / nSuccesses;
        const latSigma = Math.sqrt(this.latSumSq[idx][this.currSizeIdx] /
                                    nSuccesses - latMu * latMu);
        const latMin = this.latMin[idx][this.currSizeIdx].toFixed(2);
        const latMax = this.latMax[idx][this.currSizeIdx].toFixed(2);
        if (!this.ssm || this.liveGlobal) {
            stdout.write(`${toFixedLength(process.pid, 6)}`);
            stdout.write(`${toFixedLength(this.nThreads, 6)}`);
            stdout.write(`${toFixedLength(requests[idx], 14)}`);
            stdout.write(`${toFixedLength(convertSize(this.size), 10)}`);
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
            this.computePercentiles(idx, this.currSizeIdx);
            valuesToPlot =
                valuesToPlot.concat(this.percentilesArr[idx][this.currSizeIdx]);
        }
        this.dataToPlot[idx][this.currSizeIdx].push(valuesToPlot);
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
     *  group by requet types for test. Each group corresponds to
     *  a data size.
     * @param {function} cb: callback function
     * @return {function} callback
     */
    updateFuncFiles(cb) {
        /* compute pdf and cdf */
        this.finalizePdfCdf();
        let count = 0;
        const funcArr = [this.pdf, this.cdf];
        let dataContent;
        let maxPdfLen = 0;
        this.reqsToTest.forEach(req => {
            maxPdfLen = Math.max(maxPdfLen,
                                Math.max.apply(Math, this.latMax[req]));
        });
        maxPdfLen = parseInt(maxPdfLen / this.step, 10);

        this.funcFiles.forEach((file, fileIdx) => {
            dataContent = `# Configuration info\n`;
            /* add metadata info */
            dataContent += `# host ${this.host}:${this.port}\n`;
            dataContent += `# bucketsNb ${this.nBuckets}\n`;
            dataContent += `# processesNb ${this.nProcesses}\n`;
            dataContent += `# threadsNb ${this.nThreads}\n`;
            dataContent += `# nOps ${this.threshold}\n`;
            dataContent += '# sizes';
            this.sizes.forEach(size => {
                dataContent += ` ${size}`;
            });
            dataContent += `\n# requests`;
            this.reqsToTest.forEach(req => {
                dataContent += ` ${req}`;
            });
            // min value for each column
            dataContent += `\n# min`;
            this.sizes.forEach((size, idx) => {
                this.reqsToTest.forEach(req => {
                    const min = Math.floor(this.latMin[req][idx] / this.step) *
                                    this.step;
                    dataContent += ` ${min.toFixed(2)}`;
                });
            });
            dataContent += `\n# max`;
            this.sizes.forEach((size, idx) => {
                this.reqsToTest.forEach(req => {
                    const max = Math.floor(this.latMax[req][idx] / this.step) *
                                    this.step;
                    dataContent += ` ${max.toFixed(2)}`;
                });
            });
            dataContent += `\n# mu`;
            this.sizes.forEach((size, idx) => {
                this.reqsToTest.forEach(req => {
                    const mu = this.latSum[req][idx] /
                               this.nSuccesses[req][idx];
                    dataContent += ` ${mu.toFixed(2)}`;
                });
            });
            dataContent += `\n# sigma`;
            this.sizes.forEach((size, idx) => {
                this.reqsToTest.forEach(req => {
                    const mu = this.latSum[req][idx] /
                               this.nSuccesses[req][idx];
                    const sigma = Math.sqrt(this.latSumSq[req][idx] /
                            this.nSuccesses[req][idx] - mu * mu);
                    dataContent += ` ${sigma.toFixed(2)}`;
                });
            });
            dataContent += `\n# End_configuration\n`;
            /* add column headers*/
            dataContent += '# Data size';
            let label = '';
            this.reqsToTest.forEach(idx => {
                label += `${requests[idx]}  `;
            });
            this.sizes.forEach(size => {
                const len = (label.length - size.toString().length) / 2;
                const space = toFixedLength(' ', len);
                dataContent += space + size.toString() + space;
            });
            dataContent += `\n# Latency `;
            this.sizes.forEach(() => {
                dataContent += label;
            });
            dataContent += `\n`;
            fs.writeFile(file, dataContent, err => {
                if (err) {
                    cb(err); return;
                }
                /* distribution function */
                dataContent = '';
                for (let idx = 0; idx < maxPdfLen; idx++) {
                    dataContent +=
                        `${toFixedLength((this.step * idx).toFixed(1), 9)} `;
                    for (let sizeIdx = 0; sizeIdx < this.sizes.length;
                        sizeIdx++) {
                        this.reqsToTest.forEach(req => { // eslint-disable-line
                            const lat = funcArr[fileIdx][req][sizeIdx][idx];
                            if (lat) {
                                dataContent +=
                                    `${toFixedLength(lat.toFixed(3), 7)}  `;
                            } else {
                                dataContent += `${toFixedLength('?0/1', 7)}  `;
                            }
                        });
                    }
                    dataContent += `\n`;
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

        if (cluster.isMaster && this.nWorkers > 0) {
            if (this.ssm) {
                return this.updateSsmFile.bind(this)(cb);
            }
            return cb();
        } else if (cluster.isMaster && this.nWorkers === 0) {
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
        if (this.resetStatsAfterEachTest || this.rThreads.length > 1) {
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
            this.pdf[req] = this.sizes.map(() => []);
            this.cdf[req] = this.sizes.map(() => []);
        }
    }

    resetPdfCdf() {
        this.pdf = requests.map(() => this.sizes.map(() => []));
        this.cdf = requests.map(() => this.sizes.map(() => []));
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

    updateStats(idx, time) {
        let lat = time;
        this.stacks[idx][0]++;
        this.stacks[idx][1] += lat;
        this.stacks[idx][2] += lat * lat;
        this.latSum[idx][this.currSizeIdx] += lat;
        this.latSumSq[idx][this.currSizeIdx] += lat * lat;
        this.nBytes[idx][this.currSizeIdx] += this.size;
        this.nSuccesses[idx][this.currSizeIdx]++;
        if (lat < this.latMin[idx][this.currSizeIdx]) {
            this.latMin[idx][this.currSizeIdx] = lat;
        }
        if (lat > this.latMax[idx][this.currSizeIdx]) {
            this.latMax[idx][this.currSizeIdx] = lat;
        }
        lat = Math.floor(lat / this.step);
        if (!this.pdf[idx][this.currSizeIdx][lat]) {
            this.pdf[idx][this.currSizeIdx][lat] = 1;
        } else {
            this.pdf[idx][this.currSizeIdx][lat]++;
        }
    }

    updateStatsFinal(idx) {
        const nOpsSec = this.nSuccesses[idx][this.currSizeIdx] * 1e3 /
                                                        this.currRunTime;
        const maxLatThread = Math.max.apply(Math.max, this.latThread[idx]);
        const coef = maxLatThread / this.latSum[idx][this.currSizeIdx];
        if (coef < 1) {
            // update this.pdf
            this.pdf[idx][this.currSizeIdx].forEach((frac, lat) => {
                if (frac > 0) {
                    const newLat = Math.floor(lat * coef);
                    this.pdf[idx][this.currSizeIdx][newLat] += frac;
                    this.pdf[idx][this.currSizeIdx][lat] = 0;
                }
            });
            this.latMin[idx][this.currSizeIdx] *= coef;
            this.latMax[idx][this.currSizeIdx] *= coef;
            const nSuccesses = this.nSuccesses[idx][this.currSizeIdx];
            const latMu = maxLatThread / nSuccesses;
            const latSigma = Math.sqrt(this.latSumSq[idx][this.currSizeIdx] /
                            nSuccesses - latMu * latMu) * coef;
            if (!this.ssm || this.liveGlobal) {
                stdout.write(`${toFixedLength('Final', 12)}`);
                stdout.write(`${toFixedLength(this.nThreads, 2)}  `);
                stdout.write(`${toFixedLength(requests[idx], 6)} `);
                stdout.write(`${toFixedLength(this.size, 8)} `);
                stdout.write(`${toFixedLength(nSuccesses, 6)} `);
                stdout.write(`${toFixedLength(nOpsSec.toFixed(2), 8)} `);
                stdout.write(`${toFixedLength(' ', 8)} `);
                stdout.write(`${toFixedLength(' ', 8)} `);
                stdout.write(`${toFixedLength(latMu.toFixed(3), 8)} `);
                stdout.write(`${toFixedLength(latSigma.toFixed(3), 8)}\n`);
            }
            const valuesToPlot =
                [nSuccesses.toFixed(), latMu.toFixed(3), latSigma.toFixed(3),
                    this.nThreads.toFixed(3), nOpsSec.toFixed(2)];
            this.dataToPlot[idx][this.currSizeIdx].push(valuesToPlot);
        }
    }

    finalizePdfCdf() {
        /* normalize pdf, and then compute cdf */
        this.pdf.forEach((pdfPerReq, idxA) => {
            pdfPerReq.forEach((pdf, idxB) => {
                if (pdf.length > 0) {
                    const sum = pdf.reduce((a, b) => a + b);
                    if (sum > 0) {
                        // normalize pdf
                        pdf.forEach((val, idx) => {
                            this.pdf[idxA][idxB][idx] = val / sum;
                        });
                        /* compute cdf from pdf */
                        pdf.reduce((a, b, idx) => {
                            this.cdf[idxA][idxB][idx] = a + b;
                            return this.cdf[idxA][idxB][idx];
                        }, 0);
                    }
                }
            });
        });
    }

    computeAllPercentiles() {
        this.pdf.forEach((pdfPerReq, idxA) => {
            pdfPerReq.forEach((pdf, idxB) => {
                if (pdf.length > 0) {
                    pdf.reduce((a, b, idx) => {
                        this.cdf[idxA][idxB][idx] = a + b;
                        return this.cdf[idxA][idxB][idx];
                    }, 0);
                    // normalize _cdf
                    const max = this.cdf[idxA][idxB]
                                            [this.cdf[idxA][idxB].length - 1];
                    if (max > 0) {
                        // normalize cdf
                        this.cdf[idxA][idxB].forEach((val, idx) => {
                            this.cdf[idxA][idxB][idx] = val / max;
                        });
                        let percIndx = 0;
                        this.percentiles.forEach((marker, idx) => {
                            while (!this.cdf[idxA][idxB][percIndx] ||
                                this.cdf[idxA][idxB][percIndx] < marker) {
                                percIndx++;
                            }
                            this.percentilesArr[idxA][idxB][idx] =
                                                        percIndx * this.step;
                        });
                    }
                }
            });
        });
    }

    computePercentiles(req, sizeIdx) {
        if (this.pdf[req][sizeIdx].length > 0) {
            this.pdf[req][sizeIdx].reduce((a, b, idx) => {
                this.cdf[req][sizeIdx][idx] = a + b;
                return this.cdf[req][sizeIdx][idx];
            }, 0);
            // normalize _cdf
            const max = this.cdf[req][sizeIdx]
                                    [this.cdf[req][sizeIdx].length - 1];
            if (max > 0) {
                // normalize cdf
                this.cdf[req][sizeIdx].forEach((val, idx) => {
                    this.cdf[req][sizeIdx][idx] = val / max;
                });
                let percIndx = 0;
                this.percentiles.forEach((marker, idx) => {
                    while (!this.cdf[req][sizeIdx][percIndx] ||
                        this.cdf[req][sizeIdx][percIndx] < marker) {
                        percIndx++;
                    }
                    this.percentilesArr[req][sizeIdx][idx] =
                                                    percIndx * this.step;
                });
            }
        }
    }

    createBuckets(cb) {
        const bucketName = `${this.bucketPrefix}${this.createdBucketsNb}`;
        stdout.write(`creating bucket ${bucketName}..`);
        this.createBucket(bucketName, err => {
            if (err) {
                cb(`error creating bucket ${bucketName}: ${err}\n`);
                return;
            }
            stdout.write(`createBuckets done\n`);
            this.buckets.push(bucketName);
            mdInfo.bucketsList.push(bucketName);
            this.storedKeys[bucketName] = this.sizes.map(() => []);
            this.createdBucketsNb += 1;
            if (this.createdBucketsNb === this.nBuckets) {
                cb(); return;
            }
            this.createBuckets(cb);
            return;
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
     * @param {number} objsNb: number of objects per thread, per size to be
     *                          created in each bucket
     * @param {number} _threadsNb: number of threads for filling objects
     * @return {this}: this
     */
    fillObjects(cb, objsNb, _threadsNb) {
        if (cluster.isMaster && this.nWorkers > 0) {
            return cb();
        }
        const threadsNb = _threadsNb || Math.max.apply(Math, this.rThreads);
        const _objsNb = parseInt(objsNb, 10) || 0;
        if (_objsNb === 0) {
            return cb();
        }

        stdout.write(`filling ${_objsNb} objects in each bucket..`);
        let count = 0;
        let bucketIndx = 0;
        let sizeIndx = 0;
        let createdObjsNb = 0;
        const totalObjsNb = _objsNb * this.sizes.length * this.buckets.length;
        function putObj(cb) {
            count++;
            if (count % (_objsNb + 1) === 0) {
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

            const object = {
                Key: this.genKey((count - 1) % this.maxKey),
                // Body: new Buffer(this.values[sizeIndx]),
                Body: this.values[sizeIndx],
                Bucket: bucket,
            };
            return this.s3.putObject(object, err => {
                if (err) {
                    stdout.write(`fill ${object.Key} to ${bucket}: ${err}\n`);
                    return cb(err);
                }
                // Note: objs put by fillObjs should not stored in storedKeys
                // this.storedKeys[bucket][sizeIndx].push(object.Key);
                createdObjsNb++;
                if (createdObjsNb % 1000 === 0) {
                    process.stdout.write(`filled ${createdObjsNb} objets\n`);
                }

                if (createdObjsNb === totalObjsNb) {
                    stdout.write(`fillObjects done\n`);
                    return cb();
                }
                return setTimeout(putObj.bind(this), this.delays[PUT_OBJ], cb);
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
                        cb(err); return;
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
                });
            });
        });
    }

    doSimul(cb) {
        this.currTime = process.hrtime();
        if (this.actionFlag[COM_OBJ]) {
            [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                this.resetStats(req);
            });
        }
        this.currActions.forEach(req => {
            this.resetStats(req);
        });

        // this.currIndx = requests.map(() => 0);

        // generate delays here since delays could vary if there are multiple
        // number of parallel requests
        this.genDelays();

        if (!this.actionFlag.every(req => req === -0)) {
            this.latThread = requests.map(() =>
                createNewArray(this.nThreads, 0)
            );
            this.startSimul = process.hrtime();
            if (cluster.isMaster) {
                for (let i = 0; i < this.nWorkers; i++) {
                    cluster.fork();
                }
                if (this.nWorkers === 0) {
                    for (let idx = 0; idx < this.nThreads; idx++) {
                        this.threads++;
                        if (this.simulPolicy === simulMixed) {
                            this.setNextRandomAction.bind(this)();
                        }
                        process.nextTick(this.actions[this.actionIdx].bind(this)
                                            , cb, idx);
                    }
                } else {
                    cluster.on('disconnect', worker => {
                        stdout.write(`Worker #${worker.id} has disconnected\n`);
                        this.doneForksNb++;
                        if (this.doneForksNb === this.nWorkers) {
                            this.gatherResults(cb);
                        }
                    });
                }
            } else {
                for (let idx = 0; idx < this.nThreads; idx++) {
                    this.threads++;
                    if (this.simulPolicy === simulMixed) {
                        this.setNextRandomAction.bind(this)();
                    }
                    process.nextTick(this.actions[this.actionIdx].bind(this)
                                        , cb, idx);
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

    doNextAction(reqIdx, cb, threadIdx) {
        /* if current data size is the last one
         *  - current request is done, disable it
         *  - go next request
         *      if current request is the last one, do next `threadsNb`
         * otherwise, go next data size
         */
        function doNextDataSize() {
            if (this.currSizeIdx === this.sizes.length - 1) {
                this.actionFlag[reqIdx] = false;
                this.currSizeIdx = 0;
                /* if current request is the last one -> simul is done */
                if (this.actionIdx === this.actions.length - 1) {
                    if (reqIdx === COM_OBJ) {
                        [PUT_OBJ, GET_OBJ, DEL_OBJ].forEach(req => {
                            this.printStats(req);
                        });
                    }
                    return false; // will call next threadsNb
                }
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
            this.updateThreadStats();
            if (this.currThreadIdx === this.rThreads.length - 1) {
                this.currThreadIdx = 0;
                this.nThreads = this.rThreads[0];
                return false; // will call cb
            }
            this.currThreadIdx++;
            this.nThreads = this.rThreads[this.currThreadIdx];

            //  for simulEach only, reset data size and action indices
            if (this.simulPolicy === simulEach) {
                this.currSizeIdx = 0;
                this.actionIdx = 0;
                this.setActions(this.currActions);
            }

            return true; // will do next thread
        }

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

                if (this.simulPolicy === simulMixed) {
                    this.currActions.forEach(reqIdx => {
                        this.printStats(reqIdx);
                    });
                    this.updateResForPlotter();
                    if (!doNextThread.bind(this)()) {
                        cb();
                        return;
                    }
                } else {
                    this.printStats(reqIdx);
                    this.updateResForPlotter();
                    /* decide for next data size */
                    if (!doNextDataSize.bind(this)()) {
                        /* decide for next nThreads */
                        if (!doNextThread.bind(this)()) {
                            cb();
                            return;
                        }
                    }
                }
                this.size = this.sizes[this.currSizeIdx];
                this.value = this.values[this.currSizeIdx];
                setTimeout(this.doSimul.bind(this), this.simulDelay, cb);
            }
        } else {
            /* number of operations is not enough -> continue */
            if (this.simulPolicy === simulMixed) {
                this.setNextRandomAction.bind(this)();
            }
            setTimeout(this.actions[this.actionIdx].bind(this),
                                            this.delays[reqIdx], cb, threadIdx);
        }
        return;
    }

    genKey(keyIndx) {
        return this.prefixKey ? `${this.prefixKey}${keyIndx}` :
                `key_S${this.size}_C${keyIndx}`;
    }

    getNextKey(reqIndx, lower, upper, method, number) {
        const min = lower || 0;
        const max = upper || this.maxKey;
        let keyIndx;
        const nextKey = method || this.nextKey;
        switch (nextKey) {
        case nextKeySeq:
            keyIndx = this.currIndx[reqIndx];
            this.currIndx[reqIndx]++;
            if (this.currIndx[reqIndx] >= max) {
                this.currIndx[reqIndx] = min;
            }
            return number ? Number(keyIndx) : this.genKey(keyIndx);
        case nextKeyRand:
        default:
            keyIndx = min + Math.floor(Math.random() * (max - min));
            return number ? Number(keyIndx) : this.genKey(keyIndx);
        }
    }

    // only master runs this function
    monitorStats() {
        const elapsedTime = (getHrTime(this.startProg) / 1e3).toFixed(0);
        let strToFile = `${elapsedTime} `;
        /* create string for display */
        /* update content for stats file */
        latestStates.forEach((val, valIndx) => {
            if (val && val !== ' ') {
                if (valIndx % allTypesLen === ioStatIndx) {
                    let ssdUsed = 0;
                    val.split(' ').forEach(nb => {
                        ssdUsed += Number(nb);
                    });
                    strToFile +=
                        `${toFixedLength(ssdUsed.toFixed(2), 20)} `;
                } else {
                    strToFile += `${toFixedLength(val, 20)} `;
                }
            } else {
                if (Array.isArray(_ssmTypes[ssmTypes[valIndx %
                                                allTypesLen]])) {
                    strToFile += `${toFixedLength(' ?0/1 ?0/1 ', 20)}`;
                } else {
                    strToFile += `${toFixedLength(' ?0/1 ', 20)}`;
                }
            }
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

        setTimeout(this.monitorStats.bind(this), this.samplingRatio);
    }

    // processing processes run this function
    realTimePerf() {
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
                                        this.samplingRatio).toFixed(0);
                const avgRecRate = (this.stacks[req][0] * 1000 /
                                        this.samplingRatio).toFixed(0);
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

        setTimeout(this.realTimePerf.bind(this), this.samplingRatio);
    }

    put(cb, threadIdx) {
        this.count++;
        const key = this.getNextKey(PUT_OBJ, this.rPut[0], this.rPut[1]);
        // const key = `key_S${this.size}_C${this.currIndx[PUT_OBJ]}`;
        // this.currIndx[PUT_OBJ]++;

        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
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
            // object.SSECustomerAlgorithm = 'AES256';
            // object.SSECustomerKey = 's3blaster';
            // object.SSECustomerKeyMD5 = 'keyMD5';
            // object.SSEKMSKeyId = '1';
            // object.ServerSideEncryption = 'AES256';
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
                stderr.write(`error put ${object.Bucket}: ${err}\n`);
            } else {
                this.storedKeys[bucketName][sizeIdx].push(key);
                this.latThread[PUT_OBJ][threadIdx] += time;
                this.updateStats(PUT_OBJ, time);
                if (this.nSuccesses[PUT_OBJ][sizeIdx] %
                        this.freqsToShow === 0) {
                    this.printStats(PUT_OBJ);
                }
            }
            process.nextTick(this.doNextAction.bind(this), PUT_OBJ, cb,
                                threadIdx);
        });
    }

    get(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
        const sizeIdx = this.currSizeIdx;
        let key;
        if (this.getAnyKey) {
            // const keyIndx = Math.floor(Math.random() * this.maxKey);
            // key = this.genKey(keyIndx);
            key = this.getNextKey(GET_OBJ, this.rGet[0], this.rGet[1]);
        } else {
            if (this.storedKeys[bucketName][sizeIdx].length > 0) {
                const index = this.getNextKey(GET_OBJ, 0,
                    this.storedKeys[bucketName][sizeIdx].length,
                    null, true);
                key = this.storedKeys[bucketName][sizeIdx][index];
            } else {
                if (this.noKeyFlag) {
                    key = 'undefined';
                } else {
                    process.nextTick(this.doNextAction.bind(this), GET_OBJ, cb,
                                        threadIdx);
                    return;
                }
            }
        }

        const object = {
            Key: key,
            Bucket: bucketName,
        };
        this.sendRates[GET_OBJ]++;

        const start = process.hrtime();
        this.s3.getObject(object, err => {
            const time = getHrTime(start);
            if (err && (!(this.noKeyFlag &&
                        err.toString().split(':')[0] === 'NoSuchKey'))) {
                this.nFailures[GET_OBJ][sizeIdx]++;
                stderr.write(`get ${object.Key} ${object.Bucket}: ${err}\n`);
            } else {
                this.latThread[GET_OBJ][threadIdx] += time;
                this.updateStats(GET_OBJ, time);
                if (this.nSuccesses[GET_OBJ][sizeIdx] %
                        this.freqsToShow === 0) {
                    this.printStats(GET_OBJ);
                }
            }
            process.nextTick(this.doNextAction.bind(this), GET_OBJ, cb,
                                threadIdx);
        });
    }

    getAcl(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
        const sizeIdx = this.currSizeIdx;
        let key;
        if (this.storedKeys[bucketName][sizeIdx].length > 0) {
            const index = this.getNextKey(GET_ACL, 0,
                this.storedKeys[bucketName][sizeIdx].length,
                null, true);
            key = this.storedKeys[bucketName][sizeIdx][index];
        } else {
            if (this.noKeyFlag) {
                key = 'undefined';
            } else {
                process.nextTick(this.doNextAction.bind(this), GET_ACL, cb,
                                    threadIdx);
                return;
            }
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
                // stderr.write(`get ${object.Key} error: ${err}\n`);
            } else {
                this.latThread[GET_ACL][threadIdx] += time;
                this.updateStats(GET_ACL, time);
                if (this.nSuccesses[GET_ACL][sizeIdx] %
                        this.freqsToShow === 0) {
                    this.printStats(GET_ACL);
                }
            }
            process.nextTick(this.doNextAction.bind(this), GET_ACL, cb,
                                threadIdx);
        });
    }

    del(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
        const sizeIdx = this.currSizeIdx;
        let key;
        // if (this.getAnyKey) {
        //     key = this.getNextKey(DEL_OBJ, this.rDel[0], this.rDel[1]);
        // } else {
        if (this.storedKeys[bucketName][sizeIdx].length > this.fillObjs) {
            key = this.storedKeys[bucketName][sizeIdx].pop();
        } else {
            if (this.noKeyFlag) {
                key = 'undefined';
            } else {
                // if all objects are deleted, go next simul
                if (this.simulPolicy === simulEach) {
                    if (this.storedKeys.every(arrPerBkt =>
                        arrPerBkt.every(arrPerSize =>
                        arrPerSize.length <= this.fillObjs))) {
                        this.count = this.threshold;
                    }
                }
                process.nextTick(this.doNextAction.bind(this), DEL_OBJ, cb,
                                    threadIdx);
                return;
            }
        }
        // }

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
                this.latThread[DEL_OBJ][threadIdx] += time;
                this.updateStats(DEL_OBJ, time);
                if (this.nSuccesses[DEL_OBJ][sizeIdx] %
                        this.freqsToShow === 0) {
                    this.printStats(DEL_OBJ);
                }
            }
            process.nextTick(this.doNextAction.bind(this), DEL_OBJ, cb,
                                threadIdx);
        });
    }

    list(cb, threadIdx) {
        this.count++;
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
        const sizeIdx = this.currSizeIdx;

        function listCb(err, value, time) {
            if (err) {
                this.nFailures[LST_OBJ][sizeIdx]++;
                stderr.write(`list error: ${err}\n`);
                return cb(err);
            }
            if (this.simulPolicy === simulEach && this.count >= 1e3) {
                this.count = this.threshold;
            }
            this.latThread[LST_OBJ][threadIdx] += time;
            this.updateStats(LST_OBJ, time);
            if (this.nSuccesses[LST_OBJ][sizeIdx] %
                    this.freqsToShow === 0) {
                this.printStats(LST_OBJ);
            }
            return this.doNextAction(LST_OBJ, cb, threadIdx);
        }
        const prefix = this.prefixKey || `key_S${this.size}`;
        this.sendRates[LST_OBJ]++;
        this.listAllObjects(bucketName, listCb.bind(this), prefix, null, 0, 0);
    }

    /* put->get->del object */
    comb(cb, threadIdx) {
        this.count++;
        const key = this.getNextKey(COM_OBJ);
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
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
                    this.updateStats(DEL_OBJ, time);
                    this.updateStats(COM_OBJ, actionTime);
                    if (this.nSuccesses[COM_OBJ][sizeIdx] %
                            this.freqsToShow === 0) {
                        this.printStats(DEL_OBJ);
                        this.printStats(COM_OBJ);
                    }
                }
                process.nextTick(this.doNextAction.bind(this), DEL_OBJ, cb,
                                 threadIdx);
                return undefined;
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
                    this.updateStats(GET_OBJ, time);
                    if (this.nSuccesses[GET_OBJ][sizeIdx] %
                            this.freqsToShow === 0) {
                        this.printStats(GET_OBJ);
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
                this.updateStats(PUT_OBJ, time);
                if (this.nSuccesses[PUT_OBJ][sizeIdx] %
                        this.freqsToShow === 0) {
                    this.printStats(PUT_OBJ);
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
        const key = this.getNextKey(MPU_OBJ, this.rMpu[0], this.rMpu[1]);
        const bucketName =
            this.buckets[Math.floor(Math.random() * this.nBuckets)];
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
            for (let idx = 0; idx < Math.min(this.mpuThread, partsNb); idx++) {
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
                    this.storedKeys[bucketName][sizeIdx].push(key);
                    this.latThread[MPU_OBJ][threadIdx] += time;
                    this.updateStats(MPU_OBJ, time);
                    if (this.nSuccesses[MPU_OBJ][sizeIdx] %
                            this.freqsToShow === 0) {
                        this.printStats(MPU_OBJ);
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
                this.files.push(`${statsFolder}` +
                    `worker${idx}/${this.output}${this.threadExt}`);
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
        const threadIdx = this.rThreads.indexOf(thread);
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
        this.rThreads.forEach(thread => {
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
                this.rThreads.forEach(thread => {
                    this.perfs.forEach(perf => {
                        const avg = this.getData(req, size, thread, perf);
                        str += `${toFixedLength(avg, 10)}`;
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
            servers.forEach((server, idx) => {
                stdout.write(`${server}: ${mdSize[idx]}KB\n`);
                str += `# ${server}: ${mdSize[idx]}KB\n`;
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
        this.rThreads.forEach(thread => {
            this.sizes.forEach(size => {
                str += `${toFixedLength(thread, 12)}${toFixedLength(size, 10)}`;
                this.reqsToTest.forEach(req => {
                    this.perfs.forEach(perf => {
                        const avg = this.getData(req, size, thread, perf);
                        str += `${toFixedLength(avg, 10)}`;
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
S3Blaster.outputGraph = outputGraph;

/* ==== For Live Test running directly from this file ==== */
function mochaTest() {
    const Plotter = require('./plotter');
    describe('Measure performance', function Perf() {
        this.timeout(0);
        commander.version('0.0.1')
        .option('-h, --helps3')
        .parse(process.argv);
        if (commander.helps3) {
            helpS3blaster();
            return;
        }

        let nOkForPlot = false;

        const blaster = new S3Blaster();
        let plotter = undefined;
        before(done => {
            blaster.init(err => {
                if (err) {
                    nOkForPlot = true;
                    return done(err);
                }
                plotter = new Plotter();
                return done();
            });
        });

        it('run test', done => {
            blaster.doSimul(err => {
                if (err) {
                    nOkForPlot = true;
                }
                return done(err);
            });
        });

        afterEach(done => {
            blaster.updateDataFile(err => {
                if (err) {
                    nOkForPlot = true;
                }
                return done(err);
            });
        });

        after(done => {
            blaster.updateStatsFiles(err => {
                if (err) {
                    return done(err);
                }
                if (!nOkForPlot) {
                    return plotter.plotData(err => {
                        if (err) {
                            process.stdout.write(err);
                        }
                        blaster.clearDataSimul(err => {
                            if (err) {
                                return done(err);
                            }
                            return done();
                        });
                    });
                }
                return blaster.clearDataSimul(err => {
                    if (err) {
                        return done(err);
                    }
                    return done();
                });
            });
        });
    });
}

if (calledFileName === 's3blaster') {
    mochaTest();
}

S3Blaster.genCmd = function genCmd(cmdInit, params) {
    let cmd = cmdInit;
    if (params.servers) {
        cmd += `--servers ${params.servers} `;
    }
    if (params.user) {
        cmd += `--user ${params.user} `;
    }
    if (params.pubKey) {
        cmd += `--pub-key ${params.pubKey} `;
    }
    if (params.pubKey) {
        cmd += `--prv-key ${params.pubKey} `;
    }
    if (params.accFile) {
        cmd += `--acc-file ${params.accFile} `;
    }
    if (params.passphrase) {
        cmd += `--passphrase ${params.passphrase} `;
    }
    if (params.password) {
        cmd += `--password ${params.password} `;
    }
    if (params.host) {
        cmd += `-H ${params.host} `;
    }
    if (params.port) {
        cmd += `-P ${params.port} `;
    }
    if (params.forksNb) {
        cmd += `--n-forks ${params.forksNb} `;
    }
    if (params.bucketsNb) {
        cmd += `--n-buckets ${params.bucketsNb} `;
    }
    if (params.bucketPrefix) {
        cmd += `--bucket-prefix ${params.bucketPrefix} `;
    }
    if (params.objectsNb) {
        cmd += `--n-objs ${params.objectsNb} `;
    }
    if (params.fillObjs !== undefined) {
        cmd += `--fill-objs ${params.fillObjs} `;
    }
    if (params.sizes) {
        cmd += `--sizes ${params.sizes} `;
    }
    if (params.unit) {
        cmd += `--unit ${params.unit} `;
    }
    if (params.objMetadata) {
        cmd += `--obj-metadata ${params.objMetadata} `;
    }
    if (params.mdPath) {
        cmd += `--md-path '${params.mdPath}' `;
    }
    if (params.partSizes) {
        cmd += `--part-sizes ${params.partSizes} `;
    }
    if (params.requests) {
        cmd += `--requests ${params.requests} `;
    }
    if (params.proprReqs) {
        cmd += `--propr-reqs ${params.proprReqs} `;
    }
    if (params.range) {
        cmd += `--range ${params.range} `;
    }
    if (params.rPut) {
        cmd += `--r-put ${params.rPut} `;
    }
    if (params.rGet) {
        cmd += `--r-get ${params.rGet} `;
    }
    if (params.rGetAcl) {
        cmd += `--r-getacl ${params.rGetAcl} `;
    }
    if (params.rDel) {
        cmd += `--r-del ${params.rDel} `;
    }
    if (params.rMpu) {
        cmd += `--r-mpu ${params.rMpu} `;
    }
    if (params.schedule) {
        cmd += `--simul ${params.schedule} `;
    }
    if (params.simulDelay) {
        cmd += `--simul-delay ${params.simulDelay} `;
    }
    if (params.nextKey) {
        cmd += `--next-key ${params.nextKey} `;
    }
    if (params.paralReqs) {
        cmd += `--paral-reqs ${params.paralReqs} `;
    }
    if (params.mpuParalReqs) {
        cmd += `--mpu-paralreqs ${params.mpuParalReqs} `;
    }
    if (params.sendReqRates) {
        cmd += `--req-rates ${params.sendReqRates} `;
    }
    if (params.observationsNb) {
        cmd += `--n-obsers ${params.observationsNb} `;
    }
    if (params.noKeyFlag) {
        cmd += `--ok-nokey ${params.noKeyFlag} `;
    }
    if (params.freqShow) {
        cmd += `--freq-show ${params.freqShow} `;
    }
    if (params.samplingStep) {
        cmd += `--sampling-step ${params.samplingStep} `;
    }
    if (params.percentiles) {
        cmd += `--percentiles ${params.percentiles} `;
    }
    if (params.dontCleanDB !== undefined) {
        cmd += `--dontCleanDB ${params.dontCleanDB} `;
    }
    if (params.runTime) {
        cmd += `--run-time ${params.runTime} `;
    }
    if (params.liveGlobal !== undefined) {
        cmd += `--live-global ${params.liveGlobal} `;
    }
    if (params.rate) {
        cmd += `--rate ${params.rate} `;
    }
    if (params.statsFolder) {
        cmd += `--stats-folder ${params.statsFolder} `;
    }
    if (params.output) {
        cmd += `--output ${params.output} `;
    }
    if (params.message) {
        cmd += `--message '${params.message}' `;
    }
    if (params.fitPlot) {
        cmd += `--fit-plot ${params.fitPlot} `;
    }
    if (params.outputType) {
        cmd += `--output-type '${params.outputType}' `;
    }
    if (params.ssm !== undefined) {
        cmd += `--ssm ${params.ssm} `;
    }
    if (params.displaySSM !== undefined) {
        cmd += `--display-ssm ${params.displaySSM} `;
    }
    if (params.resConsMonitor !== undefined) {
        cmd += `--res-consMonitor ${params.resConsMonitor} `;
    }
    if (params.getAnyKey !== undefined) {
        cmd += `--get-anyKey ${params.getAnyKey} `;
    }
    if (params.prefixKey !== undefined) {
        cmd += `--prefix-key ${params.prefixKey} `;
    }
    if (params.help) {
        cmd += '-h ';
    }
    return cmd;
};

S3Blaster.runS3Blaster = function runS3Blaster(cmd, done) {
    stdout.write(`Launch s3blaster: ${cmd}\n`);
    const s3blaster = spawn('bash', ['-c', cmd]);
    s3blaster.on('exit', err => {
        if (err) {
            stderr.write(`${err}\n`);
        }
        return done(err);
    });

    s3blaster.on('error', err => {
        if (err) {
            stderr.write(`${err}\n`);
        }
        return done(err);
    });

    s3blaster.stderr.on('data', data => {
        if (data) {
            stderr.write(`${data}`);
        }
    });

    s3blaster.stdout.on('data', data => {
        if (data) {
            stdout.write(`${data}`);
        }
    });
};
