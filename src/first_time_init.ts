const chalk = require('chalk');
const log = require('loglevel');
const outdent = require('outdent');
log.setLevel(process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info');

import { processSubmission } from './submission_processor';
import { setSubredditSettings, getMasterProperty, setMasterProperty } from './master_database_manager';
import { printSubmission } from './reddit_utils';

let inProgress = Array<string>();

export async function firstTimeInit(reddit, subredditName, database, masterSettings, suppressFirstTimeInitModmail = false) {
    const subreddit = await reddit.getSubreddit(subredditName);   

    log.info(chalk.blue(`[${subredditName}]`, 'Beginning first time initialisation for', subredditName, '. Retrieving top posts...'));
    if (!isInitialising(subredditName)) {
        inProgress.push(subredditName);
    }

    const startTime = new Date().getTime();

    try {
        const postAmount = 1000; // reddits current limit
        const alreadyProcessed = [];
    
        const topSubmissionsAll = await subreddit.getTop({time: 'all'}).fetchAll({amount: postAmount});
        await processOldSubmissions(topSubmissionsAll, alreadyProcessed, 'all time top', subredditName, database, masterSettings);
        const topSubmissionsYear = await subreddit.getTop({time: 'year'}).fetchAll({amount: postAmount});
        await processOldSubmissions(topSubmissionsYear, alreadyProcessed, 'year top', subredditName, database, masterSettings);
        const topSubmissionsMonth = await subreddit.getTop({time: 'month'}).fetchAll({amount: postAmount});
        await processOldSubmissions(topSubmissionsMonth, alreadyProcessed, 'month top', subredditName, database, masterSettings);
        const topSubmissionsWeek = await subreddit.getTop({time: 'week'}).fetchAll({amount: postAmount});
        await processOldSubmissions(topSubmissionsWeek, alreadyProcessed, 'week top', subredditName, database, masterSettings);
        const newSubmissions = await subreddit.getNew().fetchAll({amount: postAmount});
        await processOldSubmissions(newSubmissions, alreadyProcessed, 'new', subredditName, database, masterSettings);           
    } catch (e) { 
        log.error(chalk.red('Error first time initialising subreddit:'), subredditName, e);
        inProgress = inProgress.filter(item => item !== subredditName);
        return;
    }

    inProgress = inProgress.filter(item => item !== subredditName);

    const endTime = new Date().getTime();
    const totalTimeMinutes = Math.floor(((endTime - startTime) / 1000) / 60);
    log.info(`[${subredditName}]`, chalk.blue('Top and new posts successfully processed for', subredditName, '. Took: '), totalTimeMinutes, 'minutes');

    masterSettings.config.firstTimeInit = true;
    await setSubredditSettings(subredditName, masterSettings);
    log.info(`[${subredditName}]`, chalk.blue('Master settings for ', subredditName, ' set. Init is complete at this point.'));
    if (!masterSettings.config.suppressFirstTimeInitModmail || !suppressFirstTimeInitModmail) {
        log.info(`[${subredditName}]`, 'Sending initialisation complete modmail message...');
        await reddit.composeMessage({
            to: await `/r/${subredditName}`,
            subject: `Initialisation complete.`,
            text: outdent`
                Hi all, I am a repost moderation bot and I'm now checking new posts made in your subreddit.
                
                These are the current settings for your subreddit:
    
                * Remove recent image/animated media reposts
                * Remove [images you choose to blacklist](https://github.com/downfromthetrees/the_magic_eye/blob/master/README.md#remove-blacklisted-images)
                * Remove broken image links
    
                Like AutoModerator I have a wiki page where you can edit settings. Here is a link to your settings page: r/${subredditName}/wiki/magic_eye
                
                You can learn all about me at r/MAGIC_EYE_BOT or see the full documentation below:
    
                https://github.com/downfromthetrees/the_magic_eye/blob/master/README.md`
          });
          log.info(`[${subredditName}]`, chalk.blue('Success modmail sent and init set true for', subredditName));
    }

    log.info(`[${subredditName}]`, 'Sending maintainer update...');
    await reddit.composeMessage({
        to: process.env.MAINTAINER,
        subject: "First time init complete",
        text: `First time init complete for: r/${subreddit.display_name}\n\n Took ${totalTimeMinutes} minutes.`
      });

    await database.closeDatabase();
    log.info(`[${subredditName}]`, 'First time init finalised successfully.');
}

export async function processOldSubmissions(submissions, alreadyProcessed, name, subredditName, database, masterSettings) {
    const submissionsToProcess = submissions.filter(submission => !alreadyProcessed.includes(submission.id));
    log.info(`[${subredditName}]`, 'Retrived', submissions.length, name, 'posts for', subredditName, ',', submissionsToProcess.length, ' are new posts.');
    let processedCount = 0;

    let startTime = new Date().getTime();
    for (const submission of submissionsToProcess) {
        let knownPoisonedIds = await getMasterProperty('known_poisoned_ids');
        if (!knownPoisonedIds) {
            knownPoisonedIds = [];
            await setMasterProperty('known_poisoned_ids', knownPoisonedIds);
        }
        try {
            if (!knownPoisonedIds.includes(submission.id)) {
                knownPoisonedIds.push(submission.id);
                await setMasterProperty('known_poisoned_ids', knownPoisonedIds);
                await processSubmission(submission, masterSettings, database, null, false);

                var submissionIndex = knownPoisonedIds.indexOf(submission.id);
                if (submissionIndex > -1) {
                    knownPoisonedIds.splice(submissionIndex, 1);
                }
                await setMasterProperty('known_poisoned_ids', knownPoisonedIds);
            } else {
                log.info(`[${subredditName}][first_time_init]`, 'Skipping poison submission:', await printSubmission(submission));    
            }
        } catch (e) {
            log.info(`[${subredditName}][first_time_init]`, 'Error thrown while processing:', await printSubmission(submission), e);
        }
        processedCount++;
        if (processedCount % 30 == 0) {
            log.info(`[${subredditName}]`, processedCount, '/', submissionsToProcess.length, name, 'posts for', subredditName, 'completed');
        }
        alreadyProcessed.push(submission.id);
        }
    let endTime = new Date().getTime();
    log.info(`[${subredditName}]`, chalk.blue('Processed', processedCount, name, ' submissions for ', subredditName),' Took: ', (endTime - startTime) / 1000, 's.');
}

export function isInitialising(subredditName) {
    return inProgress.includes(subredditName);
}

export function isAnythingInitialising() {
    return inProgress.length > 0;
}
