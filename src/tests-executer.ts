import type { Bot } from 'mineflayer';
import type { TestCasesSchema } from './tests-schema.js'

import csv from '@fast-csv/format'
import fs from 'fs'

import { Vec3 } from 'vec3';
import { buildLevel } from './level-builder.js';

export async function executeTests(bot: Bot, parsed_tests: TestCasesSchema, output_csv_path?: string): Promise<boolean> {
    let failed = false;
    const meta = parsed_tests.meta;
    const location = new Vec3(meta.x, meta.y || 64, meta.z);

    let csvStream;

    if (output_csv_path) {
        csvStream = csv.format({ headers: true });
        const file = fs.createWriteStream(output_csv_path);
        csvStream.pipe(file);
    }

    console.log(`Executing test suite ${meta.id}, generated at ${meta.time}`);

    for (const test_case of parsed_tests.test_cases) {

        console.log("\nBuilding level");

        const csv = fs.readFileSync(meta.level_csv).toString('utf-8');
        const map = await buildLevel(bot, csv, location)

        console.log(`Executing test ${test_case.id}...`);

        try {
            for (const [i, action] of test_case.actions.entries()) {
                await bot.waitForTicks(1);

                const startTime = performance.now();

                let res: boolean | void;
                
                try{
                    res = await action.execute(bot, map);
                } catch (e){
                    console.error(`${e}\nWhile executing Action #${i} ${JSON.stringify(action)}`)
                    res = false;
                }

                if (action.verbose) {
                    console.log(`test${test_case.id}, action #${i} ${action.name}`);
                    if (typeof res === "boolean") {
                        console.log(res ? "  Succeded!" : "  Failed!");
                    }
                    console.log(`  took ${performance.now() - startTime} ms`);
                }

                const passed = action.expect_result === undefined || action.expect_result === res;

                // log everything to a csv
                csvStream?.write({
                    "time": Date.now(),
                    "game_version": bot.version,
                    "test_run": meta.id,
                    "test_case": test_case.id,
                    "action_index": i,
                    "action": action.name,
                    "action_details": JSON.stringify(action),
                    "result": res,
                    "passed": passed
                })

                if (!passed) {
                    throw new Error(`Action #${i} ${JSON.stringify(action)} resulted ${res}`);
                }
            }
            console.log(`Test ${test_case.id} passed!`);
            bot.chat(`Test ${test_case.id} passed!`);
        } catch (e) {
            console.error(`Test ${test_case.id} failed because:\n ${e}`);
            bot.chat(`Test ${test_case.id} failed!`);
            failed = true;
        }
    }
    
    csvStream?.end();
    
    await bot.waitForTicks(20);
    
    return !failed;
}
