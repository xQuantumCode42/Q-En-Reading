import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../electron/store";
import { dailyRecommendationSchema } from "../shared/recommendations";
import { backupSchema } from "../shared/schema";

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
