'use strict'; // eslint-disable-line strict

const execution = require('./lib/s3blaster').execution;

if (require.main === module) {
    execution(err => {
        if (err) {
            process.stderr.write(err);
        }
        process.exit();
    });
}
