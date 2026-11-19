import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { translationChunks } from "../shared/translation";
import {
  normalizeAnalysisResult,
  analysisResponseSchema,
} from "../electron/ai";
import { validateResult } from "../shared/schema";

test("recent reading prunes expired and excess activity without deleting articles or favorites", () => {
  const store = new Store(":memory:");
  const now = Date.parse("2026-11-19T12:00:00Z");
  const ids: string[] = [];
  try {
    for (let i = 0; i < 55; i++) {
      const id = randomUUID();
      ids.push(id);
      store.put("article", {
        id,
        title: `Article ${i}`,
        source: "",
        body: "Text",
        position: 0,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      });
      store.touchReading(id, now + i);
    }
    assert.equal(store.recentReading(now + 60).length, 50);
    assert.equal(store.recentReading(now + 60)[0].id, ids[54]);
    assert.equal(store.list("article").length, 55);
    store.clearRecentReading();
    assert.equal(store.recentReading(now + 10).length, 0);
    store.touchReading(ids[0], now);
    assert.equal(store.recentReading(now + 15 * 86400000).length, 1);
    assert.equal(store.recentReading(now + 31 * 86400000).length, 0);
    assert.equal(store.list("article").length, 55);
  } finally {
    store.close();
  }
});

test("translation chunks preserve every original character and obey length/offset boundaries", () => {
  for (const body of [
    "Short paragraph.\n\nAnother paragraph.",
    "A long paragraph. ".repeat(1000),
    "x".repeat(9000),
  ]) {
    const chunks = translationChunks(body);
    assert.equal(chunks.map((c) => body.slice(c.start, c.end)).join(""), body);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks.at(-1)!.end, body.length);
    for (const chunk of chunks)
      assert.ok(chunk.end > chunk.start && chunk.end - chunk.start <= 4000);
  }
});

test("translation responses contain only complete nonempty Chinese translation, no learning-item grammar", () => {
  const schema = analysisResponseSchema("translation") as any;
  assert.deepEqual(Object.keys(schema.properties), ["translation"]);
  const result = normalizeAnalysisResult("translation", {
    translation: "這是全文翻譯的一個段落。",
  });
  assert.equal(result.items.length, 0);
  assert.throws(() =>
    normalizeAnalysisResult("translation", { translation: "" }),
  );
  assert.throws(() =>
    validateResult("translation", { ...result, translation: "   " }),
  );
});

test("translation cache survives backup restore and rejects mismatched original offsets", () => {
  const source = new Store(":memory:");
  const target = new Store(":memory:");
  const articleId = randomUUID();
  const now = new Date().toISOString();
  const body = "The proposal gained traction.";
  try {
    source.put("article", {
      id: articleId,
      title: "Test article",
      source: "",
      body,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    source.put("analysis", {
      id: randomUUID(),
      articleId,
      kind: "translation",
      selection: body,
      start: 0,
      end: body.length,
      model: "test-model",
      createdAt: now,
      result: normalizeAnalysisResult("translation", {
        translation: "這項提案開始獲得支持。",
      }),
    });
    const backup = source.backup();
    target.restore(backup, "replace");
    assert.deepEqual(target.list("analysis"), source.list("analysis"));
    assert.throws(() =>
      target.restore(
        { ...backup, analyses: backup.analyses.map((a) => ({ ...a, end: 1 })) },
        "replace",
      ),
    );
    assert.equal(target.list("analysis").length, 1);
  } finally {
    source.close();
    target.close();
  }
});
