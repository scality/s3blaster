'use strict'; // eslint-disable-line strict

/*
 * The file contains multiple scenarios for measuring performance of S3
 * 1. Lowest latency
 * 2. Max number of operations/s
 * 3. Max throughput
 * The first metric is measured for single connector & bucket scenario.
 * The last two ones are measured for single and multiple connector & bucket
 *  scenario.
 * Only sequential simulation is executed, i.e. at a time, a type of request
 *  with a single combination of (number of parallel requests, object size) is
 *  executed.
 */

const numCPUs = require('os').cpus().length;

const runS3Blaster = require('../../lib/runS3Blaster');

const numWorkers = Math.min(numCPUs, 8);
const S3Port = 8000;

function createArray(min, step, max) {
    const arr = [];
    let val = min;
    while (val <= max) {
        arr.push(val);
        val += step;
    }
    return arr;
}

// params.paralReqs is an array of numbers of parallel requests sent from each
// worker. Hence, if there are multiple workers, total numbers of parallel
// requests are equal such numbers multipled with number of workers
const totalParalReqs = [32, 64, 128, 256, 512, 1024, 2048];
const paralReqs = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / numWorkers)));

const maxBktsNb = 30;

const params = {
    port: S3Port,
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'bkts3std',
    objectsNb: 1e6,
    fillObjs: false,
    sizes: [0, 10],
    unit: 'KB',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    paralReqs: createArray(1, 1, 10),
    schedule: 'each',
    simulDelay: 3,
    nextKey: 'rand',
    observationsNb: 1e6,
    workOnCurrObjs: true,
    runTime: 120,
    dontCleanDB: true,
    ssm: true,
    displaySSM: false,
    liveGlobal: true,
    statsFolder: 'stats',
    output: 's3standard',
    message: 'S3 branch: abc,\\n' +
             'Sproxyd: abc',
};

let folder;
if (process.env.FOLDERNAME) {
    folder = `${process.env.FOLDERNAME}`;
} else {
    folder = (new Date()).toDateString().replace(/\s/g, '_');
}

/* Find lowest latency */
describe('Single connector, single bucket, lowest latency', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/s3standard/lowestLatency`;
        params.forksNb = 1;
        params.paralReqs = [1];
        params.nextKey = 'seq';
    });

    it('Put, get, then delete', done => {
        params.output = 'lowestLatency_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/* Find max #operations/s */
describe('Single connector, single bucket, max ops/s', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/s3standard/maxOps`;
        params.forksNb = numWorkers;
        params.paralReqs = paralReqs;
        params.bucketsNb = 1;
        params.port = S3Port;
        params.host = 'single';
    });

    it('Put, then get', done => {
        params.output = 'allSingle_maxOps_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Multiple connectors & buckets, max ops/s', function fn() {
    this.timeout(0);

    before(() => {
        params.host = 'balancing';
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3standard/maxOps`;
        params.forksNb = numWorkers;
        params.paralReqs = paralReqs;
        params.nextKey = 'seq';
    });

    it('Put, get, then delete', done => {
        params.output = `bkt${params.bucketsNb}_maxOps_seq`;
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/* Find throughput */
describe('Single connector, single bucket, throughput', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/s3standard/throughput`;
        params.requests = 'put,get';
        params.sizes = [1];
        params.unit = 'MB';
        params.forksNb = numWorkers;
        params.paralReqs = paralReqs;
        params.bucketsNb = 1;
        params.port = S3Port;
        params.host = 'single';
    });

    it('Put, then get', done => {
        params.output = 'allSingle_throughput_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Multiple connectors & buckets, throughput', function fn() {
    this.timeout(0);

    before(() => {
        params.host = 'balancing';
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3standard/throughput`;
        params.forksNb = numWorkers;
        params.paralReqs = paralReqs;
        params.nextKey = 'seq';
    });

    it('Put, get, then delete', done => {
        params.output = `bkt${params.bucketsNb}_throughput_seq`;
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/*
 * Clean databases
 */
describe('Clean databases of simulation', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 1;
        params.statsFolder = `${folder}/s3standard/clean`;
        params.paralReqs = [128];
        params.dontCleanDB = false;
        params.schedule = 'each';
        params.fillObjs = 0;
        params.requests = 'delete';
        params.observationsNb = 1;
    });

    it('Clean databases', done => {
        params.output = 'cleanDB_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});
