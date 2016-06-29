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

const runS3Blaster = require('../../lib/runS3Blaster');

const maxBktsNb = 30;

const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'buckets3simple',
    objectsNb: 2000,
    fillObjs: false,
    sizes: [0, 10],
    unit: 'KB',
    requests: 'put,get,delete',
    schedule: 'each',
    simulDelay: 3,
    nextKey: 'rand',
    paralReqs: [64],
    observationsNb: 1e6,
    workOnCurrObjs: true,
    freqShow: 1000,
    runTime: 60,
    dontCleanDB: true,
    ssm: false,
    output: 's3simple',
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
        params.schedule = 'mixed';
        params.requests = 'get';
        params.range = ['1000:2000'];
        params.fillObjs = true;
        params.fillRange = '500:1000';
        params.fillThreads = 64;
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
        params.range = ['0:1000', '1000:2000', '0:1000'];
        params.proprReqs = [5, 20, 3];       // proportion of requests
        params.fillObjs = false;
        params.observationsNb = 1e6;
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
        params.requests = 'delete';
        params.observationsNb = 1;
    });

    it('Clean databases', done => {
        params.output = 'cleanDB_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});
