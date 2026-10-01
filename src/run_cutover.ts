import { readFile } from "node:fs/promises";
import { cutoverRequestSchema, InfraiDnsClient } from "./dns_cutover.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running a cutover");

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Pass the cutover JSON file path as the first argument");

const input = cutoverRequestSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));
const result = await new InfraiDnsClient(apiKey).execute(input);
console.log(JSON.stringify({ changeId: input.changeId, direction: input.direction, ...result }, null, 2));
