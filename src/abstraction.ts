import type { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import { Item } from 'prismarine-item';
import pathfinder, { Movements } from 'mineflayer-pathfinder';
import nbtts from "nbt-ts";

import { isBlock, isEntity } from './type-check.js';
import { UUID } from 'node:crypto';
import { getConfig } from './config.js';
import { Vec3 } from 'vec3';

let movement: Movements;

export function setMovements(bot: Bot) {
    const defaultMove: Movements = new Movements(bot);

    // can't break or place blocks while pathfinding
    defaultMove.canDig = false;
    defaultMove.scafoldingBlocks = [];

    movement = defaultMove;
}

export async function moveTo(bot: Bot, target: UUID | Vec3, distance: number = 1, verbose?: boolean): Promise<boolean> {
    let coords = target instanceof Vec3 ? target : uuidToEntity(bot, target)?.position;

    if (!coords) {
        if (verbose) console.log("Entity not found");
        return false;
    }

    return new Promise((resolve) => {
        function cleanup() {
            clearTimeout(timeout);
            bot.removeAllListeners("goal_reached");
            bot.removeAllListeners("path_update");

            bot.pathfinder.setGoal(null);
            bot.pathfinder.stop();
        }

        const timeout = setTimeout(() => {
            cleanup();
            if (verbose) console.log("Pathfinder timed out");
            resolve(false);
        }, getConfig().actions.pathfindTimeoutMs);

        bot.once("goal_reached", () => {
            cleanup();
            resolve(true);
        })

        bot.on("path_update", (status) => {
            if (verbose) console.log(`Path update received: ${status.status}`);
            if (status.status === "noPath" || status.status === "timeout") {
                cleanup();
                resolve(false);
            }
        })

        const goal = new pathfinder.goals.GoalNear(coords.x, coords.y, coords.z, distance);
        bot.pathfinder.setMovements(movement);
        bot.pathfinder.setGoal(goal);
    })
}


export async function breakBlock(bot: Bot, block: Block | Vec3, verbose?: boolean): Promise<boolean> {
    const to_dig: Block | null = isBlock(block) ? block : bot.blockAt(block);


    if (!to_dig || to_dig.type == 0) {
        return false;
    }

    await bot.dig(to_dig);

    // if the block is differnt than the one we started with we broke it successfully
    let result = bot.blockAt(to_dig.position)

    if (verbose) {
        console.log(`Block to dig is ${to_dig.type}`);
        console.log(`After digging block is ${result?.type}`);
    }
    return to_dig.type != result?.type;
}

function getViewDirection(pitch: number, yaw: number) {
    const csPitch = Math.cos(pitch)
    const snPitch = Math.sin(pitch)
    const csYaw = Math.cos(yaw)
    const snYaw = Math.sin(yaw)
    return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
}

export async function click(bot: Bot, target: Block | UUID | Vec3, face?: string, verbose?: boolean) {
    if (typeof target === "string") {
        const entity = uuidToEntity(bot, target);
        if (!entity) {
            if (verbose) console.log("Entity not found");
            return false;
        }
        return await bot.activateEntity(entity);
    }

    let block: Block | null = isBlock(target) ? target : bot.blockAt(target);
    if (block) {
        let directionVector: Vec3 | undefined;
        let cursorPosition: Vec3 | undefined;

        if (face) {
            directionVector = nameToFace(face);
            // Default cursor position to the center of the specified face (range 0.0 to 1.0)
            cursorPosition = new Vec3(0.5, 0.5, 0.5);
        } else {
            // 1. Get bot's eye position
            await bot.lookAt(block.position);
            const { position, height, pitch, yaw } = bot.entity
            const eyePosition = position.offset(0, height, 0);
            const viewDirection = getViewDirection(pitch, yaw)

            // 3. Perform raycast to find the exact hit face and intersection point
            const raycastResult = bot.world.raycast(eyePosition, viewDirection, 5);

            if (raycastResult && raycastResult.intersect) {
                // Converts internal face ID (0-5) to a direction Vec3
                directionVector = nameToFace(raycastResult.face.toString());

                // Convert absolute world intersection point to relative cursor position inside the block [0.0, 1.0]
                if (raycastResult.intersect.floored() == block.position) {
                    cursorPosition = raycastResult.intersect.minus(block.position) as Vec3;
                } 
            }
        }

        await bot.activateBlock(block, directionVector, cursorPosition);

        // Short check: confirm block was successfully targeted
        const isSuccess = block !== null;
        return isSuccess;
    }
    return false;
}

export async function pickUpLoot(bot: Bot, verbose?: boolean): Promise<boolean> {
    await bot.waitForTicks(1);
    const item_entity = bot.nearestEntity((e) => e.name === "item");

    if (!item_entity || !item_entity.isValid || bot.entity.position.distanceTo(item_entity.position) > getConfig().actions.maxPickupRange) {
        if (verbose) console.log("no item entity found in range");
        return false;
    }

    return new Promise<boolean>(resolve => {
        const timeout = setTimeout(async () => {
            bot.removeAllListeners("entityGone");
            bot.pathfinder.stop();
            if (verbose) console.log("pathfinder timed out");
            resolve(false);
        }, getConfig().actions.itemPickupTimeoutMs);

        bot.on('entityGone', async (entity) => {
            if (entity === item_entity) {
                clearTimeout(timeout);
                bot.pathfinder.stop();
                bot.removeAllListeners("entityGone");
                resolve(true);
            }
        });
        const goal = new pathfinder.goals.GoalFollow(item_entity, getConfig().actions.itemPickupRadius);
        bot.pathfinder.setMovements(movement);
        bot.pathfinder.setGoal(goal);
    })
}

export async function lookAt(bot: Bot, target: UUID | Vec3) {
    let coords = target instanceof Vec3 ? target : uuidToEntity(bot, target)?.position;
    if (coords == null) {
        return false;
    }
    await bot.lookAt(coords);
    return true;
}

export async function attack(bot: Bot, target: UUID) {
    const entity = uuidToEntity(bot, target);
    if (!entity) {
        return false;
    }
    await bot.lookAt(entity.position);
    bot.attack(entity);
    return true;
}

export async function useOnEntity(bot: Bot, target: UUID) {
    const entity = uuidToEntity(bot, target);
    if (!entity) {
        return false;
    }
    await bot.lookAt(entity.position)
    bot.useOn(entity);
    return true;
}

export async function placeBlockOn(bot: Bot, pos: Vec3, side: string = "top", verbose?: boolean): Promise<boolean> {
    const face = nameToFace(side) || new Vec3(0, 1, 0);
    const old_block = bot.blockAt(pos);

    if (!old_block) {
        return false;
    }

    await bot.placeBlock(old_block, face);
    return true;
}


// spoof to expose internal method
interface ExtendedBot extends Bot {
    _genericPlace: (
        referenceBlock: Block,
        faceVector: Vec3,
        options: any
    ) => Promise<void>;
}

export async function rawBlockPlace(bot: Bot, pos: Vec3) {
    const old_block = bot.blockAt(pos);
    if (!old_block) {
        return false;
    }

    await (bot as ExtendedBot)._genericPlace(old_block, pos, { delta: new Vec3(0, 0, 0) });
    return true;
}

export async function jump(bot: Bot) {
    bot.setControlState("jump", true);
    await bot.waitForTicks(1);
    bot.setControlState("jump", false);
}

export function sneak(bot: Bot, sneak?: boolean) {
    // if not provided just toggle
    sneak = sneak ?? !bot.getControlState("sneak");
    bot.setControlState("sneak", sneak);
}

export async function checkBlock(bot: Bot, block: Vec3, expeced_block?: string, nbt?: string, verbose?: boolean): Promise<boolean> {
    if (!expeced_block && !nbt) {
        throw new Error("No checks provided for block");
    }

    const block_id: string = expeced_block || bot.blockAt(block)?.name || "air";

    if (verbose) {
        console.log(`client side block at ${block} is`);
        console.log(bot.blockAt(block));
    }

    await bot.waitForTicks(1);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.execute.conditional.pass") {
                resolve(true);
            } else {
                resolve(false);
            }
        });
        bot.chat(`/execute if block ${block.x} ${block.y} ${block.z} ${block_id}${nbt || ""}`);
    })

}

