import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  localDay,
  dailyRecommendationSchema,
  recommendationSettingsSchema,
  defaultRecommendationSettings,
  articleBookmarkSchema,
  type ArticleBookmark,
  publicUrl,
  type DailyRecommendation,
  type RecommendationSettings,
} from "../shared/recommendations";
import {
  backupSchema,
  defaultPreferences,
  type Article,
  type Analysis,
  type Favorite,
  type Backup,
  type Preferences,
} from "../shared/schema";
import { savedTranslations } from "../shared/translation";
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
    );
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS records (type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(type,id)); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;`,
    );
  }
  list<T>(type: string): T[] {
    return this.db
      .prepare("SELECT data FROM records WHERE type=? ORDER BY rowid DESC")
      .all(type)
      .map((r) => JSON.parse(r.data as string) as T);
  }
  get<T>(type: string, id: string): T | undefined {
    const r = this.db
      .prepare("SELECT data FROM records WHERE type=? AND id=?")
      .get(type, id);
    return r ? JSON.parse(r.data as string) : undefined;
  }
  put<T extends { id: string }>(type: string, data: T) {
    this.db
      .prepare(
        "INSERT INTO records(type,id,data) VALUES(?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data",
      )
      .run(type, data.id, JSON.stringify(data));
  }
  remove(type: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE type=? AND id=?").run(type, id);
  }
  recentReading(now = Date.now()): { id: string; openedAt: string }[] {
    const all = this.list<{ id: string; openedAt: string }>("recent-reading");
    const keep = all
      .filter(
        (r) =>
          this.get("article", r.id) &&
          Number.isFinite(Date.parse(r.openedAt)) &&
          now - Date.parse(r.openedAt) < 30 * 86400000,
      )
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, 50);
    const ids = new Set(keep.map((r) => r.id));
    for (const record of all)
      if (!ids.has(record.id)) this.remove("recent-reading", record.id);
    return keep;
  }
  touchReading(id: string, now = Date.now()) {
    if (!this.get("article", id)) throw new Error("文章不存在。");
    this.put("recent-reading", { id, openedAt: new Date(now).toISOString() });
    return this.recentReading(now);
  }
  clearRecentReading() {
    this.db.prepare("DELETE FROM records WHERE type='recent-reading'").run();
  }
  preferences(): Preferences {
    const r = this.db
      .prepare("SELECT value FROM settings WHERE key='preferences'")
      .get();
    return r ? JSON.parse(r.value as string) : defaultPreferences;
  }
  setPreferences(p: Preferences) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('preferences',?)")
      .run(JSON.stringify(p));
  }
  recommendationSettings(): RecommendationSettings {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key='recommendation-settings'")
      .get();
    return row
      ? recommendationSettingsSchema.parse(JSON.parse(row.value as string))
      : defaultRecommendationSettings;
  }
  setRecommendationSettings(settings: RecommendationSettings) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO settings VALUES('recommendation-settings',?)",
      )
      .run(JSON.stringify(recommendationSettingsSchema.parse(settings)));
  }
  dailyRecommendation(day: string): DailyRecommendation | undefined {
    const record = this.get("recommendation", day);
    return record ? dailyRecommendationSchema.parse(record) : undefined;
  }
  saveRecommendation(
    value: DailyRecommendation,
    replace = false,
  ): DailyRecommendation {
    const record = dailyRecommendationSchema.parse(value);
    this.db
      .prepare(
        replace
          ? "INSERT OR REPLACE INTO records(type,id,data) VALUES('recommendation',?,?)"
          : "INSERT OR IGNORE INTO records(type,id,data) VALUES('recommendation',?,?)",
      )
      .run(record.day, JSON.stringify(record));
    return this.dailyRecommendation(record.day)!;
  }
  saveArticleBookmark(value: DailyRecommendation): ArticleBookmark {
    const recommendation = dailyRecommendationSchema.parse(value);
    const bookmark = articleBookmarkSchema.parse({
      url: recommendation.url,
      title: recommendation.title,
      reasonChinese: recommendation.reasonChinese,
      recommendedDay: recommendation.day,
      createdAt: new Date().toISOString(),
    });
    this.db
      .prepare(
        "INSERT OR IGNORE INTO records(type,id,data) VALUES('article-bookmark',?,?)",
      )
      .run(bookmark.url, JSON.stringify(bookmark));
    return articleBookmarkSchema.parse(
      this.get("article-bookmark", bookmark.url),
    );
  }
  linkArticleBookmark(url: string, articleId: string): ArticleBookmark {
    url = publicUrl(url);
    const bookmark = this.get<ArticleBookmark>("article-bookmark", url);
    if (!bookmark || !this.get("article", articleId))
      throw new Error("找不到收藏或已保存文章。");
    const linked = articleBookmarkSchema.parse({ ...bookmark, articleId });
    this.db
      .prepare(
        "UPDATE records SET data=? WHERE type='article-bookmark' AND id=?",
      )
      .run(JSON.stringify(linked), url);
    return linked;
  }
  articleBookmarks(): ArticleBookmark[] {
    const articles = this.list<Article>("article");
    const analyses = this.list<Analysis>("analysis");
    const normalized = (value: string) => {
      try {
        return publicUrl(value);
      } catch {
        return "";
      }
    };
    return this.list<ArticleBookmark>("article-bookmark").map((bookmark) => {
      if (
        bookmark.articleId &&
        articles.some((a) => a.id === bookmark.articleId)
      )
        return bookmark;
      const matches = articles.filter((a) =>
        [a.source, a.importedFrom ?? ""].some(
          (url) => normalized(url) === bookmark.url,
        ),
      );
      matches.sort(
        (a, b) =>
          analyses.filter(
            (x) => x.articleId === b.id && x.kind === "translation",
          ).length -
          analyses.filter(
            (x) => x.articleId === a.id && x.kind === "translation",
          ).length,
      );
      return matches[0]
        ? this.linkArticleBookmark(bookmark.url, matches[0].id)
        : bookmark;
    });
  }
  translationProgress(): Record<string, { completed: number; total: number }> {
    const history = this.list<Analysis>("analysis");
    const model = this.preferences().model;
    return Object.fromEntries(
      this.list<Article>("article").map((article) => {
        const state = savedTranslations(
          article.body,
          history.filter((a) => a.articleId === article.id),
          model,
        );
        return [
          article.id,
          {
            completed: state.saved.filter(Boolean).length,
            total: state.chunks.length,
          },
        ];
      }),
    );
  }
  transaction(fn: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  deleteArticle(id: string) {
    this.transaction(() => {
      for (const bookmark of this.list<ArticleBookmark>("article-bookmark"))
        if (bookmark.articleId === id) {
          this.db
            .prepare(
              "UPDATE records SET data=? WHERE type='article-bookmark' AND id=?",
            )
            .run(
              JSON.stringify({ ...bookmark, articleId: null }),
              bookmark.url,
            );
        }
      this.remove("article", id);
      this.remove("recent-reading", id);
      const ids = this.list<Analysis>("analysis")
        .filter((a) => a.articleId === id)
        .map((a) => a.id);
      for (const a of ids) this.remove("analysis", a);
      for (const f of this.list<Favorite>("favorite"))
        if (f.articleId === id)
          this.put("favorite", { ...f, analysisId: null });
    });
  }
  backup(): Backup {
    return backupSchema.parse({
      format: "reading-desk",
      version: 1,
      exportedAt: new Date().toISOString(),
      articles: this.list<Article>("article"),
      analyses: this.list<Analysis>("analysis"),
      favorites: this.list<Favorite>("favorite"),
      preferences: this.preferences(),
      recommendationSettings: this.recommendationSettings(),
      recommendations: this.list<DailyRecommendation>("recommendation"),
      articleBookmarks: this.articleBookmarks(),
    });
  }
  restore(value: unknown, mode: "merge" | "replace", today = localDay()) {
    const b = backupSchema.parse(value);
    const lockedToday = this.dailyRecommendation(today);
    const localSettingsExist = !!this.db
      .prepare("SELECT key FROM settings WHERE key='recommendation-settings'")
      .get();
    this.transaction(() => {
      if (mode === "replace") {
        this.db.exec("DELETE FROM records");
        this.setPreferences(b.preferences);
      }
      if (lockedToday) this.saveRecommendation(lockedToday);
      for (const recommendation of b.recommendations ?? [])
        this.saveRecommendation(recommendation);
      if (
        b.recommendationSettings &&
        (mode === "replace" || !localSettingsExist)
      )
        this.setRecommendationSettings(b.recommendationSettings);
      // Merge preserves all local data. Colliding article/analysis/favorite IDs are remapped together.
      const articleIds = new Map(
        b.articles.map((a) => [
          a.id,
          mode === "merge" && this.get("article", a.id) ? randomUUID() : a.id,
        ]),
      );
      const analysisIds = new Map(
        b.analyses.map((a) => [
          a.id,
          mode === "merge" && this.get("analysis", a.id) ? randomUUID() : a.id,
        ]),
      );
      for (const a of b.articles)
        this.put("article", { ...a, id: articleIds.get(a.id)! });
      for (const bookmark of b.articleBookmarks ?? []) {
        const linked = {
          ...bookmark,
          ...(bookmark.articleId
            ? { articleId: articleIds.get(bookmark.articleId) }
            : {}),
        };
        const local = this.get<ArticleBookmark>(
          "article-bookmark",
          bookmark.url,
        );
        if (
          local &&
          linked.articleId &&
          (!local.articleId || !this.get("article", local.articleId))
        ) {
          this.db
            .prepare(
              "UPDATE records SET data=? WHERE type='article-bookmark' AND id=?",
            )
            .run(
              JSON.stringify({ ...local, articleId: linked.articleId }),
              bookmark.url,
            );
        }
        this.db
          .prepare(
            "INSERT OR IGNORE INTO records(type,id,data) VALUES('article-bookmark',?,?)",
          )
          .run(bookmark.url, JSON.stringify(linked));
      }
      for (const a of b.analyses)
        this.put("analysis", {
          ...a,
          id: analysisIds.get(a.id)!,
          articleId: articleIds.get(a.articleId)!,
        });
      for (const f of b.favorites)
        this.put("favorite", {
          ...f,
          id:
            mode === "merge" && this.get("favorite", f.id)
              ? randomUUID()
              : f.id,
          articleId: articleIds.get(f.articleId) ?? f.articleId,
          analysisId: f.analysisId ? analysisIds.get(f.analysisId)! : null,
        });
    });
  }
  close() {
    this.db.close();
  }
}
