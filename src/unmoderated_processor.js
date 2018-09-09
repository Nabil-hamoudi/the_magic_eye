// standard modules
require('dotenv').config();
const outdent = require('outdent');
const chalk = require('chalk');
const log = require('loglevel');
log.setLevel(process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info');

async function processUnmoderated(submissions) {
    log.debug('Retrived', submissions.length, ' top daily posts. Beginning to check for unmoderated.');
    let processedCount = 0;

    if (process.env.REPORT_UNMODERATED) {
        for (const submission of submissions) {
            let alreadyReported = submission.mod_reports && submission.mod_reports.length > 0;
            if (!submission.approved && !alreadyReported && submission.score > process.env.UNMODERATED_REPORT_SCORE) {
                submission.report({'reason': 'Unmoderated post - check for rules'});
            }
            processedCount++;
        }
    }

    log.debug(chalk.blue('Processed', processedCount, ' top daily submissions for unmoderated.'));
}

module.exports = {
    processUnmoderated,
};