export async function checkEntity(bot: Bot, target: UUID, nbt?: string, health?: number): Promise<boolean> {
    let snbt = nbt || "{}";

    if (health !== undefined) {
        const p_nbt = nbtts.parse(snbt);
        (p_nbt as any).Health = new nbtts.Float(health);
        snbt = nbtts.stringify(p_nbt);
    }

    await bot.waitForTicks(1);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.execute.conditional.pass_count") {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        bot.chat(`/execute if data entity ${target} ${snbt}`)
    })
}

export async function checkAdvancement(bot: Bot, advancement: string): Promise<boolean> {
    await bot.waitForTicks(1);
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.execute.conditional.pass_count") {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        bot.chat(`/execute if entity @s[advancements={${advancement}=true}]`)
    })
}


export async function getMobHealth(bot: Bot, target: UUID): Promise<number | null> {
    await bot.waitForTicks(1);
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(null);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.data.entity.query") {
                resolve(+ msg.json.with[1].extra[0].text);
            } else {
                resolve(null);
            }
        });

        bot.chat(`/data get entity ${target} Health`);
    })
}


export async function anvil(bot: Bot, anvil_block: Vec3, item_one?: string, item_two?: string, name?: string, verbose?: boolean): Promise<boolean> {
    const block = bot.blockAt(anvil_block);
    if (!block) {
        if (verbose) console.log(`No block found at ${anvil_block}`);
        return false;
    }

    const anvil = await bot.openAnvil(block);

    let item_1 = item_one ? findItem(bot, item_one) : bot.heldItem;


    console.log(item_1)
    if (!item_1) {
        console.log("item1 not found");
        return false;
    }

    let item_2 = item_two ? findItem(bot, item_two, [item_1]) : null;

    console.log(item_2)

    try {
        if (!item_2) {
            await anvil.rename(item_1, name);
        } else {
            await anvil.combine(item_1, item_2, name);
        }
    } catch (_) {
        return false;
    } finally {
        (anvil as any as Window).close();
    }
    return true;
}


