'use strict'; // eslint-disable-line strict

const genCmd = require('../../lib/s3blaster').genCmd;
const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 0,
    bucketsNb: 1,
    bucketPrefix: 'bucket11may',
    objectsNb: 2000,
    fillObjs: 2000,
    sizes: [0, 1],
    unit: 'KB',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['0:1000', '1000:2000', '0:1000'],
    sendReqRates: ['max', 'max', 'max'],
    paralReqs: [1, 10, 64, 128, 256, 512],
    schedule: 'each',
    nextKey: 'rand',
    observationsNb: 1000000,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    runTime: 10,
    dontCleanDB: true,
    ssm: true,
    liveGlobal: false,
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

describe('Single connector, single bucket, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.requests = 'put,get,delete';
        params.statsFolder = `${folder}/simple/allSingle`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.schedule = 'mixed';
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});

describe('Single connector, multiple buckets, put+get+delete', function fn() {
    this.timeout(0);

    before(() => {
        params.bucketsNb = 10;
        params.fillObjs = params.objectsNb;
        params.statsFolder = `${folder}/simple/multBkts`;
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    it('Mixed run', done => {
        params.fillObjs = 0;
        params.schedule = 'mixed';
        params.output = 'putgetdel_mixed';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });
});
