const chalk = require('chalk');
const fs = require('fs');
const fetch = require('node-fetch');

require('dotenv').config();
const log = require('loglevel');
log.setLevel(process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info');

import { getMasterProperty, setMasterProperty } from '../master_database_manager';
import { reddit } from '../reddit';

export async function processModlog() {
    try {
        const modlogSubreddit = await reddit.getSubreddit('hmmm');
        const removedSubmissions = await modlogSubreddit.getModerationLog({ type: 'removelink', limit: 200 });
        const unprocessedRemovedSubmissions = await consumeRemovedSubmissions(removedSubmissions, 'removed');
        await processRemovedPosts(unprocessedRemovedSubmissions, reddit);
    } catch (err) {
        log.error(chalk.red('[HMMM_MODLOG] modlog error: ', err));
    }

    setTimeout(processModlog, 4 * 60 * 1000);
}

async function processRemovedPosts(unprocessedItems, reddit) {
    if (!unprocessedItems || unprocessedItems.length == 0) {
        return;
    }

    for (let item of unprocessedItems) {
        try {
            if (item.mod !== 'AutoModerator' && item.mod !== process.env.ACCOUNT_USERNAME) {
                const submissionId = item.target_permalink.split('/')[4]; // "/r/hmmm/comments/a0uwkf/hmmm/eakgqi3/"
                const submission = await reddit.getSubmission(submissionId);
                const submissionRemoved = await submission.removed; // confirm it's still removed
                if (submissionRemoved) {
                    await submission.assignFlair({ text: 'Removed - see removal wiki in sidebar for info' });
                }
            }
        } catch (e) {
            log.error('[HMMMM_MODLOG] Error processing approved posts:', item.target_permalink, e);
        }
    }
}

// overkill, but well tested
async function consumeRemovedSubmissions(latestItems, suffix) {
    latestItems.sort((a, b) => {
        return a.created_utc - b.created_utc;
    }); // oldest first

    let propertyId = 'hmmm_processed_modlog';
    if (suffix) {
        propertyId = propertyId + suffix;
    }

    const maxCheck = 300;
    if (latestItems.length > maxCheck) {
        log.info('[HMMM] Passed more than maxCheck items:', latestItems.length);
        latestItems = latestItems.slice(latestItems.length - maxCheck, latestItems.length);
    }

    // don't process anything over 72 hours old for safeguard. created_utc is in seconds/getTime is in millis.
    const threeHoursAgo = new Date().getTime() - 1000 * 60 * 60 * 72;
    latestItems = latestItems.filter((item) => item.created_utc * 1000 > threeHoursAgo);

    const processedIds = await getMasterProperty(propertyId);
    if (!processedIds) {
        log.warn(chalk.magenta('[HMMM] Could not find the last processed id list when retrieving unprocessed modlog changes. Regenerating...'));
        const intialProcessedIds = latestItems.map((submission) => submission.id);
        await setMasterProperty(propertyId, intialProcessedIds);
        return [];
    }

    // update the processed list before processing so we don't retry any submissions that cause exceptions
    const newItems = latestItems.filter((item) => !processedIds.includes(item.id));
    let updatedProcessedIds = processedIds.concat(newItems.map((submission) => submission.id)); // [3,2,1] + [new] = [3,2,1,new]
    const processedCacheSize = maxCheck * 5; // larger size for any weird/future edge-cases where a mod removes a lot of submissions
    if (updatedProcessedIds.length > processedCacheSize) {
        updatedProcessedIds = updatedProcessedIds.slice(updatedProcessedIds.length - processedCacheSize); // [3,2,1,new] => [2,1,new]
    }
    await setMasterProperty(propertyId, updatedProcessedIds);

    return newItems;
}
