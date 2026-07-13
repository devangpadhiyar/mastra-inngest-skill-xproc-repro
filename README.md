# Minimal repro: `@mastra/inngest` durable agent drops **workspace skill tools** cross-process (`ToolNotFoundError`)

A `createInngestAgent` durable agent whose (Mastra-instance) `Workspace` has `skills` configured
**cannot call its `skill` tool when the durable steps execute on a separate Inngest `connect()` worker
process.** The model emits a correct `skill({ name: "greeting" })` call and the durable tool-call step
rejects it with:

```
ToolNotFoundError: Tool "skill" not found. Call tools by their exact name only — never add prefixes, namespaces, or colons.
```

The **same agent, same config, same prompt** works perfectly when the run executes **in-process** (no
connect worker). The only variable is whether execution crosses a process boundary.

This also affects `skill_read`, `skill_search`, and all `mastra_workspace_*` filesystem tools — every
tool that is a per-request closure over the `Workspace` (as opposed to a static `createTool`, which
resolves fine cross-process).

Tracked upstream: **mastra-ai/mastra#19330**.

## Expected vs actual

| | Behavior |
|---|---|
| **Expected** | Cross-process (connect worker), the agent calls `skill` → loads the skill → replies `"Hello, wonderful human!"` |
| **Actual** | Cross-process, the `skill` call returns `ToolNotFoundError`; the turn ends with no answer |
| **Control (in-process, no worker)** | Works: `skill` resolves and the agent replies correctly |

## Root cause

The durable agentic loop runs as two separate steps per iteration:

1. **`durable-llm-execution`** decides the model's tools. Cross-process it calls
   `resolveRuntimeDependencies` (`@mastra/core/dist/agent/durable/index.js`), which **correctly
   rebuilds the full toolset** (incl. `skill`/workspace tools) via `agent.getToolsForExecution()`.
   That's why the model *sees* and *calls* `skill`.
2. **`durable-tool-call`** *executes* the call. It resolves the tool **only** from
   `globalRunRegistry.get(runId).tools` (plus a `mastra.getTool()`/`mastra.listTools()` fallback that
   only sees **Mastra-instance-level** tools). It **never** calls `resolveRuntimeDependencies`.

`globalRunRegistry` is a **per-process** in-memory `TTLCache`. On a connect worker, the run was
prepared in a *different* process, so the worker's registry entry is the empty placeholder that
`@mastra/inngest` seeds (`@mastra/inngest/dist/index.js`, `existingEntry = { tools: {}, model: undefined }`).
Result: `registryEntry.tools["skill"]` is `undefined`, the `mastra.listTools()` fallback doesn't have
workspace/skill tools (they're per-request closures, not instance-registered), and the tool-call step
throws `ToolNotFoundError`.

Static `createTool` tools survive because they can be resolved via the Mastra instance / the
suspend-resume path re-runs `resolveRuntimeDependencies`; the plain execute-and-return `skill` tool
hits only the empty registry lookup.

**Fix direction:** the durable tool-call step (or `@mastra/inngest`'s worker path) must rebuild the
agent toolset via `resolveRuntimeDependencies`/`getToolsForExecution` when the registry entry is empty,
the same way the LLM-execution step already does — so workspace/skill tools resolve cross-process.

## Steps to reproduce

Requires an OpenAI API key (`gpt-4o-mini`).

```bash
npm install
cp .env.example .env          # then set OPENAI_API_KEY=sk-...  (keep INNGEST_DEV=1)

# terminal 1 — self-hosted Inngest dev server, pointed at the Mastra serve route
npx inngest-cli@latest dev -u http://localhost:4333/inngest/api -p 8299

# terminal 2 — Mastra server (serves /api/agents/greeter/stream + /inngest/api)
INNGEST_BASE_URL=http://localhost:8299 npm run dev

# --- CONTROL: run WITHOUT a connect worker first → it works (skill resolves in-process) ---
npm run repro         # → ✅ skill tool executed

# terminal 3 — start the cross-process connect worker (THIS is what triggers the bug)
INNGEST_BASE_URL=http://localhost:8299 npm run worker

# --- now re-run: the durable steps execute on the worker → ToolNotFoundError ---
npm run repro         # → ❌ BUG REPRODUCED
```

`repro.ts` fires one `stream()` turn asking the agent how to greet (forcing a `skill` call) and reports
whether the model called `skill` and whether `ToolNotFoundError` came back.

## Environment

- `@mastra/core`: 1.50.1
- `@mastra/inngest`: 1.8.1
- `inngest`: 4.12.1
- `mastra`: 1.18.2
- Node: v22.15.1
- LLM: OpenAI `gpt-4o-mini`
- Bug occurs at **runtime**, only when the durable tool-call step runs **cross-process** (connect worker or multi-replica).
