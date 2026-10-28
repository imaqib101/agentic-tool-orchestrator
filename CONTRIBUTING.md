# Contributing

Thanks for your interest in improving Agentic Tool Orchestrator.

## Setup

Requires Node.js 20 or newer (see `.nvmrc`).

```bash
npm ci
```

## Workflow

1. Create a topic branch (`feat/...`, `fix/...`, `docs/...`).
2. Make your change and add or update tests in `tests/`.
3. Run the full check locally:
   ```bash
   npm run lint
   npm run format:check
   npm run build
   npm test
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (for example `fix(executor): cap backoff delay`) and open a pull request.

## Guidelines

- Keep the public API exported from `src/index.ts`.
- Do not disable or skip tests to get a green build.
- Record user-visible changes in `CHANGELOG.md`.
