---
name: ui-data-and-status
description: "Specify trustworthy collections, grids, details, charts, monitoring, filtering and loading/error states."
license: "Internal use subject to company approval"
---
# ui-data-and-status

## Scope
Specify trustworthy collections, grids, details, charts, monitoring, filtering and loading/error states. Use only when the current UI task materially requires this skill. This package is a candidate implementation, not a signed organizational grant or proven source-level UI result.

## Source of truth
Work within the **separate** existing Golden Engineering Standard, trusted company/repository controls, and the approved project adapter. UI pattern contracts live in `.golden-uiux/data/patterns.json`; normative rationale and seven P0/P1 corrections are in `.golden-uiux/source_spec`. If files are missing, do not reconstruct rules from memory. All applicable mandatory rules remain in scope even when not loaded into the model context.

## Procedure
1. Use P02/P03/P07/P08/P09 where applicable. Determine whether data should be a semantic table, composite grid, chart or record detail based on task and keyboard interaction.
2. For metrics identify unit, denominator, aggregation, time range, uncertainty, owner and freshness; do not invent values or hide misleading scale truncation.
3. For records verify permission-aware selection, sort/filter/pagination semantics, hidden selection and virtualized focus before specifying bulk actions.
4. For status distinguish healthy, warning, critical, stale, unknown, acknowledged and disconnected without relying only on color.
5. Distinguish 403 denial, source empty, filtered no results, partial result and unavailable service. Retry only safely idempotent operations.
6. Provide acceptance probes for edge values, broken network, screen readers, keyboard, stale data and changed/expired authorization.

## Escalation boundary
Do not invent a chart or safety-critical indicator when the metric or escalation owner is unknown.

## Required output
Return compact, auditable information: pattern IDs, source/profile/catalog versions, proposed approved component choices, state matrix, accessibility and geometry requirements, acceptance probes, exact proof and authorization statuses, and minimal next safe action.

## Never claim
No invented independent test PASS, legal certification, human review, actual Git publication, approved company policy, or guaranteed perfection. A read-only MCP cannot grant or exercise file/Git privileges. Use the separate authorized engineering workflow for changes.

## v0.2.6 experimental G2 route verification

For G2, use a backend-generated OpenAPI document from the actual backend route table/source. Include it as `openapi_document` in the G2 evaluator input; a manually duplicated `server_route` alone is not sufficient. The `golden-uiux api-contract` checker verifies exact method and path, documented query parameters and types, required parameters, authentication declaration, expected response status/schema, and request schema when provided. Trailing slash variants are not normalized. Unsupported schema constructs are BLOCKED. A static backend-route PASS is not an observed request PASS; `evaluate-gates` also needs source-bound request/response evidence and identity.
