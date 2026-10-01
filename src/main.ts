import fs, { readdir } from 'node:fs'

import { getArgs } from './args-parse.js';
import { executeTests } from './tests-executer.js'

import { startApiServer } from './api-server.js';

import { loadConfig } from './config.js';

import { TestCasesSchema } from './tests-schema.js';
import { exit } from 'node:process';
import { initBot } from './init-bot.js';
import { buildLevel } from './level-builder.js';
import { Vec3 } from 'vec3';
import { isOp } from './op-check.js';

// setup command line args and defaults
const args: any = getArgs();
const config = loadConfig(args?.config || "./config.json");

const tests_json: string = args?.test;
let parsed_tests: TestCasesSchema | undefined;
if (tests_json) {
    const file = fs.readFileSync(tests_json, 'utf8');
    const json = JSON.parse(file);
    parsed_tests = TestCasesSchema.parse(json);
}
const meta = parsed_tests?.meta;
const output_csv_path: string | undefined = args?.output_csv || meta?.output_csv

if (args?.build_level){
    try {
        const bot = await initBot(args?.username || "Bot", args?.address);
        const csv_string = fs.readFileSync(args.build_level);
        await buildLevel(bot, csv_string.toString(), new Vec3(0,64, 0));
        if (!await isOp(bot)){
            exit(1);
        }
        exit(0);

    } catch {
        exit(1);
    }

}

if (args?.test) {
    const bot = await initBot(args?.username || meta?.username || "Bot", args?.address || meta?.address);
    const success = await executeTests(bot, parsed_tests!, output_csv_path);
    bot.quit();
    exit(success ? 0 : 1); //convert boolean to standard bash 0 for all correct 1 for error
} else {
    const api_port: number = args?.api_port || config.server.port;
    startApiServer(api_port);
    console.log('API server started. Awaiting connection request.');
}
