import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  backupSchema,
  defaultPreferences,
  type Article,
  type Analysis,
  type Favorite,
  type Backup,
  type Preferences,
} from "../shared/schema";
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
      this.remove("article", id);
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
    });
  }
  restore(value: unknown, mode: "merge" | "replace") {
    const b = backupSchema.parse(value);
    this.transaction(() => {
      if (mode === "replace") {
        this.db.exec("DELETE FROM records");
        this.setPreferences(b.preferences);
      }
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
