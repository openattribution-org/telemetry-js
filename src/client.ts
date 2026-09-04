/**
 * Content Telemetry — HTTP client.
 *
 * Zero dependencies — uses native fetch (Node 18+, Deno, browsers, Edge).
 */

import type {
  ConversationTurn,
  EventType,
  Initiator,
  SessionOutcome,
  SourceRole,
  StartSessionOptions,
  TelemetryClientOptions,
  TelemetryEvent,
  TelemetrySession,
  UserContext,
} from "./types.js";

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Content Telemetry schema version emitted on wire documents (spec 7.1). */
const SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Wire format helpers (camelCase → snake_case for the JSON body)
// ---------------------------------------------------------------------------

function turnToWire(turn: ConversationTurn): Record<string, unknown> {
  // An emitter MUST NOT include a field above the turn's declared
  // privacy_level (spec 5.5): query/response text is gated to full and
  // summary; intent, topics, response classification and platform
  // metadata are gated above minimal. Stripping here keeps a privacy
  // violation from ever reaching the wire. A missing level (possible
  // from untyped JS callers) fails closed to minimal.
  const level = turn.privacyLevel;
  const textAllowed = level === "full" || level === "summary";
  const aboveMinimal = textAllowed || level === "intent";
  return {
    // An absent or unrecognised level already strips as minimal above;
    // the wire value must follow, since privacy_level is required and
    // closed-enum on ConversationTurn.
    privacy_level: aboveMinimal || level === "minimal" ? level : "minimal",
    query_text: textAllowed ? turn.queryText : undefined,
    response_text: textAllowed ? turn.responseText : undefined,
    query_intent: aboveMinimal ? turn.queryIntent : undefined,
    response_type: aboveMinimal ? turn.responseType : undefined,
    response_mode: aboveMinimal ? turn.responseMode : undefined,
    topics: aboveMinimal ? turn.topics : undefined,
    ad_rendered: aboveMinimal ? turn.adRendered : undefined,
    content_urls_retrieved: turn.contentUrlsRetrieved,
    content_urls_cited: turn.contentUrlsCited,
    query_tokens: turn.queryTokens,
    response_tokens: turn.responseTokens,
    model_id: aboveMinimal ? turn.modelId : undefined,
  };
}

function eventToWire(event: TelemetryEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    source_role: event.sourceRole,
    turn_id: event.turnId,
    content_telemetry_id: event.contentTelemetryId,
    content_url: event.contentUrl,
    content_id: event.contentId,
    license_ref: event.licenseRef,
    output_id: event.outputId,
    output_element_id: event.outputElementId,
    citation_id: event.citationId,
    presentation_id: event.presentationId,
    ctx_token: event.ctxToken,
    product_id: event.productId,
    turn: event.turn != null ? turnToWire(event.turn) : undefined,
    data: event.data ?? {},
  };
}

function initiatorToWire(i: Initiator): Record<string, unknown> {
  return {
    agent_id: i.agentId,
    manifest_ref: i.manifestRef,
    operator_id: i.operatorId,
  };
}

function userContextToWire(uc: UserContext): Record<string, unknown> {
  return {
    external_id: uc.externalId,
    segments: uc.segments ?? [],
    attributes: uc.attributes ?? {},
  };
}

