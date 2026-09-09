import type { Bot } from 'mineflayer';
import type { ChatMessage } from 'prismarine-chat'

async function isOp(bot: Bot): Promise<boolean | null> {
    return new Promise((resolve) => {
        bot.once("message", (message: ChatMessage) => {
            const translation: string | undefined = message?.extra?.[0]?.translate || message?.json?.extra?.translate || message?.json?.translate;
            //console.log(JSON.stringify(message));
            if (!translation || translation === 'command.unknown.command') {
                resolve(false);
                return;
            }
            if (translation.startsWith('commands.tag')) {
                resolve(true);
                return;
            }
            resolve(null);
        });
        bot.chat("/tag @s add bot");
    })
}

async function waitForOp(bot: Bot): Promise<void> {
    return new Promise((resolve) => {
        let handler = (message: ChatMessage) => {
            const msg_with = message.json?.with?.[1];
            if (!msg_with){
                return;
            }
            if (msg_with?.with?.[0] === bot.username &&
                msg_with?.translate === 'commands.op.success') {
                bot.removeListener('message', handler);
                resolve();
            }
        }
        bot.on('message', handler);
    })
}

export {isOp, waitForOp}