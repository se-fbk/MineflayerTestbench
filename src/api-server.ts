import express from "express";
import cors from "cors";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { buildLevel } from "./level-builder.js";
import { DiscriminizedAction } from "./tests-schema.js";
import { UUID } from "node:crypto";
import { getConfig } from "./config.js";
import { getMobHealth } from "./abstraction.js";
import { initBot } from "./init-bot.js";

interface BotEntry {
    bot: Bot;
    status: string;
    lastActionResult: boolean;
    lastLevelCsv: string | null;
    lastLocation: Vec3 | null;
    map: Record<string, Vec3 | UUID> | null;
}

export const bots: Map<string, BotEntry> = new Map();

/**
 * Serialize the tag map (tag name -> position or entity UUID) into a plain
 * object, so it can be returned by /build-level, /reset and /tags.
 */
function serializeTags(tagMap: Record<string, Vec3 | UUID> | null): Record<string, any> {
    const tags: Record<string, any> = {};
    if (!tagMap) return tags;
    for (const [key, value] of Object.entries(tagMap)) {
        tags[key] = value instanceof Vec3
            ? { x: value.x, y: value.y, z: value.z }
            : { uuid: value };
    }
    return tags;
}

/**
 * Starts the API server for the Minecraft bot
 * @param minecraftBot The Mineflayer bot instance
 * @param port The port on which to start the server
 */
export function startApiServer(port: number = getConfig().server.port): void {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Endpoint to get the bot's status
    app.get('/:bot/status', (req, res) => {
        const botEntry = bots.get(req.params.bot);
        const bot = botEntry?.bot;

        if (!bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }
        const pos = bot.entity.position;
        const inventory = bot.inventory.items().map(item => ({
            id: item.type,
            count: item.count,
            slot: item.slot,
            name: item.name,
        }));
        const nearbyBlocks = scanNearbyBlocks(bot);
        const nearbyEntities = scanNearbyEntities(bot);

        res.json({
            status: botEntry.status,
            lastActionResult: botEntry.lastActionResult,
            position: { x: pos.x, y: pos.y, z: pos.z },
            health: bot.health,
            food: bot.food,
            inventory,
            nearbyBlocks,
            nearbyEntities,
        });
    });

    // Endpoint to build a level based on the provided csv level description
    app.post('/:bot/build-level', async (req, res) => {
        const bot = bots.get(req.params.bot);

        if (!bot?.bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }
        const { level_csv, x, y, z } = req.body;
        if (!level_csv || x === undefined || y === undefined || z === undefined) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        bot.status = 'BUSY';
        try {
            const location = new Vec3(x, y, z);
            bot.map = await buildLevel(bot.bot, level_csv, location);
            bot.lastLevelCsv = level_csv;
            bot.lastLocation = location;
            res.json({ success: true, tags: serializeTags(bot.map) });
        } catch (err: any) {
            bot.status = 'IDLE';
            res.status(500).json({ error: 'Failed to build level' });
        } finally {
            bot.status = 'IDLE';
        }
    });

    // Return the current tag map (tag name -> position or entity UUID).
    app.get('/:bot/tags', (req, res) => {
        const bot = bots.get(req.params.bot);
        if (!bot?.bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }
        res.json({ tags: serializeTags(bot.map) });
    });


    // Return the health of the mob from the UUID
    app.get('/:bot/tags/:uuid', async (req, res) => {
        const bot = bots.get(req.params.bot);
        if (!bot?.bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }
        const health = await getMobHealth(bot.bot, req.params.uuid as UUID);
        res.json({ health: health });
    });

    app.put('/:bot/:address', async (req, res) => {
        let bot = bots.get(req.params.bot);
        if (bot?.bot) {
            await bot.bot.quit();
        }

        if (!bot){
            bot = {} as BotEntry;
        }

        try {
            bot.bot = await initBot(req.params.bot, req.params.address);
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to create bot' });
            return;
        }
        bots.set(req.params.bot, bot);
    });

    app.delete('/:bot/', async (req, res) => {
        let bot = bots.get(req.params.bot);
        if (!bot){
            return;
        }

        if (bot?.bot) {
            await bot.bot.quit();
        }

        bots.delete(req.params.bot);
    });


    // Reset agent by rebuild the last built level
    app.post('/:bot/reset', async (req, res) => {
        const bot = bots.get(req.params.bot);
        if (!bot?.bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }
        if (!bot.lastLevelCsv || !bot.lastLocation) {
            return res.status(400).json({ error: 'No level has been built yet' });
        }
        if (bot.status !== 'IDLE') {
            return res.status(409).json({ status: 'busy', note: 'bot already busy' });
        }
        bot.status = 'BUSY';
        try {
            bot.map = await buildLevel(bot.bot, bot.lastLevelCsv, bot.lastLocation);
            res.json({ success: true, tags: serializeTags(bot.map) });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to reset level' });
        } finally {
            bot.status = 'IDLE';
        }
    });

    app.post('/:bot/action', async (req, res) => {
        const bot = bots.get(req.params.bot);
        if (!bot?.bot) {
            return res.status(500).json({ error: 'Bot is not initialized' });
        }

        if (!req.body) {
            return res.status(400).json({ error: 'Missing action json' });
        }

        if (bot.status !== 'IDLE') {
            return res.status(409).json({ status: 'busy', note: 'bot already busy' });
        }

        let action: DiscriminizedAction;
        try {
            action = DiscriminizedAction.parse(req.body);
        } catch (e) {
            return res.status(400).json({ error: String(e) });
        }

        // Execute synchronously and return the outcome, so an external controller
        // (e.g. an aplib agent) gets the result in the same request/response.
        bot.status = action.name;
        try {
            const raw = await action.execute(bot.bot, bot.map);
            // Actions may return a boolean outcome or nothing (void).
            const result: boolean | null = typeof raw === 'boolean' ? raw : null;
            bot.lastActionResult = action.expect_result === undefined || action.expect_result === result;
            bot.status = 'IDLE';
            return res.status(200).json({ name: action.name, result, passed: bot.lastActionResult });
        } catch (e) {
            bot.status = 'IDLE';
            bot.lastActionResult = false;
            return res.status(500).json({ name: action.name, error: String(e), result: null, passed: false });
        }
    });

    app.listen(port, () => {
        console.log(`Minecraft API server is running on http://localhost:${port}`);
    });
}




