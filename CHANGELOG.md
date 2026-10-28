# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Project hygiene: LICENSE, CONTRIBUTING, EditorConfig, `.nvmrc`, lint/format tooling and CI.
- Unit tests for `ToolRegistry`.

## [1.0.0]

### Added

- `ToolRegistry` with Zod and JSON Schema (Draft-07 subset) validation and OpenAI-style tool export.
- `AgentRuntime` multi-turn loop with parallel tool dispatch, timeouts, retries and hooks.
- `CircuitBreaker`, retry with exponential backoff and jitter, middleware pipeline
  (timing, cache, rate limit), `ToolPlanDAG`, `PlanningAgent` and `TelemetryCollector`.
