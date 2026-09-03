import { z } from 'zod';
import type { Bot } from 'mineflayer';

import { attack, breakBlock, click, moveTo, selectItem, craft, pickUpLoot, placeBlockOn, useOnEntity, checkBlock, checkEntity, anvil, checkInventory, sneak, checkAdvancement, jump, rawBlockPlace } from './abstraction.js'
import { Vec3 } from 'vec3';


function getTarget(target: z.infer<typeof Target>, map: Record<string, any>) {
    if (typeof target === "string") {
        return map ? map[target] : target;
    }
    return new Vec3(target.x, target.y, target.z);
}

function getTargetEntity(target: string, map: Record<string, any>) {
    if (map && target in map) {
        return map[target];
    }
    // Assume a stright UUID
    return target;
}

const Target = z.union([
  z.string(),
  z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
]);

const ActionSchema = z.object({
    name: z.string(),
    expect_result: z.boolean().optional(),
    verbose: z.boolean().optional(),
})

const CheckSchema = ActionSchema.extend({
    expect_result: z.boolean().default(true),
})

const MoveTo = ActionSchema.extend({
        name: z.literal("move_to"),
        target: Target,
        distance: z.number().optional(),
    }).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await moveTo(bot, getTarget(data.target, map), data.distance, data.verbose);
    }
}))

const Sneak = ActionSchema.extend({
    name: z.literal("sneak"),
    state: z.boolean()
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await sneak(bot, data.state)
    }
}))


const Jump = ActionSchema.extend({
    name: z.literal("jump"),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await jump(bot)
    }
}))


const PickUpLoot = ActionSchema.extend({
    name: z.literal("pick_up_loot"),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await pickUpLoot(bot, data.verbose);
    }
}))

const PlaceBlockOn = ActionSchema.extend({
    name: z.literal("place_on"),
    target: Target,
    face: z.string(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await placeBlockOn(bot, getTarget(data.target, map), data.face, data.verbose);
    }
}))

const RawPlace = ActionSchema.extend({
    name: z.literal("place"),
    target: Target,
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await rawBlockPlace(bot, getTarget(data.target, map));
    }
}))

const Break = ActionSchema.extend({
    name: z.literal("break"),
    target: Target,
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await breakBlock(bot, getTarget(data.target, map), data.verbose);
    }
}))

const AnvilOperation = ActionSchema.extend({
    name: z.literal("anvil"),
    target: Target,
    item_one: z.string().optional(),
    item_two: z.string().optional(),
    custom_name: z.string().optional(),
}).refine((data) => !(!data.item_two && !data.custom_name),
    {
        message: "custom_name is mandatory when item_two is not provided"
    }
).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await anvil(bot, getTarget(data.target, map), data.item_one, data.item_two, data.custom_name, data.verbose);
    }
}))


const Craft = ActionSchema.extend({
    name: z.literal("craft"),
    target: Target.optional(),
    item: z.string(),
    count: z.number().optional(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await craft(bot, data.item, data.target ? getTarget(data.target, map) : undefined, data.count, data.verbose);
    }
}))

const Click = ActionSchema.extend({
    name: z.literal("click"),
    target: Target,
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await click(bot, getTarget(data.target, map));
    }
}))


const UseOnEntity = ActionSchema.extend({
    name: z.literal("use_on_entity"),
    target: Target,
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await useOnEntity(bot, getTarget(data.target, map));
    }
}))

const SelectItem = ActionSchema.extend({
    name: z.literal("select"),
    item: z.string(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await selectItem(bot, data.item, data.verbose);
    }
}))

const Wait = ActionSchema.extend({
    name: z.literal("wait"),
    ticks: z.number().int(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await bot.waitForTicks(data.ticks);
    }
}))

const Attack = ActionSchema.extend({
    name: z.literal("attack"),
    target: z.string()
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await attack(bot, getTargetEntity(data.target, map));
    }
}))


// checks

const CheckEntity = CheckSchema.extend({
    name: z.literal("check_entity"),
    target: z.string(),
    nbt: z.string().optional(),
    health: z.float32().optional(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await checkEntity(bot, getTargetEntity(data.target, map), data.nbt, data.health);
    }
}))

const CheckAdvancement = CheckSchema.extend({
    name: z.literal("check_advancement"),
    advancement: z.string(),
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await checkAdvancement(bot, data.advancement);
    }
}))

const CheckBlock = CheckSchema.extend({
    name: z.literal("check_block"),
    target: Target,
    expected: z.string(),
    nbt: z.string().optional()
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return await checkBlock(bot, getTarget(data.target, map), data.expected, data.nbt, data.verbose);
    }
}))

const CheckInventory = CheckSchema.extend({
    name: z.literal("check_inventory"),
    count: z.number().int().optional(),
    item: z.string(),
    damage: z.number().int().optional(),
    custom_name: z.string().optional()
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        // unpack everything and only keep the empty params
        const { name, count, verbose, expect_result, item, ...params } = data;
        return checkInventory(bot, item, count, params, verbose);
    }
}))


// NO-OPS
const Pass = ActionSchema.extend({
    name: z.literal("pass")
}).transform((data) => ({
    ...data,
    execute: async (bot: Bot, map: any) => {
        return true;
    }
}))

const Fail = ActionSchema.extend({
    name: z.literal("fail")
}).transform((data) => ({
    ...data,
    expect_result: true,
    execute: async (bot: Bot, map: any) => {
        return false;
    }
}))


export const DiscriminizedAction = z.discriminatedUnion("name", [
    Wait,
    SelectItem,
    MoveTo,
    Break,
    PickUpLoot,
    RawPlace,
    PlaceBlockOn,
    Click,
    Craft,
    Attack,
    Sneak,
    UseOnEntity,
    Jump,
    AnvilOperation,
    
    // check
    CheckBlock,
    CheckEntity,
    CheckInventory,
    CheckAdvancement,

    // NO-OPS
    Pass,
    Fail,
])

export type DiscriminizedAction = z.infer<typeof DiscriminizedAction>;

export const TestCasesSchema = z.object({
    meta: z.object({
        id: z.string(),
        time: z.iso.datetime({ local: true }),
        x: z.number().int(),
        y: z.number().int().optional(),
        z: z.number().int(),
        username: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/).optional(),
        address: z.string().optional(),
        level_csv: z.string(),
        output_csv: z.string().optional(),
    }),
    test_cases: z.array(
        z.object({
            id: z.string(),
            actions: z.array(DiscriminizedAction),
        })
    )
})

export type TestCasesSchema = z.infer<typeof TestCasesSchema>;