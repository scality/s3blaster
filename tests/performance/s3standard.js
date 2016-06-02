'use strict'; // eslint-disable-line strict

const genCmd = require('../../lib/s3blaster').genCmd;
const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;

function createArray(min, step, max) {
    const arr = [];
    let val = min;
    while (val <= max) {
        arr.push(val);
        val += step;
    }
    return arr;
}

const paralResTest = [32, 64, 128, 256, 512];
const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'bktstd',
    objectsNb: 1e6,
    fillObjs: 0,
    sizes: [0],
    unit: 'KB',
    objMetadata: 'full',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    sendReqRates: ['max', 'max', 'max'],
    paralReqs: createArray(1, 1, 10),
    schedule: 'each',
    simulDelay: 3,
    nextKey: 'rand',
    observationsNb: 1e6,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    runTime: 10,
    dontCleanDB: true,
    ssm: true,
    resConsMonitor: false,
    displaySSM: true,
    liveGlobal: true,
    rate: 1000,
    statsFolder: 'stats',
    output: 'output',
    message: 'S3 branch: GA1-beta4-pl2, 8 workers,\\n' +
             'Sproxyd: tengine,\\n' +
             'Object MD: full',
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
        params.statsFolder = `${folder}/lowestLatency`;
        params.forksNb = 1;
        params.paralReqs = [1];
        params.nextKey = 'seq';
    });

    it('Put, get, then delete', done => {
        params.output = 'allSingle_PGD_Size0B_Paral1';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/* Find max #operations/s */
describe('Single connector, single bucket, max ops/s', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/maxOps`;
        params.forksNb = 2;
        params.paralReqs = paralResTest;
        params.bucketsNb = 1;
        params.port = 8000;
        params.host = 'single';
    });

    it('Put, then get', done => {
        params.output = 'allSingle_PGD_Size0B_Paral1';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/*
describe('Multiple connectors & buckets, max ops/s', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/maxOps`;
        params.forksNb = 2;
        params.paralReqs = paralResTest;
        params.nextKey = 'seq';
        params.bucketsNb = 100;
        params.port = 88;
        params.host = 'localhost';
    });

    it('Put, get, then delete', done => {
        params.output = 'haproxy_PGD_Size0B_Paral1';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});
*/
/* Find throughput */
describe('Single connector, single bucket, throughput', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/throughput`;
        params.requests = 'put,get';
        params.sizes = [1];
        params.unit = 'MB';
        params.forksNb = 2;
        params.paralReqs = paralResTest;
        params.bucketsNb = 1;
        params.port = 8000;
        params.host = 'single';
    });

    it('Put, then get', done => {
        params.output = 'allSingle_PGD_Size0B_Paral1';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

// describe('Multiple connectors & buckets, throughput', function fn() {
//     this.timeout(0);
//
//     before(() => {
//         params.statsFolder = `${folder}/throughput`;
//         params.forksNb = 2;
//         params.paralReqs = paralResTest;
//         params.nextKey = 'seq';
//         params.bucketsNb = 100;
//         params.port = 88;
//         params.host = 'localhost';
//     });
//
//     it('Put, get, then delete', done => {
//         params.output = 'haproxy_PGD_Size0B_Paral1';
//         const cmd = genCmd(cmdInit, params);
//         process.nextTick(runS3Blaster, cmd, done);
//     });
// });
