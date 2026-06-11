# @openattribution/telemetry

TypeScript/JavaScript SDK for the [Content Telemetry](https://github.com/SPUR-Coalition/telemetry) standard — track content attribution in AI agent interactions.

SDK versions track the standard: 0.1.x implements Content Telemetry 0.1.

Works in Node.js >= 18, Deno, browsers, and Edge runtimes (Vercel, Cloudflare Workers). Zero runtime dependencies.

## Install

```bash
npm install @openattribution/telemetry
# or
pnpm add @openattribution/telemetry
# or
yarn add @openattribution/telemetry
```

## Quick start

```ts
import { TelemetryClient } from "@openattribution/telemetry";

const client = new TelemetryClient({
  endpoint: "https://your-telemetry-server.com",
  apiKey: process.env.TELEMETRY_API_KEY,
  failSilently: true, // recommended — never let telemetry break your app
});

const sessionId = await client.startSession({
  contentScope: "my-agent",
  externalSessionId: "conv-abc123", // link to your own session/conversation ID
});

await client.recordEvents(sessionId, [
  {
    id: crypto.randomUUID(),
    type: "content_retrieved",
    timestamp: new Date().toISOString(),
    contentUrl: "https://wirecutter.com/reviews/best-headphones",
  },
  {
    id: crypto.randomUUID(),
    type: "content_cited",
    timestamp: new Date().toISOString(),
    contentUrl: "https://wirecutter.com/reviews/best-headphones",
    data: { citation_type: "paraphrase", position: "primary" },
  },
]);

await client.endSession(sessionId, { type: "browse" });
```

## MCP agents

MCP tool calls are stateless — each invocation is independent. `MCPSessionTracker` solves this by maintaining an in-process session registry keyed on a caller-supplied `session_id` string, so multiple tool calls in the same conversation chain into one telemetry session.

```ts
import { TelemetryClient, MCPSessionTracker, extractResultUrls } from "@openattribution/telemetry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const client = new TelemetryClient({
  endpoint: process.env.TELEMETRY_ENDPOINT!,
  apiKey: process.env.TELEMETRY_API_KEY,
  failSilently: true,
});

const tracker = new MCPSessionTracker(client, "my-shopping-agent");

const server = new McpServer({ name: "my-agent", version: "1.0.0" });

server.tool(
  "search_products",
  {
    query: z.string().describe("What to search for"),
    sessionId: z.string().optional().describe(
      "Pass a stable conversation ID to link tool calls into one session"
    ),
  },
  async ({ query, sessionId }) => {
    const products = await myProductSearch(query);

    // Fire telemetry in background — never blocks the tool response
    void tracker.trackRetrieved(sessionId, extractResultUrls(products));

    return { content: [{ type: "text", text: formatProducts(products) }] };
  }
);
```

## Next.js / Vercel AI SDK

Track web search citations from AI responses:

```ts
// app/api/chat/route.ts
import { streamText } from "ai";
import { TelemetryClient, MCPSessionTracker, extractCitationUrls } from "@openattribution/telemetry";

const client = new TelemetryClient({
  endpoint: process.env.TELEMETRY_ENDPOINT!,
  apiKey: process.env.TELEMETRY_API_KEY,
  failSilently: true,
});
const tracker = new MCPSessionTracker(client, "my-chat-agent");

export async function POST(req: Request) {
  const { messages, sessionId } = await req.json();

  const result = streamText({
    model: openrouter("openai/gpt-4.1-nano:online"),
    messages,
    onFinish: async ({ text }) => {
      const citedUrls = extractCitationUrls(text);
      if (citedUrls.length > 0) {
        void tracker.trackCited(sessionId, citedUrls, {
          citationType: "reference",
          position: "supporting",
        });
      }
    },
  });

  return result.toDataStreamResponse();
}
```

## Commerce protocol bridges

### ACP checkout integration

```ts
import { sessionToContentAttribution } from "@openattribution/telemetry";

const attribution = sessionToContentAttribution(session);

await acpClient.createCheckout({
  cart: { ... },
  content_attribution: attribution,
});
```

### UCP checkout integration

```ts
import { sessionToAttribution } from "@openattribution/telemetry";

const attribution = sessionToAttribution(session);

await ucpClient.completeCheckout({
  order: { ... },
  extensions: {
    "org.openattribution.telemetry": attribution,
  },
});
```

## Tracking the full funnel

```ts
await tracker.trackRetrieved(sessionId, productUrls);
await tracker.trackCited(sessionId, citedUrls, { citationType: "reference" });
await tracker.trackEngaged(sessionId, [clickedUrl], { interactionType: "click" });
await tracker.trackCheckout(sessionId, { type: "completed", valueAmount: 4999, currency: "USD" });
```

## Click tracking with redirect endpoint

```ts
import { createTrackingUrl } from "@openattribution/telemetry";

const trackedUrl = createTrackingUrl("https://shop.example.com/product/123", {
  endpoint: "https://myagent.com/api/track",
  sessionId: "conv-abc123",
});

// Next.js redirect handler (app/api/track/route.ts)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  const sessionId = searchParams.get("session_id") ?? undefined;
  if (!url) return new Response("Missing url", { status: 400 });
  void tracker.trackEngaged(sessionId, [url], { interactionType: "click" });
  return Response.redirect(url, 302);
}
```

## Extraction utilities

```ts
import { extractCitationUrls, extractIndexedCitations, extractResultUrls } from "@openattribution/telemetry";

// Extract URLs from Markdown links and bare URLs
const urls = extractCitationUrls(assistantMessage);

// Resolve [n] citation markers
const sources = ["https://guardian.com/article-1", "https://guardian.com/article-2"];
const cited = extractIndexedCitations("The policy was announced [1].", sources);

// Extract URLs from search result objects
const resultUrls = extractResultUrls(searchResults);
```

## Specification

The Content Telemetry standard is stewarded by the SPUR Coalition: [SPUR-Coalition/telemetry](https://github.com/SPUR-Coalition/telemetry). Schemas resolve at [contenttelemetry.org](https://contenttelemetry.org).

This SDK vendors a copy of `schema.json` for reference.

## Licence

Apache 2.0 — see [LICENSE](./LICENSE).
