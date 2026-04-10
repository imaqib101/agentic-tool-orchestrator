# Agentic Tool Orchestrator 🤖

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Zod](https://img.shields.io/badge/Schema-Zod%20Validated-3E67B1?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-Tested-729B1B?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

An extensible, production-grade **Autonomous LLM Agent Runtime** designed in TypeScript. Features strict runtime schema validation via Zod, asynchronous tool execution sandboxing, bounded turn-budget controls, and automated error recovery loops.

---

## 🏗️ Architecture

```text
User Objective
      │
      ▼
┌──────────────────────────────────────┐
│        Agent Reasoning Loop          │◄───────────┐
└──────────────────┬───────────────────┘            │
                   ▼                                │
      ┌─────────────────────────┐                   │
      │ Model Generates Action  │                   │
      └────────────┬────────────┘                   │
                   ▼                                │
      ┌─────────────────────────┐                   │
      │ Tool Registry & Schema  │ ───► [Invalid] ───┤ Feedback Error
      │ Verification (Zod)      │                   │
      └────────────┬────────────┘                   │
                   ▼ [Valid]                        │
      ┌─────────────────────────┐                   │
      │ Bounded Runner & Sandbox│ ───► [Result] ────┘
      └────────────┬────────────┘
                   ▼
          Final Resolution
```

---

## ✨ Features

- 🛡️ **Runtime Schema Enforcement**: Parameter schemas backed by Zod ensure malformed model arguments fail gracefully with structured feedback.
- ⏱️ **Execution Sandboxing**: Configurable per-tool timeouts prevent runaway external calls from hanging agent sessions.
- 🔄 **Autonomous Continuation Loop**: Manages turn budgets, message history, and tool observation state.
- 🧪 **100% Vitest Coverage**: Tested against mock multi-turn reasoning workflows and edge-case errors.

---

## 🚀 Quick Start

```typescript
import { ToolRegistry, AgentRuntime } from "@aqib/agentic-tool-orchestrator";
import { z } from "zod";

const registry = new ToolRegistry();

// 1. Register a Type-Safe Tool
registry.register({
  name: "searchKnowledgeBase",
  description: "Search internal architectural docs",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    return { results: [`Documentation match for: ${query}`] };
  }
});

// 2. Initialize Agent with LLM Handler
const runtime = new AgentRuntime(registry, llmClient, { maxTurns: 10 });
const result = await runtime.run("Find deployment specs for production");
console.log(result.content);
```

---

## 👤 Author

**Mohammed Aqib**
- GitHub: [@imaqib101](https://github.com/imaqib101)
- Location: Bengaluru, India
