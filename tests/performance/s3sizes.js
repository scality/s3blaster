'use strict'; // eslint-disable-line strict

/*
 * The file contains multiple scenarios for measuring performance of S3
 * specifying on different object sizes
 * Main purpose of these measurements is to observe the impact of object sizes
 * on performance.
 * - Connector: only single connector (S3) is measured.
 * - Buckets: single, multiple
 * - Simulation schedule: sequential, mixed
 *  a. Sequential simulaton: at a time, a type of request with a single
        combination of (number of parallel requests, object size) is executed.
 *  b. Mixed simulation: all types of requests with different object sizes are
 *      executed in parallel. Each execution runs for a number of parallel
 *      requests.
 */

const runS3Blaster = require('../../lib/runS3Blaster');

function createArray(min, step, max) {
    const arr = [];
    let val = min;
    while (val <= max) {
        arr.push(val);
        val += step;
    }
    return arr;
}

const sizes = createArray(1, 10, 90).concat(createArray(100, 100, 900))
                .concat(createArray(1024, 1024, 10240));

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'buckets3size',
    objectsNb: 1e6,
    fillObjs: 0,
    sizes,
    unit: 'KB',
    objMetadata: 'full',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    schedule: 'each',
    simulDelay: 10,
    nextKey: 'rand',
    paralReqs,
    sendReqRates: ['max', 'max', 'max'],
    observationsNb: 1e6,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    // run time for each: object size, #parallel requests and each request for
    //  'schedule=each'
    runTime: 600,
    dontCleanDB: true,
    ssm: true,
    displaySSM: true,
    liveGlobal: true,
    rate: 1000,
    statsFolder: 'stats',
    output: 'output',
    message: 'S3 branch: branch of S3,\\n',
};

let folder;
if (process.env.FOLDERNAME) {
    folder = `${process.env.FOLDERNAME}`;
} else {
    folder = (new Date()).toDateString().replace(/\s/g, '_');
}

describe('Single connector, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/s3sizes/conn1_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Single connector, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3sizes/conn1_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/*
        For mixed simulation
 */
describe('Prepare for mixed simulation', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 1;
        params.statsFolder = `${folder}/s3sizes/prepare`;
        params.bucketsNb = maxBktsNb;
        params.paralReqs = [128];
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.requests = 'put',
        params.observationsNb = 1;
    });

    it('Fill objects', done => {
        params.output = 'fillObjs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Single connector, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 1;
        params.statsFolder = `${folder}/s3sizes/conn1_bkt${params.bucketsNb}`;
        params.requests = 'put,get,delete';
        params.proprReqs = [5, 20, 3];       // proportion of requests
        params.fillObjs = 0;
        params.observationsNb = 1e6;
        params.paralReqs = paralReqs;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Single connector, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3sizes/conn1_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
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
        params.statsFolder = `${folder}/s3sizes/clean`;
        params.paralReqs = [128];
        params.dontCleanDB = false;
        params.schedule = 'each';
        params.fillObjs = 0;
        params.requests = 'delete',
        params.observationsNb = 1;
    });

    it('Clean databases', done => {
        params.output = 'cleanDB_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});
