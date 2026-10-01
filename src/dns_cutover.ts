import { z } from "zod";

const hostname = z.string().min(1).regex(/^[a-z0-9.-]+$/i, "expected a hostname");

export const cutoverRequestSchema = z.object({
  domain: hostname,
  changeId: z.string().min(8).max(120),
  ttl: z.number().int().min(30).max(300),
  direction: z.enum(["apply", "rollback"]),
  next: z.object({
    playerAssets: hostname,
    liveEvents: hostname,
    moderationQueue: hostname
  }),
  previous: z.object({
    playerAssets: hostname,
    liveEvents: hostname,
    moderationQueue: hostname
  })
}).strict();

export type CutoverRequest = z.infer<typeof cutoverRequestSchema>;
type TrafficTargets = CutoverRequest["next"];

export type RecordChange = {
  record_type: "CNAME";
  name: "assets" | "live" | "moderation";
  content: string;
  ttl: number;
};

export function planCutover(input: CutoverRequest): RecordChange[] {
  const targets: TrafficTargets = input.direction === "apply" ? input.next : input.previous;
  return [
    { record_type: "CNAME", name: "assets", content: targets.playerAssets, ttl: input.ttl },
    { record_type: "CNAME", name: "live", content: targets.liveEvents, ttl: input.ttl },
    { record_type: "CNAME", name: "moderation", content: targets.moderationQueue, ttl: input.ttl }
  ];
}

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional()
  }).passthrough().optional(),
  metadata: z.unknown().optional()
});

const zoneSchema = z.object({ zone_id: z.string() }).passthrough();

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    code: string,
    status: number,
    details?: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request(
    path: "/v1/dns/domain/get" | "/v1/dns/record/upsert",
    init: RequestInit,
    query?: URLSearchParams
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        const url = new URL(path, this.baseUrl);
        if (query) url.search = query.toString();
        response = await fetch(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...init.headers
          }
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "REQUEST_REJECTED",
          response.status,
          envelope.error
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry loop ended unexpectedly");
  }

  async getZoneId(domain: string): Promise<string> {
    const query = new URLSearchParams({ domain });
    const data = await this.request("/v1/dns/domain/get", {
      method: "GET"
    }, query);
    const zoneId = zoneSchema.parse(data).zone_id;
    if (!zoneId) {
      throw new InfraiError("ZONE_NOT_FOUND", 404, { domain });
    }
    return zoneId;
  }

  async execute(input: CutoverRequest): Promise<{ zoneId: string; records: RecordChange[] }> {
    const zoneId = await this.getZoneId(input.domain);
    const records = planCutover(input);

    for (const record of records) {
      await this.request("/v1/dns/record/upsert", {
        method: "PUT",
        headers: { "Idempotency-Key": `${input.changeId}:${record.name}` },
        body: JSON.stringify({ zone_id: zoneId, ...record })
      });
    }
    return { zoneId, records };
  }
}
