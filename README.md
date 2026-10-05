# MineflayerTestbench
Scripts to use Mineflayer for testing Minecraft

## How to run
Start by installing dependencies with 

`npm i`

Then you will need to compile the project with

`npm run build`

To actually run the project with default parameters, you can then use

`npm start`

### Two run modes

The bot has two modes depending on whether the `test` argument is given:

- **Batch test mode** — when `test=<file.json>` is passed, the bot connects, runs the whole JSON test suite, and then exits with code `0` if every action's outcome matched its `expect_result` (all passed) or `1` otherwise. 
- **HTTP server mode** — when `test` parameter is omitted, the bot connects and starts an HTTP API on port `3000` (dafault value) and stays connected, so an external controller can build levels and drive the bot step by step over HTTP. See [HTTP API server](#http-api-server).

Supported commmand-line args:

- ***username***: the username for the bot (default "*Bot*") if unspecified
- ***test***: path to the json file defining the test to be run, as described in [Test file format](#test-file-format). **If omitted, the bot starts in HTTP server mode instead of running a test.**
- ***address***: the address and port of the Minecraft server (default "*localhost:25565*")
- ***output_csv***: the file path for the result of the tests (no logging if undefined)
- ***config***: path to a JSON configuration file with custom parameters (scan ranges, timeouts, API port, ...). (default "*./config.json*"). Any missing value falls back to default. See [Configuration](#configuration).

Example (batch test mode):

`npm run start address=localhost:25565 username=botName test=./test.json`

Example (HTTP server mode — note: no `test=` argument):

`npm run start address=localhost:25565 username=aBot`

## Configuration

Tunable parameters (scan ranges, action timeouts, the HTTP API port, etc.) are read from a JSON config file. The file is **optional**. By default the tool reads `./config.json`. User can point to alternative configurations using the `config=<path>` command-line argument:

```bash
npm run start config=./custom-config.json
```

A `config.json` with all the defaults is included, and partial files are fine (only defined keys are overridden). The available parameters (with their defaults):

```json
{
    "server": {
        "port": 3000
    },
    "scan": {
        "radiusHorizontal": 3,
        "heightAboveBot": 2,
        "heightBelowBot": 1,
        "entityRadius": 10
    },
    "actions": {
        "pathfindTimeoutMs": 10000,
        "maxPickupRange": 5,
        "itemPickupRadius": 0.5,
        "itemPickupTimeoutMs": 2000,
        "shortTimeoutMs": 500
    },
    "levelBuilder": {
        "deferredPlacementDelayMs": 100,
        "postBuildWaitTicks": 20
    },
    "bot": {
        "spawnSettleTicks": 10
    }
}
```

- **server.port** — port the [HTTP API server](#http-api-server) listens on.
- **scan.\*** — how much of the world `GET /status` reports: the horizontal (x/z) block radius, how many blocks above/below the bot to scan, and the entity report radius.
- **actions.\*** — timeouts/ranges used while executing actions: pathfinder timeout, max loot pickup range, how close to get to an item, item-pickup timeout, and the generic short timeout used by the `check_*` command-response waits.
- **levelBuilder.\*** — delay before placing a block, and number of ticks to wait after a level finishes building.
- **bot.spawnSettleTicks** — ticks to wait after spawning before the bot starts acting.

## Minecraft server setup
For the project to run you will need to set up a local vanilla Minecraft server for the bot to connect to. 

The latest Minecraft version MineFlayer currently supports is [1.21.11](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-11).

Since the bot doesn't have a linked Microsoft account, you will need to disable authentication which can be done by setting

`online-mode=false`

in the *server.properties* file.

On the first run with a specific username, to enable the bot to do what it has to do, you will need to give OP permission to the bot, if this the case, the bot will simply tell you to run `op <bot_name>` from the console. 

It is reccommended to use a void preset superflat world for the server.

## HTTP API server

When the bot start **without** a `test=` argument it enters *server mode*. After connecting (and getting OP), it starts an HTTP API on **port 3000** and stays connected. This lets an external program build levels, observe the world, and issue actions one at a time.

Start the server with:

```bash
npm run start            # uses ./test.json only for meta (username/address); starts the API
```

The console should print `Minecraft API server is running on http://localhost:3000`.

### Endpoints

| Method & path | Body | Returns |
|---|---|---|
| `GET /status` | — | bot `status` (`IDLE`/`BUSY`/last action name), `lastActionResult`, `position`, `health`, `food`, `deaths`, `inventory[]`, `heldItem` (the item in the selected hotbar slot, `null` when the hand is empty), `nearbyBlocks[]` (each block includes its block state `properties`), `nearbyEntities[]` (each entity includes its `uuid` when available, its `velocity` and its metadata as `properties`) |
| `POST /build-level` | `{ "level_csv", "x", "y", "z" }` | `{ "success": true, "tags": { … } }` — builds the level (see [Level format](#level-format)) and returns the tag map (tag → `{x,y,z}` position or `{uuid}`) |
| `GET /tags` | — | `{ "tags": { … } }` — the tag map of the current level |
| `GET /blocks/:name` | — | `{ "name", "properties": [{ "name", "type", "values": [ … ] }] }` — the state properties a block type can have (e.g. `lever`: `face`, `facing`, `powered`), each with all its values, written as in the `properties` of `nearbyBlocks` (booleans as booleans, the rest as strings). `404` for an unknown block name |
| `POST /reset` | — | rebuilds the **most recently built** level and returns its `tags` |
| `POST /action` | an action object (see below) | `{ "name", "result", "passed" }` — runs the action **synchronously** and returns its boolean `result` (or `null` for actions with no result) and whether it matched `expect_result` |

Notes:

- `POST /action` is **synchronous**: it waits for the action to finish and returns the outcome in the same response. While an action is in flight the bot is busy and further `POST /action` / `POST /reset` calls get **HTTP 409** `{ "status": "busy" }`. Invalid action JSON returns **HTTP 400**; an action that throws returns **HTTP 500** with `{ "name", "error", "result": null, "passed": false }`.
- The action object is exactly one of the entries described in [actions](#actions): a `name` plus its parameters. A **location** is given via a `target` field that is *either* a tag string (resolved against the current level's tag map) *or* an explicit `{ "x", "y", "z" }` object. (`attack` and `check_entity` take `target` as a plain string — a tag or a raw entity UUID.)
- Action names: `move_to`, `break`, `place`, `click`, `select`, `attack`, `sneak`, `pick_up_loot`, `anvil`, `wait`, `check_block`, `check_entity`, `check_inventory`, and the no-ops `pass` / `fail`.

### Testing the server with curl

Start the server (server mode) first, then from another terminal:

```bash
# 1. Observe the world (position, health, inventory, nearby blocks/entities)
curl -s http://localhost:3000/status | jq

# 2. Build a level; the response contains the tag map for the placed blocks/entities
curl -s -X POST http://localhost:3000/build-level \
  -H 'Content-Type: application/json' \
  -d '{"level_csv":"examples/wood-corners.csv","x":0,"y":65,"z":0}' | jq

# 3. List the current tags
curl -s http://localhost:3000/tags | jq

# 4. Move to a block by explicit coordinates (target is an {x,y,z} object)
curl -s -X POST http://localhost:3000/action \
  -H 'Content-Type: application/json' \
  -d '{"name":"move_to","target":{"x":0,"y":66,"z":0},"distance":2}'
# -> {"name":"move_to","result":true,"passed":true}

# 5. Check the block at those coordinates is the expected one
curl -s -X POST http://localhost:3000/action \
  -H 'Content-Type: application/json' \
  -d '{"name":"check_block","target":{"x":0,"y":66,"z":0},"expected":"oak_log"}'
# -> {"name":"check_block","result":true,"passed":true}

# 6. Build a level with a target with a tag
curl -s -X POST http://localhost:3000/build-level \
  -H 'Content-Type: application/json' \
  -d '{"level_csv":"examples/anvil-test.csv","x":0,"y":65,"z":0}' | jq

# 7. Move to a target addressed by its tag instead of coordinates
curl -s -X POST http://localhost:3000/action \
  -H 'Content-Type: application/json' \
  -d '{"name":"move_to","target":"anvil"}'

# 8. Select an item into the main hand
curl -s -X POST http://localhost:3000/action \
  -H 'Content-Type: application/json' \
  -d '{"name":"select","item":"iron_helmet"}'

# 9. Check the inventory holds a given item (optionally an exact count)
curl -s -X POST http://localhost:3000/action \
  -H 'Content-Type: application/json' \
  -d '{"name":"check_inventory","item":" iron_ingot","count":1}'

# 10. Rebuild the current level from scratch
curl -s -X POST http://localhost:3000/reset | jq
```

## Level format
The levels are defined in a `.csv` file format, every cell can be an item, entity or block. 

A sample *test.csv* file is provided to show how a simple level might be designed. 

### Inventory

The first row of the file is always assumed to be the hotbar, and as such the first 9 items will be loaded into bot in the corresponding slots.

The following rows before the structure section are treated as the rest of the bot's inventory. Items can be layed out in rows or columns as you please and will simply fill the inventory from the top left slot on.

The format of items both in the hotbar is the same as in the `/give command`:

`item_id[components] <count>`

For example:

`iron_ingot 64`

`iron_pickaxe[damage=140]`

`minecraft:cake`

are all valid examples, the namespace can be omitted, as well as the components or the count, which is assumed to be 1 unless specified.

### Init commands
Commands can also be run by the bot before starting the test, these are inserted after the hotbar section and are identified by beginning with a `/`. They can be used to for example provide the bot with experience points to test anvil usage.

Since they are read after the hotbar, if no hotbar items are provided, a blank line must be left at the top of the csv for these commands to be executed.

Just like for the inventory section, you can put commands either all in the same line or multiple lines, there is no set format.
Commands are read alongside the inventory, so they can be mixed in with inventory items, but it's not reccommended for readability.

### Structure
A structure has to also be defined in the file. This will be generated at the coordinates decided at runtime and will be constructed inside a Barrier block cage with the minimum size to fit the structure, and height being 3 blocks minimum. Every block and entity inside the bounding box will be deleted. This can be increased by adding empty rows and columns. 

The beginning of the structure section is marked by having a `|` "*pipe*" symbol at the beginning of the line. This symbol will also be used to separate layers of the structure in the y direction, similar as to how it's implemented in [LabRecruits](https://github.com/iv4xr-project/labrecruits/wiki/Defining-a-level). 

When looking at a single layer from above, the top of the csv is North (the z- direction in the in-game axis) 

#### Blocks
The format for blocks is the same as for the in-game `/setblock` command:

`block_id[blockstate]{NBT}`

For example:

`minecraft:iron_block`

`piston[facing=south]`

`hopper{Items:[{Slot:0b,id:"minecraft:stone",count:1}]}`

*NOTE: some blocks that require top or side support might not be spawned in successfully in some situations due to how the level is built from bottom to top. This has not been tested for all blocks in all positions.* 

##### Deferred block placement
To avoid the previously stated limitation, a simple workaround was included, which is block placement defferal. By prepending a `!` question mark to the block definiton, that specific block will be placed after 100ms, which is usually enough to guarantee any supporting blocks are already placed 

For example:

`!rail`

`!minecraft:lantern[hanging=true]`


#### Entities
Entities are maked by starting with an `@` symbol and use the following format:

`@entity_id{NBT}`

For example:

`@minecraft:bee{NoAI:1b}`

`@pig`

`@minecraft:armor_stand`

Note that there is also a specific case for the player `@player` where if instead of a valid entity id we put the 'player', that position will be where the agent spawns in, regardless of the name of the agent. 

#### Tags/IDs
To simplify dealing with coordinates and entity selectors, a tagging system similar to the one used in [LabRecruits](https://github.com/iv4xr-project/labrecruits/wiki/Defining-a-level) has been implemented. Using the `^` symbol at the end of any block or entity definition will cause anything following it to become a tag of the preceding block or entity. You can also tag an empty air block by omiting anything before the symbol.

Examples:

`@bee^mob1`

`chest[facing=south]{Items:[{Slot:0b,id:"minecraft:stone",count:1}]}^chest`

`minecraft:clay^foobar`

`^location_tag`

Note that player entities are excluded `@player^agent` will fail to even place the agent

## Test file format
The test format is .json, it's divided at the top layer into two sections: meta and test_cases, which will be explained separately.
### meta
This section contains parameters such as the level path, the position and other information that will be used in place of command line args. Note that if a conflicting command line argument is present, it will override the one present in the meta section.

The following are the supported tags in the meta sextion. Note that some are optional.

- **id**: an id for the current test suite, can be any string.
- **time**: an ISO8601 compliant datetime stamp of when the file was generated.
-----------------------
- **x**: The x, y and z coordinates where the test level will be loaded at.
- **y**: note that y is optional and will default to 65 unless specified
- **z**
- **username**: the username of the bot, optional.
- **address**: the address of the server, optional.
- **level_csv**: the path to the level file in the json format described in [Level Format](#level-format)
- **output_csv**: the output file for the test results, optional.

### test_cases
Test cases is an array of test cases where each of them is comprised of an **id**, and an array of **actions** that compose the test case.

### actions
actions are used inside test cases to tell the bot what to do. They all start with a **name** parameter, and can have a variety of parameters depending on the name. The same action objects are accepted by the `POST /action` endpoint of the [HTTP API server](#http-api-server).

Common parameters:

- **name**: the action to perform (required). One of: `move_to`, `break`, `place`, `click`, `select`, `attack`, `sneak`, `pick_up_loot`, `anvil`, `wait`, `check_block`, `check_entity`, `check_inventory`, `pass`, `fail`.
- **expect_result**: the boolean outcome you expect from the action. In batch test mode a test case fails if the actual result differs; for `check_*` actions it defaults to `true`.
- **verbose**: if `true`, logs extra diagnostic info while the action runs.

**Specifying a location** (for `move_to`, `break`, `place`, `click`, `check_block`, `anvil`): use a single **`target`** field that is *either* a tag string (defined in the level with `^`, resolved against the current tag map) *or* an explicit coordinate object `{ "x": …, "y": …, "z": … }`. For example `"target": "chest"` or `"target": {"x": 0, "y": 66, "z": 0}`. (`attack` and `check_entity` take `target` as a plain string — a tag or a raw entity UUID.)

Some action-specific parameters: `move_to` accepts an optional `distance` (how close to get); `select` takes `item`; `wait` takes `ticks`; `place` takes `face`; `anvil` takes `item_one`/`item_two`/`custom_name`; `check_block` takes `expected` (and optional `nbt`); `check_inventory` takes `item` (and optional `count`/`damage`/`custom_name`); `check_entity` takes optional `nbt`/`health`.