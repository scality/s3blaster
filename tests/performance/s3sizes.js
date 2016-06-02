'use strict'; // eslint-disable-line strict

const runS3Blaster = require('../../lib/s3blaster').runS3Blaster;
const genCmd = require('../../lib/s3blaster').genCmd;

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';
const params = {
    forksNb: 0,
    bucketsNb: 1,
    bucketPrefix: 'bucketscality',
    objectsNb: 2000,
    fillObjs: 0,
    sizes: [0, 10, 50, 60, 70, 100, 110, 120, 130, 140, 150],
    unit: 'KB',
    requests: 'put,get,delete',
    proprReqs: [1, 1, 1],       // proportion of requests
    range: ['all', 'all', 'all'],
    schedule: 'each',
    nextKey: 'seq',
    paralReqs: [1],
    sendReqRates: ['max', 'max', 'max'],
    observationsNb: 1000000,
    freqShow: 1000,
    samplingStep: 1,
    percentiles: [60, 80, 90, 95, 99, 100],
    runTime: 10,
    ssm: true,
    liveGlobal: true,
    rate: 1000,
    getAnyKey: false,
    statsFolder: 'stats',
    output: 'output',
    message: 'Measurement specified for different object sizes',
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
        params.statsFolder = `${folder}/sizes_0fork/allSingle`;
        params.message = 'S3 branch: rel/1.1,\\n';
    });

    it('Sequential run', done => {
        params.schedule = 'each';
        // params.fillObjs = params.objectsNb;
        params.output = 'putgetdel_seq';
        const cmd = genCmd(cmdInit, params);
        process.nextTick(runS3Blaster, cmd, done);
    });

    // it('Mixed run', done => {
    //     params.schedule = 'mixed';
    //     params.fillObjs = params.objectsNb;
    //     params.output = 'putgetdel_mixed';
    //     const cmd = genCmd(cmdInit, params);
    //     process.nextTick(runS3Blaster, cmd, done);
    // });
});

// describe('Single connector, multiple buckets, put+get+delete', function fn() {
//     this.timeout(0);
//
//     before(() => {
//         params.bucketsNb = 10;
//         params.statsFolder = `${folder}/sizes/multBkts`;
//     });
//
//     it('Sequential run', done => {
//         params.schedule = 'each';
//         params.fillObjs = 0;
//         params.output = 'putgetdel_seq';
//         const cmd = genCmd(cmdInit, params);
//         process.nextTick(runS3Blaster, cmd, done);
//     });
//
//     it('Mixed run', done => {
//         params.schedule = 'mixed';
//         params.fillObjs = params.objectsNb;
//         params.output = 'putgetdel_mixed';
//         const cmd = genCmd(cmdInit, params);
//         process.nextTick(runS3Blaster, cmd, done);
//     });
// });
