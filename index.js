'use strict'; // eslint-disable-line strict

const execution = require('./lib/s3blaster').execution;

module.exports = {
    S3Blaster: require('./lib/s3blaster'),
    RunS3Blaster: require('./lib/runS3Blaster'),
    Plotter: require('./lib/plotter'),
};

if (require.main === module) {
    execution(err => {
        if (err) {
            process.stderr.write(err);
        }
        process.exit();
    });
}
