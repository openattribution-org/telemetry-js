# Changelog

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
