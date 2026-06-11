import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TelemetryClient } from "../client.js"
import type { ConversationTurn } from "../types.js"

// Fresh Response per call — a Response body can only be consumed once.
const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
  Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
)

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const fullTurn = (privacyLevel: ConversationTurn["privacyLevel"]): ConversationTurn => ({
  privacyLevel,
  queryText: "what is the capital of France",
  responseText: "Paris",
  queryIntent: "question",
  topics: ["geography"],
  contentUrlsCited: ["https://example.com/paris"],
  queryTokens: 7,
})

async function sentTurn(turn: ConversationTurn): Promise<Record<string, unknown>> {
  const client = new TelemetryClient({ endpoint: "https://telemetry.test" })
  await client.recordEvent("session-1", "content_cited", { turn })
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
  return body.events[0].turn
}

describe("turn privacy gating on the wire", () => {
  it("includes text fields at full level", async () => {
    const wire = await sentTurn(fullTurn("full"))
    expect(wire.query_text).toBe("what is the capital of France")
    expect(wire.response_text).toBe("Paris")
    expect(wire.query_intent).toBe("question")
  })

  it("strips text but keeps intent fields at intent level", async () => {
    const wire = await sentTurn(fullTurn("intent"))
    expect(wire.query_text).toBeUndefined()
    expect(wire.response_text).toBeUndefined()
    expect(wire.query_intent).toBe("question")
    expect(wire.topics).toEqual(["geography"])
  })

  it("strips everything above minimal at minimal level", async () => {
    const wire = await sentTurn(fullTurn("minimal"))
    expect(wire.query_text).toBeUndefined()
    expect(wire.query_intent).toBeUndefined()
    expect(wire.topics).toBeUndefined()
    expect(wire.content_urls_cited).toEqual(["https://example.com/paris"])
    expect(wire.query_tokens).toBe(7)
  })

  it("fails closed to minimal when privacyLevel is absent (spec 5.4)", async () => {
    // Untyped JS callers can omit the field despite the required type.
    const turn = fullTurn("full") as unknown as Record<string, unknown>
    delete turn.privacyLevel
    const wire = await sentTurn(turn as unknown as ConversationTurn)
    expect(wire.query_text).toBeUndefined()
    expect(wire.response_text).toBeUndefined()
    expect(wire.query_intent).toBeUndefined()
    expect(wire.topics).toBeUndefined()
    expect(wire.content_urls_cited).toEqual(["https://example.com/paris"])
  })
})