export async function assertChatResponse(bot: Bot, command: string | null, expected: string): Promise<boolean> {
    await bot.waitForTicks(1);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);

            console.log(JSON.stringify(msg))

            const text = msg.toString();

            console.log(text)
            resolve(text == expected)
        });

        if (command != null) {
            bot.chat(command)
        }
    })
}


async function waitForCoQueue(bot: Bot): Promise<boolean> {
    return new Promise((resolve) => {
        const onMessage = (msg: any) => {
            const text = msg.toString();
            if (/Consumer: 0 items in queue/i.test(text)) {
                finish(true);
            }
        };

        const timeout = setTimeout(() => {
            finish(false);
        }, 5000);

        bot.on("message", onMessage);

        const timer = setInterval(() =>
            bot.chat("/co status")
            , 1000);

        const finish = (result: boolean) => {
            clearTimeout(timeout);
            clearInterval(timer);
            bot.removeListener("message", onMessage);
            resolve(result);
        };

    });
}

export async function assertCoreProtect(bot: Bot, expected_count: number, radius: number, user?: string, time?: string, action?: string, include?: string, exclude?: string): Promise<boolean> {
    const queue_clear = await waitForCoQueue(bot);
    if (!queue_clear) {
        return false;
    }

    let command = `/co lookup r:${radius}`

    if (user) {
        if (user == "@s") {
            user = bot.username
        }
        command += ` user:${user}`
    }
    if (time) {
        command += ` time:${time}`
    }
    if (action) {
        command += ` action:${action}`
    }
    if (include) {
        command += ` include:${include}`
    }
    if (exclude) {
        command += ` exclude:${exclude}`
    }
    command += " #count"

    console.log(command)

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.on("message", (msg) => {
            const text = msg.toString();
            const match = new RegExp(/- (\d+) rows? found/, "i").exec(text)
            if (!match) {
                return;
            }

            clearTimeout(timeout);
            bot.removeAllListeners("message");
            const number = parseInt(match[1]);
            resolve(number === expected_count)
        });

        bot.chat(command)
    })
}

export async function assertExperience(bot: Bot, level: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.experience.query.levels") {
                const xp_levels = msg.json?.with?.[1]?.text ?? 0;
                resolve(level == xp_levels)
            }
        });

        bot.chat("/xp query @s levels")
    })
}


export async function checkInventory(bot: Bot, item_id: string, count?: number, rawcomponents?: any, verbose?: boolean): Promise<boolean> {

    const components: string[] = [];

    for (const [key, value] of Object.entries(rawcomponents)) {
        if (value !== undefined && value !== null) {
            components.push(`${key}=${value}`);
        } else {
            components.push(key);
        }
    }

    const command = `/execute if items entity @s container.* ${item_id}[${components?.join(",") || ""}]`;

    if (verbose) {
        console.log(command);
    }

    await bot.waitForTicks(1);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve(false);
            bot.removeAllListeners("message");
        }, getConfig().actions.shortTimeoutMs);

        bot.once("message", (msg) => {
            clearTimeout(timeout);
            if (msg?.translate === "commands.execute.conditional.pass_count") {
                if (count === undefined) {
                    resolve(true);
                    return;
                }

                if (verbose) {
                    console.log(`Result: ${msg.json.with[0]}`);
                }

                resolve(msg.json.with[0] == count);
            } else {
                // if none are found, should return true if we expect to find zero items
                resolve(count === 0);
            }
        });

        bot.chat(command)
    })
}

