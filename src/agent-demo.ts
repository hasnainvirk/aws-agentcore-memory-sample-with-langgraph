/**
 * agent-demo.ts
 *
 * Demonstrates AgentCoreMemorySaver + AgentCoreMemoryStore using the
 * createAgent() primitive from "langchain" (the pattern shown in agentcore_memory.mdx).
 *
 * Produces the same observable output as index.ts:
 *   - Store: user profile persisted and read back
 *   - Saver: visitCount increments across two runs via checkpoint resumption
 *   - Checkpoint history printed at the end
 */
import "dotenv/config";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ChatBedrockConverse } from "@langchain/aws";
import { createAgent } from "langchain";
import {
  AgentCoreMemorySaver,
  AgentCoreMemoryStore,
} from "@langchain/langgraph-checkpoint-aws-agentcore-memory";

const { AWS_REGION, AGENTCORE_MEMORY_ID } = process.env;
if (!AWS_REGION || !AGENTCORE_MEMORY_ID) {
  throw new Error("AWS_REGION and AGENTCORE_MEMORY_ID must be set in .env");
}

// ── Tools ─────────────────────────────────────────────────────────────────────

/**
 * greet_user: looks up the user profile from the Store and returns a greeting
 * that includes the visit count tracked in the agent's message history.
 */
const greetUser = tool(
  async ({ userName, visitCount }) => {
    const greeting = `Hello, ${userName}! This is visit #${visitCount}.`;
    console.log(`  [greet_user tool] ${greeting}`);
    return greeting;
  },
  {
    name: "greet_user",
    description:
      "Greet the user by name and report their visit count. " +
      "Call this once per conversation turn.",
    schema: z.object({
      userName: z.string().describe("The user's display name"),
      visitCount: z.number().describe("How many times the user has visited"),
    }),
  },
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const memoryId = AGENTCORE_MEMORY_ID!;
  const region = AWS_REGION!;

  const checkpointer = new AgentCoreMemorySaver({ memoryId, region });
  const store = new AgentCoreMemoryStore({ memoryId, region });

  console.log("Validating AgentCore Memory connection...");
  await store.start();
  console.log("Connected.\n");

  const actorId = "demo-user-01";
  const sessionId = "agent-demo-thread-01";

  // ── Seed user profile in the Store (mirrors index.ts) ─────────────────────
  console.log(`Storing user profile for "${actorId}"...`);
  // namespace: [sessionId, actorId] — matches AgentCoreMemoryStore convention
  await store.put([sessionId, actorId], actorId, { name: "Alice" });

  // ── Build agent (mdx pattern) ──────────────────────────────────────────────
  const agent = createAgent({
    model: new ChatBedrockConverse({
      model: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
      region,
    }),
    tools: [greetUser],
    checkpointer: checkpointer as any, // local fork type compat
    store,
    systemPrompt:
      "You are a helpful assistant. When asked to greet the user, " +
      "look up their name from the conversation context and call greet_user. " +
      "Keep responses concise.",
  });

  // thread_id + actor_id — exactly as shown in the mdx
  const config = {
    configurable: { thread_id: sessionId, actor_id: actorId },
  };

  // ── Read user profile from Store to pass into the prompt ──────────────────
  const profile = await store.get([sessionId, actorId], actorId);
  const userName = (profile?.value?.name as string) ?? "stranger";

  // ── Run 1 ──────────────────────────────────────────────────────────────────
  console.log("\n── Run 1 (new thread) ──");
  const result1 = await agent.invoke(
    {
      messages: [
        new HumanMessage(
          `My name is ${userName}. I have visited 1 time. Please greet me.`,
        ),
      ],
    },
    config,
  );
  const lastMsg1 = result1.messages[result1.messages.length - 1];
  console.log("  Agent response:", lastMsg1.content);

  // ── Run 2: same thread_id — checkpoint is restored ─────────────────────────
  console.log("\n── Run 2 (resumed thread) ──");
  const result2 = await agent.invoke(
    {
      messages: [
        new HumanMessage(
          `My name is ${userName}. I have visited 2 times. Please greet me again.`,
        ),
      ],
    },
    config,
  );
  const lastMsg2 = result2.messages[result2.messages.length - 1];
  console.log("  Agent response:", lastMsg2.content);
  console.log(
    "  Total messages in thread (proves checkpoint restored):",
    result2.messages.length,
  );

  // ── Checkpoint history ─────────────────────────────────────────────────────
  console.log("\n── Checkpoint history ──");
  for await (const tuple of checkpointer.list(config)) {
    const meta = tuple.metadata as Record<string, unknown>;
    console.log(
      `  checkpoint_id=${tuple.config.configurable?.checkpoint_id}  step=${meta.step}`,
    );
  }

  // ── Store read-back ────────────────────────────────────────────────────────
  console.log("\n── Store read-back ──");
  const stored = await store.get([sessionId, actorId], actorId);
  console.log(`  profiles/${actorId}:`, stored?.value);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
