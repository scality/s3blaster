'use strict'; // eslint-disable-line strict

const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;
const genCmd = require('../../lib/s3blaster').genCmd;

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 0,
    bucketsNb: 1,
    bucketPrefix: 'bucketscality',
    objectsNb: 1000,
    fillObjs: 0,
    sizes: [0, 10],
    unit: 'KB',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    schedule: 'each',
    nextKey: 'seq',
    paralReqs: [1, 30, 50, 64, 90, 128, 150, 200, 256, 300, 350, 400, 500],
    sendReqRates: [500, 500, 500, 500, 500, 500],
    observationsNb: 1000000,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    runTime: 20,
    ssm: true,
    liveGlobal: true,
    rate: 1000,
    statsFolder: 'stats',
    output: 'output',
    message: 'Measurement specified for different number of parallel requests',
};

let folder;
if (process.env.FOLDERNAME) {
    folder = `${process.env.FOLDERNAME}`;
} else {
    folder = (new Date()).toDateString().replace(/\s/g, '_');
}

describe('Single connector, single bucket, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.statsFolder = `${folder}/parallel/allSingle`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 10;
        params.statsFolder = `${folder}/parallel/multBkts`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector & bucket, forks 5, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 5;
        params.host = 'single';
        params.statsFolder = `${folder}/parallel/allSingleForks5`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, forks 5, put+get+delete',
    function fn() {
        this.timeout(0);

        before(() => {
            params.bucketsNb = 10;
            params.statsFolder = `${folder}/parallel/multBktsForks5`;
        });

        it('Sequential run', done => {
            params.schedule = 'each';
            params.fillObjs = 0;
            params.output = 'putgetdel_seq';
            const cmd = genCmd(cmdInit, params);
            process.nextTick(runS3Blaster, cmd, done);
        });

        it('Mixed run', done => {
            params.schedule = 'mixed';
            params.fillObjs = params.objectsNb;
            params.output = 'putgetdel_mixed';
            const cmd = genCmd(cmdInit, params);
            process.nextTick(runS3Blaster, cmd, done);
        });
    });

describe('Single connector & bucket, forks 10, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.forksNb = 10;
        params.statsFolder = `${folder}/parallel/allSingleForks10`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.fillObjs = 0;
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.fillObjs = params.objectsNb;
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, forks 10, put+get+delete',
    function fn() {
        this.timeout(0);

        before(() => {
            params.bucketsNb = 10;
            params.statsFolder = `${folder}/parallel/multBktsForks10`;
        });

        it('Sequential run', done => {
            params.schedule = 'each';
            params.fillObjs = 0;
            params.output = 'putgetdel_seq';
            const cmd = genCmd(cmdInit, params);
            process.nextTick(runS3Blaster, cmd, done);
        });

        it('Mixed run', done => {
            params.schedule = 'mixed';
            params.fillObjs = params.objectsNb;
            params.output = 'putgetdel_mixed';
            const cmd = genCmd(cmdInit, params);
            process.nextTick(runS3Blaster, cmd, done);
        });
    });
