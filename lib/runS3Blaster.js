'use strict'; // eslint-disable-line strict

const stderr = process.stderr;
const stdout = process.stdout;
const spawn = require('child_process').spawn;

const cmdInit = 'node_modules/.bin/mocha lib/s3blaster.js ';

function genCmd(params) {
    let cmd = cmdInit;
    if (params.servers) {
        cmd += `--servers ${params.servers} `;
    }
    if (params.user) {
        cmd += `--user ${params.user} `;
    }
    if (params.pubKey) {
        cmd += `--pub-key ${params.pubKey} `;
    }
    if (params.pubKey) {
        cmd += `--prv-key ${params.pubKey} `;
    }
    if (params.accFile) {
        cmd += `--acc-file ${params.accFile} `;
    }
    if (params.passphrase) {
        cmd += `--passphrase ${params.passphrase} `;
    }
    if (params.password) {
        cmd += `--password ${params.password} `;
    }
    if (params.host) {
        cmd += `-H ${params.host} `;
    }
    if (params.port) {
        cmd += `-P ${params.port} `;
    }
    if (params.forksNb) {
        cmd += `--n-forks ${params.forksNb} `;
    }
    if (params.bucketsNb) {
        cmd += `--n-buckets ${params.bucketsNb} `;
    }
    if (params.bucketPrefix) {
        cmd += `--bucket-prefix ${params.bucketPrefix} `;
    }
    if (params.objectsNb) {
        cmd += `--n-objs ${params.objectsNb} `;
    }
    if (params.fillObjs !== undefined) {
        cmd += `--fill-objs ${params.fillObjs} `;
    }
    if (params.sizes) {
        cmd += `--sizes ${params.sizes} `;
    }
    if (params.unit) {
        cmd += `--unit ${params.unit} `;
    }
    if (params.objMetadata) {
        cmd += `--obj-metadata ${params.objMetadata} `;
    }
    if (params.mdPath) {
        cmd += `--md-path '${params.mdPath}' `;
    }
    if (params.partSizes) {
        cmd += `--part-sizes ${params.partSizes} `;
    }
    if (params.requests) {
        cmd += `--requests ${params.requests} `;
    }
    if (params.proprReqs) {
        cmd += `--propr-reqs ${params.proprReqs} `;
    }
    if (params.range) {
        cmd += `--range ${params.range} `;
    }
    if (params.rPut) {
        cmd += `--r-put ${params.rPut} `;
    }
    if (params.rGet) {
        cmd += `--r-get ${params.rGet} `;
    }
    if (params.rGetAcl) {
        cmd += `--r-getacl ${params.rGetAcl} `;
    }
    if (params.rDel) {
        cmd += `--r-del ${params.rDel} `;
    }
    if (params.rMpu) {
        cmd += `--r-mpu ${params.rMpu} `;
    }
    if (params.schedule) {
        cmd += `--simul ${params.schedule} `;
    }
    if (params.simulDelay) {
        cmd += `--simul-delay ${params.simulDelay} `;
    }
    if (params.nextKey) {
        cmd += `--next-key ${params.nextKey} `;
    }
    if (params.paralReqs) {
        cmd += `--paral-reqs ${params.paralReqs} `;
    }
    if (params.mpuParalReqs) {
        cmd += `--mpu-paralreqs ${params.mpuParalReqs} `;
    }
    if (params.sendReqRates) {
        cmd += `--req-rates ${params.sendReqRates} `;
    }
    if (params.observationsNb) {
        cmd += `--n-obsers ${params.observationsNb} `;
    }
    if (params.noKeyFlag) {
        cmd += `--ok-nokey ${params.noKeyFlag} `;
    }
    if (params.freqShow) {
        cmd += `--freq-show ${params.freqShow} `;
    }
    if (params.samplingStep) {
        cmd += `--sampling-step ${params.samplingStep} `;
    }
    if (params.percentiles) {
        cmd += `--percentiles ${params.percentiles} `;
    }
    if (params.dontCleanDB !== undefined) {
        cmd += `--dontCleanDB ${params.dontCleanDB} `;
    }
    if (params.runTime) {
        cmd += `--run-time ${params.runTime} `;
    }
    if (params.liveGlobal !== undefined) {
        cmd += `--live-global ${params.liveGlobal} `;
    }
    if (params.rate) {
        cmd += `--rate ${params.rate} `;
    }
    if (params.statsFolder) {
        cmd += `--stats-folder ${params.statsFolder} `;
    }
    if (params.output) {
        cmd += `--output ${params.output} `;
    }
    if (params.message) {
        cmd += `--message '${params.message}' `;
    }
    if (params.fitPlot) {
        cmd += `--fit-plot ${params.fitPlot} `;
    }
    if (params.outputType) {
        cmd += `--output-type '${params.outputType}' `;
    }
    if (params.ssm !== undefined) {
        cmd += `--ssm ${params.ssm} `;
    }
    if (params.displaySSM !== undefined) {
        cmd += `--display-ssm ${params.displaySSM} `;
    }
    if (params.resConsMonitor !== undefined) {
        cmd += `--res-consMonitor ${params.resConsMonitor} `;
    }
    if (params.getAnyKey !== undefined) {
        cmd += `--get-anyKey ${params.getAnyKey} `;
    }
    if (params.prefixKey !== undefined) {
        cmd += `--prefix-key ${params.prefixKey} `;
    }
    if (params.help) {
        cmd += '-h ';
    }
    return cmd;
};

function start(params, done) {
    const cmd = genCmd(params);
    stdout.write(`Launch s3blaster: ${cmd}\n`);
    const s3blaster = spawn('bash', ['-c', cmd]);
    s3blaster.on('exit', err => {
        if (err) {
            stderr.write(`${err}\n`);
        }
        return done(err);
    });

    s3blaster.on('error', err => {
        if (err) {
            stderr.write(`${err}\n`);
        }
        return done(err);
    });

    s3blaster.stderr.on('data', data => {
        if (data) {
            stderr.write(`${data}`);
        }
    });

    s3blaster.stdout.on('data', data => {
        if (data) {
            stdout.write(`${data}`);
        }
    });
};

exports.start = start;