export async function craft(bot: Bot, item_name: string, crafting_table?: Vec3, count: number = 1, verbose?: boolean): Promise<boolean> {
    const item = bot.registry.itemsByName[item_name];
    if (!item) {
        if (verbose) {
            console.log(`Item "${item_name}" not found`);
        }
        return false;
    }

    let crafting_table_block: Block | null = null;
    if (crafting_table) {
        crafting_table_block = bot.blockAt(crafting_table);
        if (verbose) {
            console.log(`Block at ${crafting_table_block?.position} is ${crafting_table_block?.type}`);
        }
        if (!crafting_table_block) {
            return false;
        }
    }

    const recipe = bot.recipesFor(item.id, null, count, crafting_table_block)[0];

    if (!recipe) {
        if (verbose) console.log(`No recipes found for ${item_name}` + crafting_table_block ? " without crafting table" : "");
        return false;
    }

    if (!recipe.requiresTable) {
        crafting_table_block = null;
    } else if (crafting_table_block?.type !== bot.registry.blocksByName.crafting_table.id) {
        return false;
    }

    const crafting_count = Math.ceil(count / recipe.result.count);

    if (verbose) {
        console.log(`Attempting to craft ${crafting_count * recipe.result.count} x ${item.name}`);
    }

    await bot.craft(recipe, crafting_count, crafting_table_block || undefined);
    await bot.waitForTicks(1);
    return true;
}


export async function selectItem(bot: Bot, element: number | string | null, verbose?: boolean): Promise<boolean> {
    if (typeof element === "number") {
        bot.setQuickBarSlot(element - 1);
        return true;
    }

    if (element == null) {
        if (bot.heldItem == null || bot.heldItem.name == "air") {
            return true;
        }

        bot.unequip("hand");
        return bot.heldItem == null || bot.heldItem.name == "air";
    }

    const item = findItem(bot, element);
    if (!item) {
        return false;
    }

    await bot.equip(item, "hand");

    return bot.entity.heldItem.name === element;
}

const BlockFace = {
    UNKNOWN: -999,
    BOTTOM: 0,
    TOP: 1,
    NORTH: 2,
    SOUTH: 3,
    WEST: 4,
    EAST: 5
}

function nameToFace(face: string | undefined): Vec3 | undefined {
    if (!face) {
        return undefined;
    }
    const faceVectors: Record<string, Vec3> = {
        '1': new Vec3(0, 1, 0),
        'top': new Vec3(0, 1, 0),
        '+y': new Vec3(0, 1, 0),
        '0': new Vec3(0, -1, 0),
        'bottom': new Vec3(0, -1, 0),
        '-y': new Vec3(0, -1, 0),
        '2': new Vec3(0, 0, -1),
        'north': new Vec3(0, 0, -1),
        '-z': new Vec3(0, 0, -1),
        '3': new Vec3(0, 0, 1),
        'south': new Vec3(0, 0, 1),
        '+z': new Vec3(0, 0, 1),
        '5': new Vec3(1, 0, 0),
        'east': new Vec3(1, 0, 0),
        '+x': new Vec3(1, 0, 0),
        '4': new Vec3(-1, 0, 0),
        'west': new Vec3(-1, 0, 0),
        '-x': new Vec3(-1, 0, 0),
    };

    return faceVectors[face];
}

function uuidToEntity(bot: Bot, uuid: UUID): Entity | null {
    return bot.nearestEntity((e) => e.uuid === uuid);
}


function findItem(bot: Bot, name: string, exclude?: [Item]): Item | null {
    const item_by_name = bot.inventory.items().find(item => {
        const custom_name: string | undefined = (item as any)?.components?.find((component: any) => component.type == "custom_name" || item.customName)?.data?.value;
        return custom_name === name && !exclude?.includes(item)
    });

    if (item_by_name) {
        return item_by_name;
    }

    const item_by_id = bot.inventory.items().find(item => item.name === name && !exclude?.includes(item));
    return item_by_id ?? null;
}