import { prepareDatabaseFromApp } from "@jskit-ai/database-runtime/server/databaseSetup";
import { loadEnvFile } from "../server/lib/envFile.js";

loadEnvFile();

await prepareDatabaseFromApp({ client: "pg", environment: process.env });
