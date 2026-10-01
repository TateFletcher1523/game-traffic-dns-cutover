import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { cutoverRequestSchema, InfraiDnsClient, InfraiError } from "./dns_cutover.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const client = new InfraiDnsClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new RangeError("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/cutovers") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = cutoverRequestSchema.parse(await readJson(request));
    const result = await client.execute(input);
    reply(response, 200, {
      changeId: input.changeId,
      direction: input.direction,
      zoneId: result.zoneId,
      changedRecords: result.records
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof RangeError) {
      reply(response, 400, { error: "Invalid cutover request" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      reply(response, error.status, { error: error.code, details: error.details });
      return;
    }
    reply(response, 502, { error: "DNS change could not be completed" });
  }
});

server.listen(port, () => {
  console.log(`Game traffic cutover service listening on http://localhost:${port}`);
});