function outcomeToWire(o: SessionOutcome): Record<string, unknown> {
  return {
    type: o.type,
    value_amount: o.valueAmount ?? 0,
    currency: o.currency ?? "USD",
    products: o.products ?? [],
    metadata: o.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// TelemetryClient
// ---------------------------------------------------------------------------

/**
 * Async client for recording Content Telemetry sessions and events.
 *
 * Works in Node.js ≥ 18, Deno, browsers, and Edge runtimes (Vercel, Cloudflare).
 *
 * @example
 * ```ts
 * const client = new TelemetryClient({
 *   endpoint: "https://telemetry.example.com",
 *   apiKey: "your-api-key",
 *   failSilently: true,
 * });
 *
 * const sessionId = await client.startSession({ contentScope: "my-mix" });
 *
 * await client.recordEvents(sessionId, [
 *   { id: crypto.randomUUID(), type: "content_retrieved",
 *     timestamp: new Date().toISOString(), contentUrl: "https://..." }
 * ]);
 *
 * await client.endSession(sessionId, { type: "browse" });
 * ```
 */
export class TelemetryClient {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly failSilently: boolean;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly defaultSourceRole: SourceRole | undefined;

  constructor(options: TelemetryClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.failSilently = options.failSilently ?? true;
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultSourceRole = options.defaultSourceRole;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey != null) h["X-API-Key"] = this.apiKey;
    return h;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (TRANSIENT_STATUS_CODES.has(res.status) && attempt < this.maxRetries) {
          const wait = 2 ** attempt * 1000 + Math.random() * 500;
          await sleep(wait);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
        }

        return await res.json();
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries && isTransientError(err)) {
          const wait = 2 ** attempt * 1000 + Math.random() * 500;
          await sleep(wait);
        } else {
          break;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (this.failSilently) {
      return null;
    }
    throw lastError;
  }

  /**
   * Start a new telemetry session.
   *
   * @returns Session ID string, or null on silent failure.
   */
  async startSession(options: StartSessionOptions = {}): Promise<string | null> {
    const result = await this.post("/sessions/start", {
      initiator_type: options.initiatorType,
      initiator:
        options.initiator != null ? initiatorToWire(options.initiator) : undefined,
      content_scope: options.contentScope,
      agent_id: options.agentId,
      external_session_id: options.externalSessionId,
      user_context:
        options.userContext != null
          ? userContextToWire(options.userContext)
          : {},
      manifest_ref: options.manifestRef,
      prior_session_ids: options.priorSessionIds ?? [],
    }) as { session_id?: string } | null;

    return result?.session_id ?? null;
  }

  /**
   * Record a single telemetry event.
   *
   * A UUID `id` is generated when the caller does not supply one, so
   * `content_cited` and `content_presented` events always carry the `id`
   * v1 requires (spec 6.5, 6.6). The generated id is returned so callers
   * can wire it into later events (`citation_id`, `presentation_id`).
   *
   * @returns The event's id, or null when no session is active.
   */
  async recordEvent(
    sessionId: string | null,
    eventType: EventType,
    options: Omit<TelemetryEvent, "type" | "timestamp"> & {
      timestamp?: string;
    } = {},
  ): Promise<string | null> {
    if (sessionId == null) return null;
    const id = options.id ?? crypto.randomUUID();
    await this.recordEvents(sessionId, [
      {
        timestamp: new Date().toISOString(),
        ...options,
        id,
        type: eventType,
      },
    ]);
    return id;
  }

  /**
   * Record a batch of telemetry events.
   */
  async recordEvents(
    sessionId: string | null,
    events: TelemetryEvent[],
  ): Promise<void> {
    if (sessionId == null || events.length === 0) return;
    const defaultRole = this.defaultSourceRole;
    const stamped = defaultRole
      ? events.map((e) =>
          e.sourceRole == null ? { ...e, sourceRole: defaultRole } : e,
        )
      : events;
    await this.post("/events", {
      document_type: "event_batch",
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      events: stamped.map(eventToWire),
    });
  }

  /**
   * Record a standalone event envelope (spec 7.1) - a single event with
   * no session context, or one carried by a `ctx_token` instead of a
   * session. This is the delivery format for origin- and edge-side
   * emitters observing a fetch, and for destination-reported click-out
   * engagements.
   *
   * At Grounding conformance and above the envelope must carry
   * `sessionId` (or `ctxToken` for click-out engagements) together with
   * `agentId` and `startedAt` (spec 5.7.2); a session-less origin or
   * edge retrieval omits all three.
   */
  async recordStandaloneEvent(
    event: TelemetryEvent,
    envelope: {
      sessionId?: string;
      ctxToken?: string;
      agentId?: string;
      startedAt?: string;
    } = {},
  ): Promise<void> {
    const defaultRole = this.defaultSourceRole;
    const stamped =
      event.sourceRole == null && defaultRole != null
        ? { ...event, sourceRole: defaultRole }
        : event;
    await this.post("/events", {
      document_type: "event",
      schema_version: SCHEMA_VERSION,
      session_id: envelope.sessionId,
      ctx_token: envelope.ctxToken,
      agent_id: envelope.agentId,
      started_at: envelope.startedAt,
      event: eventToWire(stamped),
    });
  }

  /**
   * End a session with an outcome.
   */
  async endSession(
    sessionId: string | null,
    outcome: SessionOutcome,
  ): Promise<void> {
    if (sessionId == null) return;
    await this.post("/sessions/end", {
      session_id: sessionId,
      outcome: outcomeToWire(outcome),
    });
  }

  /**
   * Upload a complete session in one request (bulk path).
   *
   * Useful for post-hoc reporting or when you've built the session
   * locally and want to submit it in one shot.
   *
   * @returns Server-assigned session ID, or null on silent failure.
   */
  async uploadSession(session: TelemetrySession): Promise<string | null> {
    const result = await this.post("/sessions/bulk", sessionToWire(session)) as
      | { session_id?: string }
      | null;
    return result?.session_id ?? null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    // AbortError (timeout), network errors
    return (
      err.name === "AbortError" ||
      err.name === "TypeError" ||
      err.message.includes("fetch")
    );
  }
  return false;
}

function sessionToWire(session: TelemetrySession): Record<string, unknown> {
  return {
    document_type: session.documentType ?? "session",
    schema_version: session.schemaVersion ?? SCHEMA_VERSION,
    session_id: session.sessionId,
    conformance_level: session.conformanceLevel,
    initiator_type: session.initiatorType,
    initiator:
      session.initiator != null ? initiatorToWire(session.initiator) : undefined,
    agent_id: session.agentId,
    content_scope: session.contentScope,
    manifest_ref: session.manifestRef,
    prior_session_ids: session.priorSessionIds ?? [],
    started_at: session.startedAt,
    ended_at: session.endedAt,
    user_context:
      session.userContext != null
        ? userContextToWire(session.userContext)
        : {},
    events: session.events.map(eventToWire),
    outcome:
      session.outcome != null ? outcomeToWire(session.outcome) : undefined,
    data: session.data,
  };
}
