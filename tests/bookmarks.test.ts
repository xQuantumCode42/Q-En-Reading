import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../electron/store";
import { dailyRecommendationSchema } from "../shared/recommendations";
import { backupSchema } from "../shared/schema";
import { randomUUID } from "node:crypto";
import { savedTranslations } from "../shared/translation";

test("redirected bookmark resolves a fixed local article, translation remains visible after changing models and restore", () => {
  const store = new Store(":memory:");
  const target = new Store(":memory:");
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    store.saveArticleBookmark(recommendation);
    store.put("article", {
      id,
      title: "Test",
      source: "https://example.com/final",
      importedFrom: recommendation.url,
      body: "An article.",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    store.put("analysis", {
      id: randomUUID(),
      articleId: id,
      kind: "translation",
      selection: "An article.",
      start: 0,
      end: 11,
      model: "old-model",
      createdAt: now,
      result: {
        summary: "",
        translation: "一篇文章。",
        structure: "",
        idioms: "",
        tone: "",
        items: [],
      },
    });
    const linked = store.articleBookmarks()[0];
    assert.equal(linked.articleId, id);
    const saved = savedTranslations(
      "An article.",
      store.list("analysis"),
      "new-model",
    );
    assert.equal(saved.selectedModel, "old-model");
    assert.equal(saved.saved.filter(Boolean).length, 1);
    store.remove("article-bookmark", recommendation.url);
    const existing = store.get<any>("article", id)!;
    delete existing.importedFrom;
    store.put("article", existing);
    store.saveArticleBookmark(recommendation);
    assert.equal(store.articleBookmarks()[0].articleId, undefined);
    store.linkArticleBookmark(recommendation.url, id);
    assert.equal(store.articleBookmarks()[0].articleId, id);
    const backup = store.backup();
    target.restore(backup, "merge");
    target.restore(backup, "merge");
    const reopened = target.articleBookmarks()[0];
    assert.ok(target.get("article", reopened.articleId!));
    assert.equal(
      target
        .list<any>("analysis")
        .filter((a) => a.articleId === reopened.articleId).length,
      1,
    );
    store.deleteArticle(id);
    assert.equal(store.articleBookmarks()[0].articleId, null);
    assert.doesNotThrow(() => store.backup());
  } finally {
    store.close();
    target.close();
  }
});

const recommendation = dailyRecommendationSchema.parse({
  day: "2026-11-18",
  title: "Public science article",
  url: "https://example.com/article",
  publishedDate: null,
  reasonChinese: "值得閱讀的文章",
  citations: ["https://example.com/article"],
  model: "test",
  createdAt: "2026-11-18T00:00:00.000Z",
});
test("article bookmarks save independently of text or AI, deduplicate URLs and participate in backup", () => {
  const store = new Store(":memory:");
  const restored = new Store(":memory:");
  try {
    const first = store.saveArticleBookmark(recommendation);
    const again = store.saveArticleBookmark({
      ...recommendation,
      day: "2026-11-19",
      title: "Another recommendation",
    });
    assert.deepEqual(again, first);
    assert.equal(store.list("article-bookmark").length, 1);
    assert.equal(store.list("article").length, 0);
    const backup = store.backup();
    assert.equal(backup.articleBookmarks?.length, 1);
    restored.restore(backup, "merge");
    restored.restore(backup, "merge");
    assert.equal(restored.list("article-bookmark").length, 1);
    assert.throws(() =>
      backupSchema.parse({ ...backup, articleBookmarks: [first, first] }),
    );
    const oldBackup = { ...backup };
    delete oldBackup.articleBookmarks;
    assert.doesNotThrow(() => backupSchema.parse(oldBackup));
    restored.restore(oldBackup, "merge");
    assert.equal(restored.list("article-bookmark").length, 1);
    restored.restore(oldBackup, "replace");
    assert.equal(restored.list("article-bookmark").length, 0);
    store.remove("article-bookmark", first.url);
    assert.equal(store.list("article-bookmark").length, 0);
  } finally {
    store.close();
    restored.close();
  }
});
