import assert from "node:assert/strict";
import test from "node:test";
import { cutoverRequestSchema, planCutover } from "../src/dns_cutover.ts";

test("rollback sends every game workload to its previous hostname", () => {
  const input = cutoverRequestSchema.parse({
    domain: "play.example.com",
    changeId: "deploy-2026-09-29",
    ttl: 60,
    direction: "rollback",
    next: {
      playerAssets: "assets-new.gamehost.net",
      liveEvents: "events-new.gamehost.net",
      moderationQueue: "moderation-new.gamehost.net"
    },
    previous: {
      playerAssets: "assets-stable.gamehost.net",
      liveEvents: "events-stable.gamehost.net",
      moderationQueue: "moderation-stable.gamehost.net"
    }
  });

  assert.deepEqual(planCutover(input), [
    { record_type: "CNAME", name: "assets", content: "assets-stable.gamehost.net", ttl: 60 },
    { record_type: "CNAME", name: "live", content: "events-stable.gamehost.net", ttl: 60 },
    { record_type: "CNAME", name: "moderation", content: "moderation-stable.gamehost.net", ttl: 60 }
  ]);
});
