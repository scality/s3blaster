'use strict'; // eslint-disable-line strict

/*
 * The file contains scenarios for briefly measuring performance of S3
 * - Connector: only single connector (S3) is measured.
 * - Buckets: single, multiple
 * - Simulation schedule: sequential, mixed
 *  a. Sequential simulaton: at a time, a type of request with a single
        combination of (number of parallel requests, object size) is executed.
 *  b. Mixed simulation: all types of requests with different object sizes are
 *      executed in parallel. Each execution runs for a number of parallel
 *      requests.
 */

const numCPUs = require('os').cpus().length;

const runS3Blaster = require('../../lib/runS3Blaster');

const numWorkers = Math.min(numCPUs, 8);
// params.paralReqs is an array of numbers of parallel requests sent from each
// worker. Hence, if there are multiple workers, total numbers of parallel
// requests are equal such numbers multipled with number of workers
const totalParalReqs = [1, 64, 256];
const paralReqs = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / numWorkers)));

const maxBktsNb = 30;

const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'buckets3simple',
    objectsNb: 1e6,
    fillObjs: 0,
    sizes: [0, 10],
    unit: 'KB',
    objMetadata: 'full',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    schedule: 'each',
    simulDelay: 3,
    nextKey: 'rand',
    paralReqs,
    sendReqRates: ['max', 'max', 'max'],
    observationsNb: 1e6,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    // run time for each: object size, #parallel requests and each request for
    //  'schedule=each'
    runTime: 100,
    dontCleanDB: true,
    ssm: true,
    displaySSM: true,
    liveGlobal: true,
    rate: 1000,
    statsFolder: 'stats',
    output: 'output',
    message: 'S3 branch: rel/1.1,\\n' +
             'Sproxyd: normal',
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
        params.statsFolder = `${folder}/s3simple/conn1_bkt${params.bucketsNb}`;
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
        params.statsFolder = `${folder}/s3simple/conn1_bkt${params.bucketsNb}`;
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
        params.statsFolder = `${folder}/s3simple/prepare`;
        params.bucketsNb = maxBktsNb;
        params.paralReqs = [128];
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.requests = 'put';
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
        params.statsFolder = `${folder}/s3simple/conn1_bkt${params.bucketsNb}`;
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
        params.statsFolder = `${folder}/s3simple/conn1_bkt${params.bucketsNb}`;
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
        params.statsFolder = `${folder}/s3simple/clean`;
        params.bucketsNb = maxBktsNb;
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
