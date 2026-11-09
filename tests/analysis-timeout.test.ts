import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OpenAIProvider,
  analysisResponseSchema,
  normalizeAnalysisResult,
  readResponsesStream,
} from "../electron/ai";
import { abortable } from "../electron/abort";

test("analysis formats limit each mode to relevant fields and keep strict local bounds", () => {
  const word = analysisResponseSchema("word") as {
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  const sentence = analysisResponseSchema("sentence") as typeof word;
  const overview = analysisResponseSchema("overview") as typeof word;
  assert.equal(word.additionalProperties, false);
  assert.ok(word.properties.term);
  assert.equal(word.properties.items, undefined);
  assert.deepEqual(Object.keys(sentence.properties), [
    "translation",
    "structure",
    "idioms",
    "tone",
  ]);
  assert.deepEqual(Object.keys(overview.properties), ["summary", "items"]);
  assert.throws(() => normalizeAnalysisResult("word", { term: "incomplete" }));
  assert.throws(() =>
    normalizeAnalysisResult("overview", { summary: "A summary", items: [] }),
  );
});

test("abort settles a stalled read even if stream cleanup never resolves", async () => {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      return new Promise(() => {});
    },
  });
  const reading = readResponsesStream(new Response(stream), controller.signal);
  controller.abort(new Error("cancelled by regression test"));
  await assert.rejects(() => reading, /cancelled by regression test/);
});

test("completed responses return immediately even if transport cancellation stalls", async () => {
  const frame =
    "data: " +
    JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "OK" }] }],
      },
    }) +
    "\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame));
    },
    cancel() {
      return new Promise(() => {});
    },
  });
  assert.equal(await readResponsesStream(new Response(stream)), "OK");
});

test("deadline covers transports and authorization promises that ignore cancellation", async () => {
  const controller = new AbortController();
  const stalled = abortable(new Promise(() => {}), controller.signal);
  controller.abort(new Error("entire request expired"));
  await assert.rejects(() => stalled, /entire request expired/);
  const network = globalThis.fetch;
  try {
    globalThis.fetch = () => new Promise(() => {});
    const stopped = new AbortController();
    const request = new OpenAIProvider().analyze(
      {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Test",
        source: "",
        body: "The idea gained traction.",
        position: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      "word",
      "traction",
      "test-model",
      "fixture-token",
      { signal: stopped.signal },
    );
    stopped.abort(new Error("user cancelled"));
    await assert.rejects(() => request, /user cancelled/);
  } finally {
    globalThis.fetch = network;
  }
});
