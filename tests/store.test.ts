import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import {
  backupSchema,
  defaultPreferences,
  validateResult,
  type Article,
  type Analysis,
  type Favorite,
  type Result,
} from "../shared/schema";
import { OpenAIProvider } from "../electron/ai";
const date = new Date().toISOString();
const article: Article = {
  id: randomUUID(),
  title: "City life",
  source: "https://example.com",
  body: "The proposal gained traction.",
  position: 0.62,
  createdAt: date,
  updatedAt: date,
};
const result: Result = {
  summary: "",
  translation: "",
  structure: "",
  idioms: "",
  tone: "",
  items: [
    {
      term: "gained traction",
      originalSentence: article.body,
      meaning: "開始獲得支持",
      explanation: "Began to attract support.",
      partOfSpeech: "verb phrase",
      collocations: ["gain traction"],
      examples: [
        {
          context: "daily",
          english: "The idea gained traction at work.",
          chinese: "這個想法在工作場合開始獲得支持。",
        },
        {
          context: "article",
          english: "The proposal gained traction among residents.",
          chinese: "這項提案開始獲得居民支持。",
        },
      ],
    },
  ],
};
const analysis: Analysis = {
  id: randomUUID(),
  articleId: article.id,
  kind: "word",
  start: 13,
  end: 28,
  selection: article.body.slice(13, 28),
  result,
  model: "test-fixture",
  createdAt: date,
};
const favorite: Favorite = {
  id: randomUUID(),
  articleId: article.id,
  title: article.title,
  source: article.source,
  term: "traction",
  meaning: "支持",
  sentence: article.body,
  examples: result.items[0].examples,
  note: "個人筆記",
  tags: ["新聞"],
  analysisId: analysis.id,
  createdAt: date,
  updatedAt: date,
};
test("SQLite close/reopen preserves article, reading position, analysis, favorite and preferences", () => {
  const dir = mkdtempSync(join(tmpdir(), "reading-desk-"));
  try {
    const file = join(dir, "test.sqlite");
    const first = new Store(file);
    first.put("article", article);
    first.put("analysis", analysis);
    first.put("favorite", favorite);
    first.setPreferences({ ...defaultPreferences, theme: "dark" });
    first.close();
    const second = new Store(file);
    assert.deepEqual(second.get("article", article.id), article);
    assert.deepEqual(second.get("favorite", favorite.id), favorite);
    assert.deepEqual(second.get("analysis", analysis.id), analysis);
    assert.equal(second.preferences().theme, "dark");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("backup merge remaps conflicting IDs and relationships, replace restores exact content", () => {
  const s = new Store(":memory:");
  s.put("article", article);
  s.put("analysis", analysis);
  s.put("favorite", favorite);
  const b = s.backup();
  s.restore(b, "merge");
  assert.equal(s.list("article").length, 2);
  assert.equal(s.list("favorite").length, 2);
  assert.equal(s.list("analysis").length, 2);
  assert.doesNotThrow(() => backupSchema.parse(s.backup()));
  const copy = s.list<Favorite>("favorite").find((f) => f.id !== favorite.id)!;
  assert.notEqual(copy.articleId, article.id);
  assert.notEqual(copy.analysisId, analysis.id);
  s.restore(b, "replace");
  assert.deepEqual(s.list("article"), [article]);
  assert.deepEqual(s.list("favorite"), [favorite]);
  s.close();
});
test("invalid backup, duplicates, invalid analysis references never change existing data", () => {
  const s = new Store(":memory:");
  s.put("article", article);
  const b = s.backup();
  for (const bad of [
    { ...b, version: 2 },
    { ...b, articles: [article, article] },
    { ...b, analyses: [{ ...analysis, start: 500 }] },
    { ...b, favorites: [favorite] },
    { ...b, articles: [{ ...article, source: "javascript:alert(1)" }] },
  ]) {
    assert.throws(() => s.restore(bad, "replace"));
    assert.deepEqual(s.list("article"), [article]);
  }
  s.close();
});
test("article deletion preserves notes and source snapshots while unlinking analysis", () => {
  const s = new Store(":memory:");
  s.put("article", article);
  s.put("analysis", analysis);
  s.put("favorite", favorite);
  s.deleteArticle(article.id);
  assert.equal(s.list("article").length, 0);
  assert.equal(s.list("analysis").length, 0);
  const f = s.get<Favorite>("favorite", favorite.id)!;
  assert.equal(f.note, favorite.note);
  assert.equal(f.analysisId, null);
  assert.doesNotThrow(() => s.backup());
  s.close();
});
test("SQLite transaction rolls back all writes on failure", () => {
  const s = new Store(":memory:");
  assert.throws(() =>
    s.transaction(() => {
      s.put("article", article);
      throw new Error("test failure");
    }),
  );
  assert.equal(s.list("article").length, 0);
  s.close();
});
test("structured AI output requires overview count, sentence fields, and both example contexts", () => {
  assert.deepEqual(validateResult("word", result), result);
  assert.throws(() => validateResult("overview", result));
  assert.throws(() => validateResult("sentence", result));
  assert.throws(() =>
    validateResult("word", {
      ...result,
      items: [
        {
          ...result.items[0],
          examples: [result.items[0].examples[0], result.items[0].examples[0]],
        },
      ],
    }),
  );
});
test("OpenAI adapter sends strict schema without storage and validates successful response (HTTP fixture)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.store, false);
    assert.equal(payload.text.format.strict, true);
    assert.equal(payload.text.format.schema.additionalProperties, false);
    assert.equal(payload.stream, true);
    assert.equal(payload.max_output_tokens, undefined);
    assert.equal(JSON.parse(payload.input[0].content).article, article.body);
    const item = result.items[0];
    const wireItem = {
      ...item,
      examples: Object.fromEntries(
        item.examples.map(({ context, english, chinese }) => [
          context,
          { english, chinese },
        ]),
      ),
    };
    return new Response(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(wireItem),
                  },
                ],
              },
            ],
          },
        }) +
        "\n\n",
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    assert.deepEqual(
      await new OpenAIProvider().analyze(
        article,
        "word",
        "traction",
        "test-model",
        "test-key",
      ),
      result,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("OpenAI adapter reports HTTP errors, incomplete and malformed output; never fabricates analysis", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, body, pattern] of [
      [401, {}, /登入/],
      [429, {}, /用量/],
      [503, {}, /503/],
      [200, { status: "incomplete" }, /未完成/],
      [
        200,
        {
          status: "completed",
          output: [{ content: [{ type: "output_text", text: "{}" }] }],
        },
        /格式不符/,
      ],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(
          status === 200
            ? "data: " +
                JSON.stringify({
                  type:
                    body.status === "incomplete"
                      ? "response.incomplete"
                      : "response.completed",
                  response: body,
                }) +
                "\n\n"
            : JSON.stringify(body),
          { status },
        );
      await assert.rejects(
        () =>
          new OpenAIProvider().analyze(
            article,
            "word",
            "traction",
            "test-model",
            "test-key",
          ),
        pattern,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
