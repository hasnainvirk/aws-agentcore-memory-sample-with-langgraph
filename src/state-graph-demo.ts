import "dotenv/config";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  AgentCoreMemorySaver,
  AgentCoreMemoryStore,
} from "@langchain/langgraph-checkpoint-aws-agentcore-memory";

const { AWS_REGION, AGENTCORE_MEMORY_ID } = process.env;
if (!AWS_REGION || !AGENTCORE_MEMORY_ID) {
  throw new Error("AWS_REGION and AGENTCORE_MEMORY_ID must be set in .env");
}

// ── State ────────────────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  visitCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
});

// ── Nodes ────────────────────────────────────────────────────────────────────

/**
 * Greet node: reads a persistent user profile from the Store, increments a
 * visit counter, and appends a greeting to the message list.
 */
async function greetNode(
  state: typeof GraphState.State,
  config: RunnableConfig & { store?: BaseStore }
) {
  const store = config.store;
  const userId = (config.configurable?.user_id as string) ?? "anonymous";

  let userName = "stranger";
  if (store) {
    // namespace[0] = sessionId, namespace[1] = actorId (AgentCoreMemoryStore convention)
    const profile = await store.get(["profiles", userId], userId);
    if (profile?.value?.name) {
      userName = profile.value.name as string;
    }
  }

  const newCount = state.visitCount + 1;
  const greeting = `Hello, ${userName}! This is visit #${newCount}.`;
  console.log(`  [greet] ${greeting}`);

  return { messages: [greeting], visitCount: newCount };
}

// ── Graph ────────────────────────────────────────────────────────────────────

function buildGraph(saver: AgentCoreMemorySaver, store: AgentCoreMemoryStore) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new StateGraph(GraphState)
    .addNode("greet", greetNode as any)
    .addEdge(START, "greet")
    .addEdge("greet", END)
    .compile({ checkpointer: saver as any, store });
}

// ── Demo ─────────────────────────────────────────────────────────────────────

async function main() {
  const saver = new AgentCoreMemorySaver({
    memoryId: AGENTCORE_MEMORY_ID!,
    region: AWS_REGION,
  });

  const store = new AgentCoreMemoryStore({
    memoryId: AGENTCORE_MEMORY_ID!,
    region: AWS_REGION,
  });

  console.log("Validating AgentCore Memory connection...");
  await store.start();
  console.log("Connected.\n");

  const userId = "demo-user-01";
  const threadId = "demo-thread-01";

  // Seed a user profile in the Store so the greet node can look it up
  console.log(`Storing user profile for "${userId}"...`);
  await store.put(["profiles", userId], userId, { name: "Alice" });

  const app = buildGraph(saver, store);

  const config = {
    configurable: {
      thread_id: threadId,
      actor_id: userId,
      user_id: userId,
    },
  };

  // ── Run 1: fresh thread ───────────────────────────────────────────────────
  console.log("\n── Run 1 (new thread) ──");
  const result1 = await app.invoke({ messages: [] }, config);
  console.log("  State after run 1:", result1);

  // ── Run 2: resume same thread (checkpoint restored) ───────────────────────
  console.log("\n── Run 2 (resumed thread) ──");
  const result2 = await app.invoke({ messages: [] }, config);
  console.log("  State after run 2:", result2);

  // ── Verify checkpoint history ─────────────────────────────────────────────
  console.log("\n── Checkpoint history ──");
  for await (const tuple of saver.list(config)) {
    const meta = tuple.metadata as Record<string, unknown>;
    console.log(
      `  checkpoint_id=${tuple.config.configurable?.checkpoint_id}  step=${meta.step}`
    );
  }

  // ── Read back the store item ───────────────────────────────────────────────
  console.log("\n── Store read-back ──");
  const stored = await store.get(["profiles", userId], userId);
  console.log("  profiles/demo-user-01:", stored?.value);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
