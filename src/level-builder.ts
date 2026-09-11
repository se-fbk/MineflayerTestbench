import { parseString } from '@fast-csv/parse';
import nbtts from "nbt-ts";
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { UUID } from 'crypto';
import { getConfig } from './config.js';

// Coords should be a vec3 of the bottom xyz corner of the level
async function buildLevel(bot: Bot, csv_content: string, coords: Vec3): Promise<Record<string, Vec3 | UUID>> {
    bot.chat('/gamemode spectator @s');
    bot.chat(`/tp @s ${coords.x} ${coords.y} ${coords.z}`);

    const [inventory, structure] = await process_level(csv_content);

    const playerY = structure.findIndex(layer =>
        layer.some(row =>
            row.some( cell => cell.match(/@player(\^.+)?/))
        )
    );

    if (playerY == -1) {
        throw new Error("Invalid level, must specify player position");
    }

    // dy must be tall enough to fit the player
    const dy: number = Math.max(playerY + 3, structure.length);

    // find longest row for the z dimension
    const dz: number = Math.max(3, ...structure.map((layer: string[][]) => layer.length));

    // find longest row in the x dimension
    const dx: number = Math.max(3, ...structure.map((layer: string[][]) => Math.max(...layer.map((row: string[]) => row.length))));

    await bot.waitForChunksToLoad();

    // clear out area and surrouns with barriers
    bot.chat(`/fill ${coords.x - 1} ${coords.y - 1} ${coords.z - 1} ${coords.x + dx} ${coords.y + dy} ${coords.z + dz} minecraft:barrier hollow`);
    bot.chat('/clear');
    bot.chat('/xp set @s 0');
    bot.chat('/xp set @s 0 levels');
    bot.chat('/effect clear @s');
    bot.chat('/advancement revoke @s everything');
    // execute the kill command multiple times to also kill any items the entities may have dropped
    // also to handle slimes
    const kill_cmd = `/kill @e[type=!minecraft:player, x=${coords.x - 1}, y=${coords.y - 1}, z=${coords.z - 1}, dx=${dx+1}, dy=${dy+1}, dz=${dz+1}]`
    bot.chat(kill_cmd);
    bot.chat(kill_cmd);
    bot.chat(kill_cmd);
    bot.chat(kill_cmd);

    const map: Record<string, Vec3 | UUID> = {};

    for (const [dy, layer] of structure.entries()) {
        for (const [dz, line] of layer.entries()) {
            for (const [dx, entry] of line.entries()) {
                // skip empty blocks
                if (!entry) {
                    continue;
                }

                const [thing, tag] = getTag(entry.trim());


                const pos: Vec3 = new Vec3(coords.x + dx, coords.y + dy, coords.z + dz);

                if (thing == "@player") {
                    bot.chat(`/tp @s ${pos.x} ${pos.y} ${pos.z}`)
                    continue;
                }

                // if it starts with @ it's an entity
                if (thing[0] === "@") {
                    let entity_id: string = thing.substring(1);
                    let uuid = summonEntity(entity_id, pos, bot, tag);
                    if (tag && uuid) {
                        map[tag] = uuid;
                    }
                    continue;
                }

                //defer block placement
                if (thing[0] === "!") {
                    setTimeout(() => bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} ${thing.substring(1)}`), getConfig().levelBuilder.deferredPlacementDelayMs);
                } else if (thing) {
                    bot.chat(`/setblock ${pos.x} ${pos.y} ${pos.z} ${thing}`);
                }

                if (tag) {
                    map[tag] = pos;
                }

            }
        }
    }

    // load invetory of bot
    if (inventory[0]) {
        // hotbar
        for (const [slot, item] of inventory[0].entries()) {
            bot.chat(`/item replace entity @s hotbar.${slot} with ${item.trim()}`);
        }

        // rest of the inventory
        inventory.shift();
        let slot_number = 0;
        for (const [row, items] of inventory.entries()) {
            for (const item of items) {
                if (item[0] === "/") {
                    bot.chat(item);
                    continue;
                }
                bot.chat(`/item replace entity @s inventory.${slot_number} with ${item.trim()}`);
                slot_number++;
            }
        }
    }

    bot.chat('/gamemode survival @s');
    bot.chat('/effect give @s minecraft:instant_health 1 200');
    bot.chat('/effect give @s minecraft:saturation 1 200');

    await bot.waitForTicks(getConfig().levelBuilder.postBuildWaitTicks);
    await bot.setQuickBarSlot(0);
    return map;
}

async function process_level(csv: string): Promise<[string[][], string[][][]]> {
    const inventory: string[][] = [];
    const structure: string[][][] = [];
    let current_layer: string[][] = [];

    await new Promise((resolve) => {
        let dest = inventory;
        parseString(csv, { headers: false })
            .on('data', (row) => {
                // "|" symbol is use to separate vertical layers in the y layer
                if (row[0]?.startsWith('|')) {
                    // swap out, we are no longer doing the inventory
                    dest = current_layer;
                    // remove pipe symbol
                    row[0] = row[0].substring(1);
                    structure.push(current_layer);
                    current_layer = [];
                }
                dest.push(row);
            }).on('end', resolve);
    })
    structure.push(current_layer);
    // remove the first layer if it's empty 
    if (structure[0]?.length === 0) {
        structure.shift();
    }
    return [inventory, structure];
}

function summonEntity(entity: string, pos: Vec3, bot: Bot, tag: string | null): UUID | undefined {
    let [entity_id, nbt_tags] = getNbt(entity);
    let uuid: UUID | undefined;
    if (tag) {
        uuid = crypto.randomUUID();
        (nbt_tags as any).UUID = uuidToArray(uuid);
    }
    // we count the bot position as an entity
    bot.chat(`/summon ${entity_id} ${pos.x} ${pos.y} ${pos.z} ${nbtts.stringify(nbt_tags)}`);

    return uuid;
}

function getTag(input: string): [string, string | null] {
    let bracket_level = 0;
    let split = -1;

    // Track bracket nesting and find the last unenclosed ^
    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '{' || char === '[') {
            bracket_level++;
        } else if (char === '}' || char === ']') {
            bracket_level--;
        } else if (char === '^' && bracket_level === 0) {
            split = i;
        }
    }

    if (split !== -1 && bracket_level === 0) {
        return [
            input.substring(0, split),
            input.substring(split + 1)
        ];
    }
    // Otherwise return original string and empty string
    return [input, null];
}

function getNbt(input: string): [string, nbtts.Tag] {
    let start: number = -1;
    let end: number = -1;
    let bracket_level: number = 0;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === '{') {
            if (start === -1) {
                start = i;
            }
            bracket_level++;
        } else if (char === '}') {
            end = i;
            bracket_level--;
        }
    }

    let base: string = input;
    let tags: string = "{}";

    if (start !== -1 && bracket_level === 0) {
        base = input.substring(0, start);
        tags = input.substring(start, end + 1);
    }

    return [base, nbtts.parse(tags)];
}

// convert from standard dashed notation: eaec6bda-374c-4cf0-9e5d-e986a33d8a78 
// to miecraft signed int representation: [I;-353604646,927747312,-1638012538,-1556247944]
function uuidToArray(uuid: UUID): Int32Array {
    const hex = uuid.replace(/-/g, '');
    const buffer = Buffer.from(hex, 'hex');

    const arr = new Int32Array(4);

    for (let i = 0; i < 4; i++) {
        arr[i] = buffer.readInt32BE(i * 4);
    }
    return arr;
}

export { buildLevel };