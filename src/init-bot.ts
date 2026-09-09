import mineflayer, { Bot } from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
import { isOp, waitForOp } from './op-check.js';
import { setMovements } from './abstraction.js';
import { getConfig } from './config.js';

export async function initBot(name: string, address: string | null): Promise<Bot> {
    return new Promise((resolve, reject) => {
        const bot = mineflayer.createBot({
            host: address || "localhost",
            username: name,
            auth: 'offline' // for offline mode servers, no need to buy real accounts for testing
        });

        // Inject the pathfinder plugin
        bot.loadPlugin(pathfinder);

        // Log errors and kick reasons:
        bot.on('kicked', (m) => {
            console.log(m);
            reject(m)
        });

        bot.on('error', (err) => {
            console.error(err);
            reject(err);
        });

        bot.once('spawn', async () => {
            await bot.waitForTicks(getConfig().bot.spawnSettleTicks);

            if (!await isOp(bot)) {
                if (bot._client.isServer){
                    bot.chat('bot is not OP on the server please run the following command:');
                    bot.chat(`op ${bot.username}`);
                    await waitForOp(bot);
                    bot.chat('Bot is successfully op:');
                } else {
                    bot.chat("LAN world detected, please restart with commands enabled.");
                    await bot.quit();
                    reject(new Error("Commands not enabled in LAN world"));
                }
            }
            // this tag will be used later
            bot.chat('/tag @s add bot');


            setMovements(bot);

            console.log(`MineflayerTestbed running on ${bot.version} server`)

            // if test is provided, run the tests and exit with the appropriate code
            // else start the API server to allow external control of the bot
            resolve(bot);
        });
    });
}