'use strict'; // eslint-disable-line strict

const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;
const genCmd = require('../../lib/s3blaster').genCmd;

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 0,
    bucketsNb: 1,
    bucketPrefix: 'bucket21apr',
    objectsNb: 100,
    fillObjs: 0,
    sizes: [0, 8, 40, 100, 512, 1024, 10240],
    unit: 'KB',
    requests: 'put,list,get,get-acl,delete,combine',
    proprReqs: [1, 1, 1, 1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all', 'all', 'all', 'all'],
    schedule: 'mixed',
    nextKey: 'rand',
    paralReqs: [1, 10, 50, 100, 200],
    sendReqRates: [500, 500, 500, 500, 500, 500],
    observationsNb: 1000000,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    // run time for each: object size, #parallel requests and each request for
    //  'schedule=each'
    runTime: 200,
    ssm: true,
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
        params.requests = 'put,list,get,get-acl,delete';
        params.statsFolder = `${folder}/standard/allSingle`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 10;
        params.statsFolder = `${folder}/standard/multBkts`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

/* Multiple connectors: s3blaster sends requests to Haproxy that spreads
 * requests to all other servers */
describe('Multiple connectors, single bucket, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.port = 80;
        params.bucketsNb = 1;
        params.statsFolder = `${folder}/standard/multConns`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Multiple connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 10;
        params.statsFolder = `${folder}/standard/multConnsBkts`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
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
        // To have exactly number of parallel requests as previous tests
        params.forksNb = 5;
        params.paralReqs = 10;
        params.port = 8000;
        params.bucketsNb = 1;
        params.statsFolder = `${folder}/standard/balancing`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Balancing connectors, multiple buckets, all requests', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 10;
        params.statsFolder = `${folder}/standard/balancingMultBkts`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'allReqs_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'allReqs_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});
