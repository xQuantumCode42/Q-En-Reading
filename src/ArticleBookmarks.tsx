import { useState } from "react";
import type { ArticleBookmark } from "../shared/recommendations";
import type { Article } from "../shared/schema";

export function ArticleBookmarks({
  bookmarks,
  onOpen,
  onImport,
  onRemove,
  articles,
  progress,
  onLink,
}: {
  bookmarks: ArticleBookmark[];
  onOpen: (url: string) => Promise<void>;
  onImport: (bookmark: ArticleBookmark) => Promise<void>;
  onRemove: (url: string) => Promise<void>;
  articles: Article[];
  progress: Record<string, { completed: number; total: number }>;
  onLink: (url: string, articleId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const [linking, setLinking] = useState("");
  const [selectedArticle, setSelectedArticle] = useState("");
  async function run(url: string, task: () => Promise<void>) {
    setBusy(url);
    setError("");
    try {
      await task();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section aria-label="文章收藏清單">
      <p className="muted">
        正文與中文翻譯會自動保存，不需再按更新。已匯入的收藏直接開啟本機文章；「瀏覽器原文」只開啟網站，不含本機翻譯。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="favorite-grid">
        {bookmarks.map((bookmark) => (
          <article
            className="favorite-card article-bookmark"
            key={bookmark.url}
          >
            <span className="star">★</span>
            <h3>{bookmark.title}</h3>
            <p>{bookmark.reasonChinese}</p>
            <small>
              {new URL(bookmark.url).hostname} · 推薦於{" "}
              {bookmark.recommendedDay}
            </small>
            {bookmark.articleId && (
              <p className="small">
                {progress[bookmark.articleId]?.completed
                  ? `中文翻譯已保存 ${progress[bookmark.articleId].completed}／${progress[bookmark.articleId].total} 段`
                  : "原文已保存，可離線閱讀"}
              </p>
            )}
            <div className="bookmark-actions">
              <button
                disabled={!!busy}
                onClick={() =>
                  void run(bookmark.url, () => onOpen(bookmark.url))
                }
              >
                瀏覽器原文
              </button>
              <button
                disabled={!!busy}
                onClick={() => void run(bookmark.url, () => onImport(bookmark))}
              >
                {busy === bookmark.url
                  ? "處理中…"
                  : bookmark.articleId
                    ? "開啟已保存文章"
                    : "匯入閱讀"}
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  if (removing !== bookmark.url) {
                    setRemoving(bookmark.url);
                    return;
                  }
                  void run(bookmark.url, () => onRemove(bookmark.url));
                }}
              >
                {removing === bookmark.url ? "確認取消收藏" : "取消收藏"}
              </button>
            </div>
            {!!articles.length && (
              <div>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    setLinking(linking === bookmark.url ? "" : bookmark.url);
                    setSelectedArticle("");
                  }}
                >
                  {bookmark.articleId ? "變更連結" : "連結已保存文章"}
                </button>
                {linking === bookmark.url && (
                  <div>
                    <label>
                      選擇曾翻譯的文章
                      <select
                        aria-label="選擇已保存文章"
                        value={selectedArticle}
                        onChange={(e) => setSelectedArticle(e.target.value)}
                      >
                        <option value="">請選擇</option>
                        {articles.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}（中文 {progress[a.id]?.completed ?? 0}{" "}
                            段）
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={!!busy || !selectedArticle}
                      onClick={() =>
                        void run(bookmark.url, () =>
                          onLink(bookmark.url, selectedArticle),
                        )
                      }
                    >
                      連結並開啟
                    </button>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {!bookmarks.length && (
        <div className="empty">
          <span className="empty-icon">☆</span>
          <h2>尚無符合的文章收藏</h2>
          <p>在今日推薦按「☆ 收藏文章」，稍後就能從這裡找回。</p>
        </div>
      )}
    </section>
  );
}
