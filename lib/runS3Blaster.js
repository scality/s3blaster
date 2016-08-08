'use strict'; // eslint-disable-line strict

const stderr = process.stderr;
const stdout = process.stdout;
const spawn = require('child_process').spawn;

const cmdInit = `node ${__dirname}/s3blaster.js `;

function genCmd(params) {
    let cmd = cmdInit;
    if (params.config) {
        cmd += `--config ${params.config} `;
    }
    if (params.accFile) {
        cmd += `--accFile ${params.accFile} `;
    }

    if (params.user) {
        cmd += `--user ${params.user} `;
    }
    if (params.publicKey) {
        cmd += `--publicKey ${params.publicKey} `;
    }
    if (params.privateKey) {
        cmd += `--privateKey ${params.privateKey} `;
    }
    if (params.password) {
        cmd += `--password ${params.password} `;
    }
    if (params.passphrase) {
        cmd += `--passphrase ${params.passphrase} `;
    }
    if (params.accessKeyId) {
        cmd += `--accessKeyId ${params.accessKeyId} `;
    }
    if (params.secretAccessKey) {
        cmd += `--secretAccessKey ${params.secretAccessKey} `;
    }

    if (params.host) {
        cmd += `--host ${params.host} `;
    }
    if (params.port) {
        cmd += `--port ${params.port} `;
    }
    if (params.forksNb) {
        cmd += `--forksNb ${params.forksNb} `;
    }
    if (params.servers) {
        cmd += `--servers ${params.servers} `;
    }
    if (params.signature) {
        cmd += `--signature ${params.signature} `;
    }

    if (params.bucketsNb) {
        cmd += `--bucketsNb ${params.bucketsNb} `;
    }
    if (params.bucketPrefix) {
        cmd += `--bucketPrefix ${params.bucketPrefix} `;
    }
    if (params.objectsNb) {
        cmd += `--objectsNb ${params.objectsNb} `;
    }
    if (params.fillObjs !== undefined) {
        cmd += `--fillObjs ${params.fillObjs} `;
    }
    if (params.fillRange !== undefined) {
        cmd += `--fillRange ${params.fillRange} `;
    }
    if (params.fillThreads) {
        cmd += `--fillThreads ${params.fillThreads} `;
    }
    if (params.sizes) {
        cmd += `--sizes ${params.sizes} `;
    }
    if (params.unit) {
        cmd += `--unit ${params.unit} `;
    }
    if (params.partSizes) {
        cmd += `--partSizes ${params.partSizes} `;
    }
    if (params.prefixKey !== undefined) {
        cmd += `--prefixKey ${params.prefixKey} `;
    }
    if (params.objMetadata) {
        cmd += `--objMetadata ${params.objMetadata} `;
    }
    if (params.mdPath) {
        cmd += `--mdPath '${params.mdPath}' `;
    }
    if (params.requests) {
        cmd += `--requests ${params.requests} `;
    }
    if (params.proprReqs) {
        cmd += `--proprReqs ${params.proprReqs} `;
    }
    if (params.range) {
        cmd += `--range ${params.range} `;
    }
    if (params.schedule) {
        cmd += `--schedule ${params.schedule} `;
    }
    if (params.simulDelay) {
        cmd += `--simulDelay ${params.simulDelay} `;
    }
    if (params.nextKey) {
        cmd += `--nextKey ${params.nextKey} `;
    }
    if (params.paralReqs) {
        cmd += `--paralReqs ${params.paralReqs} `;
    }
    if (params.mpuParalReqs) {
        cmd += `--mpuParalReqs ${params.mpuParalReqs} `;
    }
    if (params.sendReqRates) {
        cmd += `--sendReqRates ${params.sendReqRates} `;
    }
    if (params.observationsNb) {
        cmd += `--observationsNb ${params.observationsNb} `;
    }
    if (params.workOnCurrObjs !== undefined) {
        cmd += `--workOnCurrObjs ${params.workOnCurrObjs} `;
    }
    if (params.dontCleanDB !== undefined) {
        cmd += `--dontCleanDB ${params.dontCleanDB} `;
    }
    if (params.noKeyFlag) {
        cmd += `--noKeyFlag ${params.noKeyFlag} `;
    }
    if (params.freqShow) {
        cmd += `--freqShow ${params.freqShow} `;
    }
    if (params.samplingStep) {
        cmd += `--samplingStep ${params.samplingStep} `;
    }
    if (params.percentiles) {
        cmd += `--percentiles ${params.percentiles} `;
    }
    if (params.runTime) {
        cmd += `--runTime ${params.runTime} `;
    }
    if (params.ssm !== undefined) {
        cmd += `--ssm ${params.ssm} `;
    }
    if (params.liveGlobal !== undefined) {
        cmd += `--liveGlobal ${params.liveGlobal} `;
    }
    if (params.rate) {
        cmd += `--rate ${params.rate} `;
    }
    if (params.ssmTypes) {
        cmd += `--ssmTypes ${params.ssmTypes} `;
    }
    if (params.displaySSM !== undefined) {
        cmd += `--displaySSM ${params.displaySSM} `;
    }
    if (params.resConsMonitor !== undefined) {
        cmd += `--resConsMonitor ${params.resConsMonitor} `;
    }
    if (params.monitors !== undefined) {
        cmd += `--monitors ${params.monitors} `;
    }
    if (params.showInputParams !== undefined) {
        cmd += `--showInputParams ${params.showInputParams} `;
    }

    if (params.statsFolder) {
        cmd += `--statsFolder ${params.statsFolder} `;
    }
    if (params.graphs) {
        cmd += `--graphs ${params.graphs} `;
    }
    if (params.outputType) {
        cmd += `--outputType '${params.outputType}' `;
    }
    if (params.output) {
        cmd += `--output ${params.output} `;
    }
    if (params.fitPlot) {
        cmd += `--fitPlot ${params.fitPlot} `;
    }
    if (params.message) {
        cmd += `--message '${params.message}' `;
    }
    return cmd;
}

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
}

exports.start = start;
