import { filesHandles, startFilesServer } from "./filesServer.mjs";
import { requestContextOptions } from "./requestContextOptions.mjs";
import { connectTestDatabase } from "./testDatabase.mjs";

// A server of its own, for fileMoves.integration.js: an owner chooses other storage for a home here, so this server
// claims the move of its files and runs it, until the test kills it with its rclone (as a server's whole process group
// goes when it dies). It says "started" once the move is under way, and runs until it's killed.
const { env, homeId, userId, choice, timing } = JSON.parse(process.argv[2]);
const knex = await connectTestDatabase();
const handles = await filesHandles(knex, { after() {} });
const { storage } = await startFilesServer({ handles, env, timing });
const owner = requestContextOptions({ user: { id: userId }, workspace: { id: homeId, name: "Moving test" }, permissions: ["workspace.settings.update"] });
await storage.choose(homeId, choice, owner);
process.stdout.write("started\n");
