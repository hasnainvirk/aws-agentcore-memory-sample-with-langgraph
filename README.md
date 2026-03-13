# AgentCore Memory Demo

Minimal LangGraph samples demonstrating **AgentCoreMemorySaver** (checkpointing) and
**AgentCoreMemoryStore** (persistent key-value store) backed by AWS Bedrock AgentCore Memory.

> **Note:** These samples depend on `AgentCoreMemorySaver` and `AgentCoreMemoryStore` which
> are not yet in the published LangGraph packages. They live in a fork of langgraphjs and are
> pending merge. Until the PR is merged, you must clone the `dev` branch of the fork and build
> it locally — see [Fork Setup](#fork-setup) below.
>
> Fork: https://github.com/hasnainvirk/langgraphjs/tree/dev

---

## Samples

| Script             | Primitive       | Description                                                                                                |
| ------------------ | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm start`       | `StateGraph`    | Low-level graph with a custom node that reads from the Store and tracks visit count via checkpointed state |
| `pnpm start:agent` | `createAgent()` | High-level agent using the `createAgent()` primitive from `langchain`, wired with the same Saver and Store |

Both samples produce equivalent output — they demonstrate the same capabilities through different LangGraph abstractions.

---

## Prerequisites

- Node.js >= 20
- pnpm
- An AWS account with:
  - An [AgentCore Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-create-a-memory-store.html) resource provisioned and in `ACTIVE` status
  - AWS credentials available in your shell (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`, or an IAM role)
  - Bedrock model access enabled for `global.anthropic.claude-haiku-4-5-20251001-v1:0` (required for `pnpm start:agent` only)

---

## Fork Setup

These samples use `file:` references to the local fork instead of published npm packages.
The expected directory layout is:

```
black-duck/
├── agentcore-memory-demo/   ← this repo
└── langgraph/
    └── langgraphjs/         ← fork clone (dev branch)
```

1. Clone the `dev` branch of the fork **next to** this repo:

   ```bash
   git clone --branch dev https://github.com/hasnainvirk/langgraphjs.git langgraph/langgraphjs
   ```

2. Build the fork packages:

   ```bash
   cd langgraph/langgraphjs
   pnpm install
   pnpm build --filter=@langchain/langgraph-checkpoint
   pnpm build --filter=@langchain/langgraph-sdk
   pnpm build --filter=@langchain/langgraph
   pnpm build --filter=@langchain/langgraph-checkpoint-aws-agentcore-memory
   ```

---

## Setup

1. Copy `.env.example` to `.env` and fill in your values:

   ```bash
   cp .env.example .env
   ```

   ```
   AWS_REGION=<your-aws-region>
   AGENTCORE_MEMORY_ID=<your-agentcore-memory-id>
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

---

## Run

**StateGraph sample** (`src/state-graph-demo.ts`):

```bash
pnpm start
```

**createAgent() sample** (`src/agent-demo.ts`):

```bash
pnpm start:agent
```

### Expected output (both samples)

```
Validating AgentCore Memory connection...
Connected.

Storing user profile for "demo-user-01"...

── Run 1 (new thread) ──
  [greet] Hello, Alice! This is visit #1.
  ...

── Run 2 (resumed thread) ──
  [greet] Hello, Alice! This is visit #2.
  ...

── Checkpoint history ──
  checkpoint_id=...  step=4
  checkpoint_id=...  step=3
  ...

── Store read-back ──
  profiles/demo-user-01: { name: 'Alice' }
```

---

## How the fork is wired

`package.json` uses `file:` references for the three unpublished packages, and
`pnpm.overrides` redirects their internal `workspace:` deps to the same local builds:

```json
"dependencies": {
  "@langchain/langgraph": "file:../langgraph/langgraphjs/libs/langgraph-core",
  "@langchain/langgraph-checkpoint": "file:../langgraph/langgraphjs/libs/checkpoint",
  "@langchain/langgraph-checkpoint-aws-agentcore-memory": "file:../langgraph/langgraphjs/libs/checkpoint-aws-agentcore-memory"
},
"pnpm": {
  "overrides": {
    "@langchain/langgraph-checkpoint": "file:../langgraph/langgraphjs/libs/checkpoint",
    "@langchain/langgraph-sdk": "file:../langgraph/langgraphjs/libs/sdk",
    "@langchain/core": "^1.1.28"
  }
}
```

Once the PR is merged and packages are published to npm, all `file:` references and
`pnpm.overrides` entries can be replaced with normal version ranges.
