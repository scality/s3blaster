'use strict'; // eslint-disable-line strict

/*
 * The file contains multiple scenarios for measuring performance of S3
 * These scenarios are divided by number of connectors and number of buckets
 * 1. Connectors: single, multiple via proxy, multiple via balancing
 * 2. Buckets: single, multiple
 * A scenario is a combination of the two parameters. Moreover, in each
 *  scenario, there are two use-cases:
 *  a. Sequential simulaton: at a time, a type of request with a single
        combination of (number of parallel requests, object size) is executed.
 *  b. Mixed simulation: all types of requests with different object sizes are
 *      executed in parallel. Each execution runs for a number of parallel
 *      requests.
 */

const numCPUs = require('os').cpus().length;

const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;
const genCmd = require('../../lib/s3blaster').genCmd;

const numWorkers = numCPUs;
// params.paralReqs is an array of numbers of parallel requests sent from each
// worker. Hence, if there are multiple workers, total numbers of parallel
// requests are equal such numbers multipled with number of workers
const totalParalReqs = [1, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
const paralReqs = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / numWorkers)));

const proxyBackendsNb = 5;
const paralReqsProxy = totalParalReqs.map(num =>
                    Math.max(1, Math.floor(num / proxyBackendsNb)));

const maxBktsNb = 30;
const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';

const proxy = {
    host: 'proxy_address',
    port: 'proxy_port',
};

const params = {
    forksNb: 1,
    bucketsNb: 1,
    bucketPrefix: 'buckets3full',
    objectsNb: 1e6,
    fillObjs: 0,
    sizes: [0, 10, 512, 1024, 10240],
    unit: 'KB',
    objMetadata: 'full',
    requests: 'put,list,get,get-acl,delete,combine',
    proprReqs: [1, 1, 1, 1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all', 'all', 'all', 'all'],
    schedule: 'each',
    simulDelay: 3,
    nextKey: 'rand',
    paralReqs,
    sendReqRates: ['max', 'max', 'max', 'max', 'max', 'max'],
    observationsNb: 1e6,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    // run time for each: object size, #parallel requests and each request for
    //  'schedule=each'
    runTime: 200,
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
        params.statsFolder = `${folder}/s3full/conn1_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3full/conn1_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
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
            `${folder}/s3full/connProxy_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Multiple connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3full/connProxy_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
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
            `${folder}/s3full/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Balancing connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3full/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Sequential run', done => {
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/*
        For mixed simulation
 */
describe('Prepare for mixed simulation', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 1;
        params.statsFolder = `${folder}/s3full/prepare`;
        params.bucketsNb = maxBktsNb;
        params.paralReqs = [128];
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.requests = 'put',
        params.observationsNb = 1;
    });

    it('Fill objects', done => {
        params.output = 'fillObjs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 1;
        params.statsFolder = `${folder}/s3full/conn1_bkt${params.bucketsNb}`;
        params.requests = 'put,list,get,get-acl,delete';
        params.proprReqs = [5, 1, 20, 2, 3];       // proportion of requests
        params.fillObjs = 0;
        params.observationsNb = 1e6;
        params.paralReqs = paralReqs;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder = `${folder}/s3full/conn1_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/* Multiple connectors: s3blaster sends requests to Proxy that spreads
 * requests to all other servers */
describe('Multiple connectors via proxy, single bucket', function fn() {
    this.timeout(0);

    before(() => {
        params.host = proxy.host;
        params.port = proxy.port;
        params.paralReqs = paralReqsProxy;
        params.bucketsNb = 1;
        params.statsFolder =
            `${folder}/s3full/connProxy_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Multiple connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3full/connProxy_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/* Balacing connectors: each fork sends requests to only one server */
describe('Balancing connectors, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.host = 'balancing';
        params.port = 8000;
        params.forksNb = numWorkers;
        params.bucketsNb = 1;
        params.paralReqs = paralReqs;
        params.statsFolder =
            `${folder}/s3full/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Balancing connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = maxBktsNb;
        params.statsFolder =
            `${folder}/s3full/connBalancing_bkt${params.bucketsNb}`;
    });

    it('Mixed run', done => {
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/*
 * Clean databases
 */
describe('Clean databases of simulation', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 1;
        params.statsFolder = `${folder}/s3full/clean`;
        params.bucketsNb = maxBktsNb;
        params.paralReqs = [128];
        params.dontCleanDB = false;
        params.schedule = 'each';
        params.fillObjs = 0;
        params.requests = 'delete',
        params.observationsNb = 1;
    });

    it('Clean databases', done => {
        params.output = 'cleanDB_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});
