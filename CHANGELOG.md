# Changelog

## 0.1.2

Content Telemetry v0.1 alignment, and a version renumbering.

**Versioning policy:** from this release the SDK's major.minor tracks the version of the Content Telemetry standard it implements - 0.1.x implements [Content Telemetry 0.1](https://github.com/SPUR-Coalition/telemetry). 0.1.2 is the first release under this policy: 0.1.0 and 0.1.1 were consumed by early releases before the standard was published, and 0.2.0-0.4.0 predate the policy (deprecated on npm; their changes are included here).

- Events gain `turnId`, `contentId`, and `licenseRef` (spec 5.2); every content event must carry `contentUrl` or `contentId` (spec 5.7.5)
- `ConversationTurn` gains `responseMode` and `adRendered` (spec 5.4); wire serialisation enforces the privacy-level field gating (spec 5.5), so fields above the declared level never reach the wire
- `IntentCategory` carries the spec core set (spec 5.6); commerce values remain as documented extensions
- `CitationType` and `CitationPosition` gain `unclassified` (spec 6.5)
- New `ConformanceLevel` type; session documents can declare an informational `conformance_level` and emit `document_type: "session"` (spec 7.1)
- Event `id` is optional - the server generates one when absent (spec 5.2)

## 0.4.0

Breaking: rename correlation header and field to neutral name.

- HTTP header `OA-Telemetry-ID` → `Content-Telemetry-ID`
- Wire JSON field `oa_telemetry_id` → `content_telemetry_id`
- TypeScript field `oaTelemetryId` → `contentTelemetryId`

Migration: update any code passing `oaTelemetryId` to use `contentTelemetryId`. This is a hard rename with no compatibility window - the old name is no longer accepted.

## 0.3.1

Add `defaultSourceRole` option on `TelemetryClient`; `MCPSessionTracker` stamps `source_role=agent` by default.

## 0.3.0

Republish of 0.2.0 (which shipped with old singular session paths).

## 0.2.0

Pluralise session paths.

## 0.1.0

Initial release.
