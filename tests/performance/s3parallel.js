'use strict'; // eslint-disable-line strict

/*
 * The file contains multiple scenarios for measuring performance of S3
 * specifying on different number of parallel requests.
 * Main purpose of these measurements is to estimate maximal number of
 *  operations/s, or throughput equivalently.
 * These scenarios are divided by number of connectors and number of buckets
 * 1. Connectors: single, multiple via proxy, multiple via balancing
 * 2. Buckets: single, multiple
 * Only sequential simulation is executed, i.e. at a time, a type of request
 *  with a single combination of (number of parallel requests, object size) is
 *  executed.
 */

const numCPUs = require('os').cpus().length;

const runS3Blaster = require('../../lib/runS3Blaster');

const numWorkers = Math.min(numCPUs, 8);
// params.paralReqs is an array of numbers of parallel requests sent from each
// worker. Hence, if there are multiple workers, total numbers of parallel
// requests are equal such numbers multipled with number of workers
const totalParalReqs = [32, 64, 128, 256, 512, 1024, 2048, 10240];
const paralReqs = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / numWorkers)));

const proxyBackendsNb = 5;
const paralReqsProxy = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / proxyBackendsNb)));

const maxBktsNb = 30;

const proxy = {
    host: 'localhost',
    port: 80,
};

const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'buckets3parallel',
    objectsNb: 1e6,
    fillObjs: false,
    sizes: [0, 10, 1024],
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
    runTime: 600,
    dontCleanDB: true,
    ssm: true,
    displaySSM: true,
    liveGlobal: true,
    rate: 1000,
    output: 's3parallel',
    message: 'S3 branch: branch of S3,\\n' +
             'MD branch: branch of MD,\\n' +
             'Vault branch: branch of Vault',
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
        params.statsFolder =
            `${folder}/s3parallel/conn1_bkt${params.bucketsNb}`;
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
        params.statsFolder =
            `${folder}/s3parallel/conn1_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/* Multiple connectors: s3blaster sends requests to Proxy that spreads
 * requests to all other servers */
describe('Multiple connectors via proxy, single bucket', function fn() {
    this.timeout(0);

    before(() => {
        params.host = proxy.host;
        params.port = proxy.port;
        params.bucketsNb = 1;
        params.paralReqs = paralReqsProxy;
        params.statsFolder =
            `${folder}/s3parallel/connProxy_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Multiple connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3parallel/connProxy_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

/* Balacing connectors: each fork sends requests to only one server */
describe('Balancing connectors, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.host = 'balancing';
        params.port = 8000;
        params.forksNb = numWorkers;
        params.paralReqs = paralReqs;
        params.bucketsNb = 1;
        params.statsFolder =
            `${folder}/s3parallel/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        process.nextTick(runS3Blaster.start, params, done);
    });
});

describe('Balancing connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3parallel/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
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
        params.statsFolder = `${folder}/s3parallel/clean`;
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
