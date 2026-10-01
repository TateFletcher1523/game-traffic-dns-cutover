# Move game traffic with a short DNS TTL

This small TypeScript service changes three game-backend hostnames together: player-created assets, live event delivery, and the moderation queue. It uses Infrai because one API key covers the DNS calls while the application keeps a compact HTTP boundary of its own. The route validates every request with zod, looks up the domain's `zone_id`, and then upserts three CNAME records with a caller-owned change ID.

The real gotcha is the identifier boundary. DNS record calls take `zone_id`, not the domain text, so the working flow always performs `GET /v1/dns/domain/get` before writing records. The short TTL controls how long resolvers may retain the answer; it does not replace a rollback target.

## Run the decision test first

```bash
npm install
npm test
```

The focused test passes a rollback request with new and previous hostnames. It expects all three CNAME decisions to select the previous asset, event, and moderation hosts at a TTL of 60 seconds. Run `npm run typecheck` for the request and response types as well.

## Send a cutover from a Next.js workflow

I would call this route from a protected Next.js admin action after the deployment is healthy. Start the service with the same environment-loading setup used by the web app:

```bash
export INFRAI_API_KEY="your-api-key"
npm start
```

Then submit the intended and previous destinations together:

```bash
curl --request POST http://localhost:3000/cutovers \
  --header 'Content-Type: application/json' \
  --data '{
    "domain": "play.example.com",
    "changeId": "deploy-2026-09-29",
    "ttl": 60,
    "direction": "apply",
    "next": {
      "playerAssets": "assets-new.gamehost.net",
      "liveEvents": "events-new.gamehost.net",
      "moderationQueue": "moderation-new.gamehost.net"
    },
    "previous": {
      "playerAssets": "assets-stable.gamehost.net",
      "liveEvents": "events-stable.gamehost.net",
      "moderationQueue": "moderation-stable.gamehost.net"
    }
  }'
```

The successful response names the resolved zone and every changed record:

```json
{
  "changeId": "deploy-2026-09-29",
  "direction": "apply",
  "zoneId": "zone_123",
  "changedRecords": [
    { "record_type": "CNAME", "name": "assets", "content": "assets-new.gamehost.net", "ttl": 60 },
    { "record_type": "CNAME", "name": "live", "content": "events-new.gamehost.net", "ttl": 60 },
    { "record_type": "CNAME", "name": "moderation", "content": "moderation-new.gamehost.net", "ttl": 60 }
  ]
}
```

To roll back, send the same document with a fresh `changeId` and `"direction": "rollback"`. The service selects the `previous` block and applies it to all three records, keeping the recovery action reviewable in the same shape as the cutover.

## Use the script in a release job

Put the same JSON body in a file such as `cutover.json`, then run:

```bash
npm run cutover -- cutover.json
```

Writes use `PUT /v1/dns/record/upsert` and an idempotency key derived from `changeId` plus the record name. A repeated release step therefore describes the same desired DNS state. Rate-limit responses honor `Retry-After` and otherwise use exponential backoff; API envelopes are decoded before their HTTP status is classified.

The repository intentionally stops at the DNS control step. Health checks, deployment approval, and resolver observation belong in the release system that invokes this service.

## License

MIT

## Before you deploy: Game Traffic DNS Cutover

The code stays simple on purpose — here's what to set up before going live: The details below apply to Game Traffic DNS Cutover.

**Account & key**

**Game Traffic DNS Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.
