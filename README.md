# Agentic Tool Orchestrator 🤖

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Schema Validation](https://img.shields.io/badge/Schema-Zod%20%7C%20JSON%20Schema-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Tested-729B1B?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

An extensible, production-grade **Autonomous LLM Agent Runtime** designed in TypeScript. Features strict runtime schema validation (dual Zod & Draft-07 JSON Schema), parallel tool execution, circuit breakers, jittered exponential backoff, bounded turn-budget controls, and observable multi-turn reasoning loops.

---

## 🏗️ Architecture

```text
User Objective / Multi-turn Prompt
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│             Agent Runtime Orchestrator                 │◄───────────┐
│   (Context Pruning, Turn Budgeting, Lifecycle Hooks)   │            │
└──────────────────────────┬─────────────────────────────┘            │
                           │                                          │
                           ▼                                          │
            ┌─────────────────────────────┐                           │
            │ LLM Generates Tool Call(s)  │                           │
            └──────────────┬──────────────┘                           │
                           │                                          │
                           ▼                                          │
            ┌─────────────────────────────┐                           │
            │  Tool Registry & Validation │ ───► [Invalid Schema] ────┤ Structured Feedback
            │  (Zod & Draft-07 Validator) │                           │
            └──────────────┬──────────────┘                           │
                           │ [Valid Schema]                           │
                           ▼                                          │
            ┌─────────────────────────────┐                           │
            │  Circuit Breaker Protection │ ───► [Open Circuit] ──────┤ Fast Failure Shield
            └──────────────┬──────────────┘                           │
                           │ [Closed/Half-Open]                       │
                           ▼                                          │
            ┌─────────────────────────────┐                           │
            │   Parallel Tool Execution   │ ───► [Result/Error] ──────┘
            │   & Jittered Retry Backoff  │
            └──────────────┬──────────────┘
                           │
                           ▼
                  Final Resolution
```

---

## ✨ Features

- 🛡️ **Dual Schema Validation**: Native parameter enforcement supporting both **Zod** and **Draft-07 JSON Schema** with clear path-based error tracking.
- ⚡ **Parallel Tool Dispatch**: Executes multiple tool calls simultaneously within a single assistant turn (`Promise.allSettled`) to reduce end-to-end latency.
- 🔌 **Circuit Breaker Resilience**: Integrates stateful circuit breakers (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN`) to shield downstream third-party APIs from cascading failure.
- 🔁 **Exponential Backoff with Jitter**: Configurable delay curves with `none`, `full`, and `equal` jitter to eliminate thundering herd problems.
- 🧭 **Lifecycle Observability**: Hooks for `onStepStart`, `onToolStart`, `onToolEnd`, and `onError` for real-time telemetry and auditing.
- 🗂️ **OpenAI Tool Export**: Instantly transform registered tools into standard OpenAI / Anthropic function calling specifications via `toOpenAITools()`.
- 🧪 **100% Vitest Coverage**: Battle-tested against multi-turn workflows, timeout race conditions, and circuit trips.

---

## 🚀 Quick Start

```typescript
import { ToolRegistry, AgentRuntime, CircuitBreaker } from "@aqib/agentic-tool-orchestrator";
import { z } from "zod";

const registry = new ToolRegistry();

// 1. Register a Type-Safe Tool with Circuit Breaker
registry.register({
  name: "searchKnowledgeBase",
  description: "Search internal architectural docs",
  parameters: z.object({ query: z.string().min(3) }),
  circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 10000 },
  execute: async ({ query }) => {
    return { results: [`Documentation match for: ${query}`] };
  }
});

// 2. Register with raw JSON Schema
registry.register({
  name: "calculateLatency",
  description: "Compute latency percentiles",
  parameters: {
    type: "object",
    properties: {
      samples: { type: "array", items: { type: "number" } }
    },
    required: ["samples"]
  },
  execute: ({ samples }) => {
    return { p95: Math.max(...samples) };
  }
});

// 3. Initialize Agent with Multi-turn Hooks and Jittered Retries
const runtime = new AgentRuntime(registry, llmCaller, {
  maxTurns: 10,
  toolTimeoutMs: 8000,
  toolRetry: {
    maxRetries: 3,
    initialDelayMs: 150,
    backoffFactor: 2,
    jitter: "full"
  },
  hooks: {
    onStepStart: (turn) => console.log(`Step ${turn} initiated`),
    onToolEnd: (call, res, durationMs) => console.log(`Tool ${call.name} finished in ${durationMs}ms`)
  }
});

const result = await runtime.runDetailed("Investigate latency spike in cluster us-east-1");
console.log(result.message.content);
console.log(`Completed in ${result.turns} turns, ${result.totalDurationMs}ms`);
```

---

## 👤 Author

**Mohammed Aqib**

- GitHub: [@imaqib101](https://github.com/imaqib101)
- Location: Bengaluru, India
