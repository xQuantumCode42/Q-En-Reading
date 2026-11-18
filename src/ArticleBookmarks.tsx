import { useState } from "react";
import type { ArticleBookmark } from "../shared/recommendations";

export function ArticleBookmarks({
  bookmarks,
  onOpen,
  onImport,
  onRemove,
}: {
  bookmarks: ArticleBookmark[];
  onOpen: (url: string) => Promise<void>;
  onImport: (bookmark: ArticleBookmark) => Promise<void>;
  onRemove: (url: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
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
        收藏先保存連結與推薦理由，不需要登入或下載正文。點「匯入閱讀」才擷取公開文章。
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
            <div className="bookmark-actions">
              <button
                disabled={!!busy}
                onClick={() =>
                  void run(bookmark.url, () => onOpen(bookmark.url))
                }
              >
                開啟原文
              </button>
              <button
                disabled={!!busy}
                onClick={() => void run(bookmark.url, () => onImport(bookmark))}
              >
                {busy === bookmark.url ? "處理中…" : "匯入閱讀"}
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