/**
 * Scans for blocks near the bot
 * @param botInstance The Mineflayer bot instance
 * @returns An array of nearby blocks
 */
function scanNearbyBlocks(botInstance: Bot): Array<{ id: string; position: { x: number; y: number; z: number } }> {
    const scan = getConfig().scan;
    const pos = botInstance.entity.position;
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);

    const nearbyBlocks: Array<{ id: string; position: { x: number; y: number; z: number } }> = [];

    for (let x = cx - scan.radiusHorizontal; x <= cx + scan.radiusHorizontal; x++) {
        for (let y = cy - scan.heightBelowBot; y <= cy + scan.heightAboveBot; y++) {
            for (let z = cz - scan.radiusHorizontal; z <= cz + scan.radiusHorizontal; z++) {
                const block = botInstance.blockAt(new Vec3(x, y, z));
                if (block && block.type !== 0) { // Exclude air blocks
                    nearbyBlocks.push({
                        id: block.name,
                        position: { x, y, z },
                    });
                }
            }
        }
    }

    return nearbyBlocks;
}


/**
 * Scans for entities near the bot
 * @param botInstance The Mineflayer bot instance
 * @returns An array of nearby entities
 */
function scanNearbyEntities(botInstance: Bot): Array<{ name: string; uuid?: string; id: number; position: { x: number; y: number; z: number } }> {
    const entityRadius = getConfig().scan.entityRadius;
    const pos = botInstance.entity.position;
    return Object.values(botInstance.entities)
        .filter(e => {
            const dx = e.position.x - pos.x;
            const dy = e.position.y - pos.y;
            const dz = e.position.z - pos.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz) <= entityRadius;
        })
        .map(e => ({
            name: e.name || e.entityType?.toString() || 'unknown',
            // uuid lets an external controller address this exact entity (e.g. attack);
            // available for players and most mobs.
            uuid: (e as any).uuid,
            id: e.id,
            position: { x: e.position.x, y: e.position.y, z: e.position.z },
        }));
}