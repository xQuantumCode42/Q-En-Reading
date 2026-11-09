import { useEffect, useRef, useState } from "react";
import type {
  Analysis,
  Article,
  Favorite,
  Kind,
  LearningItem,
  Preferences,
} from "../shared/schema";
import { defaultPreferences } from "../shared/schema";
import type { Snapshot, ChatGPTModel, AnalysisProgress } from "../shared/api";

const api = window.readingDesk;
const labels: Record<Kind, string> = {
  word: "字詞解析",
  sentence: "句子解析",
  overview: "全文重點",
};
type Selection = { text: string; start: number; end: number; sentence: string };
const emptySelection: Selection = { text: "", start: 0, end: 0, sentence: "" };
export default function App() {
  const [data, setData] = useState<Snapshot>();
  const [page, setPage] = useState<"library" | "favorites" | "settings">(
    "library",
  );
  const [activeId, setActiveId] = useState("");
  const [adding, setAdding] = useState(false);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [analysis, setAnalysis] = useState<Analysis>();
  const [history, setHistory] = useState<Analysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress>();
  const [elapsed, setElapsed] = useState(0);
  const analysisArticle = useRef<string | undefined>(undefined);
  useEffect(
    () =>
      api.onAnalysisProgress((value) => {
        if (analysisArticle.current === value.articleId) setProgress(value);
      }),
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [editing, setEditing] = useState<Favorite>();
  const [draftNote, setDraftNote] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [rename, setRename] = useState<Article>();
  const [deleteId, setDeleteId] = useState("");
  const [lastKind, setLastKind] = useState<Kind>("word");
  const reader = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const currentId = useRef(activeId);
  currentId.current = activeId;
  const positionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pendingPosition = useRef<{ id: string; position: number } | undefined>(
    undefined,
  );
  const article = data?.articles.find((a) => a.id === activeId);
  const prefs = data?.preferences ?? defaultPreferences;
  async function refresh() {
    const d = await api.snapshot();
    setData(d);
    return d;
  }
  async function action(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void action(async () => {
      await refresh();
    });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);
  function flushPosition() {
    if (positionTimer.current) clearTimeout(positionTimer.current);
    if (pendingPosition.current) {
      const p = pendingPosition.current;
      pendingPosition.current = undefined;
      void api.position(p).catch((e) => setError(e.message));
    }
  }
  useEffect(() => {
    const close = () => {
      if (pendingPosition.current) {
        try {
          api.flushPosition(pendingPosition.current);
        } catch {}
        pendingPosition.current = undefined;
      }
    };
    window.addEventListener("beforeunload", close);
    return () => window.removeEventListener("beforeunload", close);
  }, []);
  useEffect(() => {
    if (!activeId) return;
    setSelection(emptySelection);
    setAnalysis(undefined);
    setDraftNote("");
    setDraftTags("");
    setHistory([]);
    void action(async () => {
      const h = await api.history(activeId);
      if (currentId.current === activeId) setHistory(h);
    });
  }, [activeId]);
  useEffect(() => {
    if (page !== "library" || !article || !reader.current) return;
    const el = reader.current;
    requestAnimationFrame(() => {
      el.scrollTop =
        article.position * Math.max(0, el.scrollHeight - el.clientHeight);
    });
  }, [activeId, page]);
  function openArticle(a: Article) {
    flushPosition();
    setActiveId(a.id);
    setPage("library");
    setAdding(false);
    setError("");
  }
  function onScroll() {
    const el = reader.current;
    if (!el || !article) return;
    const position =
      el.scrollHeight <= el.clientHeight
        ? 0
        : el.scrollTop / (el.scrollHeight - el.clientHeight);
    pendingPosition.current = { id: article.id, position };
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = setTimeout(flushPosition, 250);
    setData((d) =>
      d
        ? {
            ...d,
            articles: d.articles.map((a) =>
              a.id === article.id ? { ...a, position } : a,
            ),
          }
        : d,
    );
  }
  function capture() {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !body.current || !article) return;
    const range = s.getRangeAt(0);
    if (
      !body.current.contains(range.startContainer) ||
      !body.current.contains(range.endContainer) ||
      s.isCollapsed
    )
      return;
    const before = range.cloneRange();
    before.selectNodeContents(body.current);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    const text = article.body.slice(start, end);
    if (!text.trim()) return;
    const left = article.body.slice(0, start).search(/[^.!?\n]*$/);
    const right = article.body.slice(end).search(/[.!?\n]/);
    const sentence = article.body
      .slice(
        left < 0 ? 0 : left,
        right < 0 ? article.body.length : end + right + 1,
      )
      .trim();
    setSelection({ text, start, end, sentence });
    setAnalysis(undefined);
    setDraftNote("");
    setDraftTags("");
    setError("");
  }
  async function analyze(kind: Kind) {
    if (!article || analysisArticle.current) return;
    const articleId = article.id;
    analysisArticle.current = articleId;
    setElapsed(0);
    setProgress({ articleId, phase: "authorizing", characters: 0 });
    setLastKind(kind);
    setBusy(true);
    setError("");
    try {
      const a = await api.analyze({
        articleId,
        kind,
        start: selection.start,
        end: selection.end,
      });
      if (currentId.current === articleId) {
        setAnalysis(a);
        setHistory((h) => [a, ...h.filter((x) => x.id !== a.id)]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      analysisArticle.current = undefined;
      setBusy(false);
    }
  }
  async function star(item?: LearningItem) {
    if (!article) return;
    const term = item?.term ?? analysis?.selection ?? selection.text;
    if (!term.trim()) return;
    const f: Favorite = {
      id: crypto.randomUUID(),
      articleId: article.id,
      title: article.title,
      source: article.source,
      term,
      meaning: item?.meaning ?? analysis?.result.translation ?? "",
      sentence:
        item?.originalSentence ??
        (selection.sentence || analysis?.selection || term),
      examples: item?.examples ?? [],
      note: draftNote,
      tags: draftTags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      analysisId: analysis?.id ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await action(async () => {
      await api.saveFavorite(f);
      await refresh();
      setNotice("已加入星號收藏，筆記已保存。");
    });
  }
  async function preferences(p: Preferences) {
    await action(async () => {
      await api.settings({ preferences: p });
      await refresh();
    });
  }
  const filtered =
    data?.articles.filter((a) =>
      (a.title + " " + a.body).toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const favorites =
    data?.favorites.filter(
      (f) =>
        (
          f.term +
          " " +
          f.meaning +
          " " +
          f.note +
          " " +
          f.title +
          " " +
          f.tags.join(" ")
        )
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!tagFilter || f.tags.includes(tagFilter)),
    ) ?? [];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            R<span>·</span>
          </span>
          <div>
            Reading Desk<small>每天，讀懂多一點。</small>
          </div>
        </div>
        <div className="nav-label">我的學習空間</div>
        <nav>
          {(["library", "favorites", "settings"] as const).map((p, i) => (
            <button
              className={page === p ? "nav active" : "nav"}
              key={p}
              onClick={() => {
                flushPosition();
                setPage(p);
                setSearch("");
                setError("");
              }}
            >
              <span>{["▤", "☆", "⚙"][i]}</span>
              {["文章庫", "星號收藏", "設定"][i]}
              {p !== "settings" && (
                <b>
                  {p === "library"
                    ? (data?.articles.length ?? 0)
                    : (data?.favorites.length ?? 0)}
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-dot" /> 儲存在這台電腦
          <small>原文閱讀 · 語境學習</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR READING SPACE</span>
            <h1>
              {page === "library"
                ? "文章庫"
                : page === "favorites"
                  ? "星號收藏"
                  : "設定"}
            </h1>
          </div>
          <div className="top-actions">
            <button
              title="切換明暗模式"
              onClick={() =>
                void preferences({
                  ...prefs,
                  theme: prefs.theme === "light" ? "dark" : "light",
                })
              }
            >
              {prefs.theme === "light" ? "☾ 深色" : "☀ 淺色"}
            </button>
            <button className="primary" onClick={() => setAdding(true)}>
              ＋ 新增文章
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="banner error">
            {error}
            <button onClick={() => setError("")}>關閉</button>
          </div>
        )}
        {notice && (
          <div role="status" className="banner">
            {notice}
            <button onClick={() => setNotice("")}>關閉</button>
          </div>
        )}
        {!data ? (
          <div className="empty">
            <h2>正在開啟閱讀空間…</h2>
          </div>
        ) : page === "settings" ? (
          <Settings
            data={data}
            onSave={async (p) => {
              await api.settings({
                preferences: p,
              });
              await refresh();
              setNotice("設定已保存。");
            }}
            onSessionChange={async () => {
              await refresh();
            }}
            onBackup={async (mode) => {
              await action(async () => {
                flushPosition();
                const done =
                  mode === "export"
                    ? await api.exportBackup()
                    : await api.importBackup(mode);
                if (done) {
                  await refresh();
                  setActiveId("");
                  setAnalysis(undefined);
                  setNotice(
                    mode === "export" ? "備份已匯出。" : "備份已還原。",
                  );
                }
              });
            }}
            onError={setError}
          />
        ) : page === "favorites" ? (
          <section className="favorites-page">
            <div className="section-title">
              <div>
                <h2>把理解，留下來。</h2>
                <p>每個語境都值得獨立記錄。</p>
              </div>
              <span>{data.favorites.length} 筆收藏</span>
            </div>
            <div className="search-row">
              <input
                aria-label="搜尋收藏"
                placeholder="搜尋字詞、意思、來源或筆記…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="標籤篩選"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">所有標籤</option>
                {Array.from(new Set(data.favorites.flatMap((f) => f.tags))).map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
            </div>
            <div className="favorite-grid">
              {favorites.map((f) => (
                <button
                  className="favorite-card"
                  key={f.id}
                  onClick={() => setEditing(f)}
                >
                  <span className="star">★</span>
                  <h3>{f.term}</h3>
                  <p>{f.meaning || "尚未填寫本文意思"}</p>
                  <blockquote>{f.sentence}</blockquote>
                  <div className="tags">
                    {f.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                  <small>{f.title}</small>
                  {f.note && <p className="note-preview">{f.note}</p>}
                </button>
              ))}
            </div>
            {!favorites.length && (
              <div className="empty">
                <span className="empty-icon">☆</span>
                <h2>
                  {search || tagFilter ? "沒有符合的收藏" : "留住每一次理解"}
                </h2>
                <p>
                  閱讀時選取字詞，加上星號與自己的筆記。未設定 AI 也能收藏。
                </p>
              </div>
            )}
          </section>
        ) : (
          <div className="reading-layout">
            <section className="article-list">
              <div className="list-heading">
                閱讀清單 <span>{data.articles.length}</span>
              </div>
              <input
                aria-label="搜尋文章"
                className="search"
                placeholder="搜尋文章…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="article-items">
                {filtered.map((a) => (
                  <div
                    className={
                      "article-entry " + (a.id === activeId ? "selected" : "")
                    }
                    key={a.id}
                  >
                    <button
                      className="article-open"
                      onClick={() => openArticle(a)}
                    >
                      <small>
                        {new Date(a.createdAt).toLocaleDateString("zh-TW")} ·{" "}
                        {Math.max(
                          1,
                          Math.ceil(a.body.split(/\s+/).length / 220),
                        )}{" "}
                        分鐘
                      </small>
                      <strong>{a.title}</strong>
                      <p>{a.body.slice(0, 90)}</p>
                      <div className="progress">
                        <i style={{ width: `${a.position * 100}%` }} />
                      </div>
                    </button>
                    <div className="entry-actions">
                      <button
                        aria-label={`重新命名 ${a.title}`}
                        onClick={() => setRename(a)}
                      >
                        重新命名
                      </button>
                      <button
                        aria-label={`刪除 ${a.title}`}
                        onClick={() => setDeleteId(a.id)}
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {!filtered.length && (
                <p className="list-empty">
                  {search ? "沒有符合的文章" : "您的第一篇文章，從這裡開始。"}
                </p>
              )}
            </section>
            {article ? (
              <>
                <section className="reader" ref={reader} onScroll={onScroll}>
                  <div className="reader-tools">
                    <span>原文閱讀</span>
                    <div>
                      <button
                        aria-label="縮小字體"
                        onClick={() =>
                          void preferences({
                            ...prefs,
                            fontSize: Math.max(16, prefs.fontSize - 1),
                          })
                        }
                      >
                        A−
                      </button>
                      <span>{prefs.fontSize}</span>
                      <button
                        aria-label="放大字體"
                        onClick={() =>
                          void preferences({
                            ...prefs,
                            fontSize: Math.min(32, prefs.fontSize + 1),
                          })
                        }
                      >
                        A＋
                      </button>
                      <select
                        aria-label="行距"
                        value={prefs.lineHeight}
                        onChange={(e) =>
                          void preferences({
                            ...prefs,
                            lineHeight: Number(e.target.value),
                          })
                        }
                      >
                        {[1.4, 1.7, 1.9, 2.2, 2.6].map((n) => (
                          <option key={n} value={n}>
                            行距 {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <article className="reading-paper">
                    <div className="eyebrow">READ AT YOUR OWN PACE</div>
                    <h2>{article.title}</h2>
                    <div className="article-meta">
                      {article.body.split(/\s+/).length.toLocaleString()} 字 ·{" "}
                      {new Date(article.createdAt).toLocaleDateString("zh-TW")}
                      {article.source && (
                        <span title={article.source}>
                          來源：{new URL(article.source).hostname}
                        </span>
                      )}
                    </div>
                    <div
                      className="original-text"
                      ref={body}
                      onMouseUp={capture}
                      onKeyUp={capture}
                      style={{
                        fontSize: prefs.fontSize,
                        lineHeight: prefs.lineHeight,
                      }}
                    >
                      {article.body}
                    </div>
                    <div className="end-mark">◇</div>
                  </article>
                </section>
                <aside className="inspector">
                  <div className="inspector-heading">
                    <span>✧ 閱讀助手</span>
                    <small>ENGLISH ＋ 繁中輔助</small>
                  </div>
                  <div className="inspector-content">
                    <button
                      className="overview-button"
                      disabled={busy}
                      onClick={() => void analyze("overview")}
                    >
                      ✧ 整理全文學習重點
                    </button>
                    <p className="muted small">
                      僅在點擊時呼叫 AI；已完成的解析會保存在本機。
                    </p>
                    {selection.text && (
                      <div className="selection-box">
                        <small>目前選取</small>
                        <blockquote>{selection.text}</blockquote>
                        <div className="button-row">
                          <button
                            disabled={busy}
                            onClick={() => void analyze("word")}
                          >
                            字詞解析
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void analyze("sentence")}
                          >
                            句子解析
                          </button>
                        </div>
                      </div>
                    )}
                    {busy && (
                      <div className="loading" role="status">
                        {
                          {
                            authorizing: "正在確認訂閱授權",
                            connecting: "正在連線 AI 服務",
                            reasoning: "模型正在整理語境",
                            generating: "正在產生解析",
                            validating: "正在驗證解析資料",
                          }[progress?.phase ?? "connecting"]
                        }{" "}
                        · {elapsed} 秒
                        {!!progress?.characters && (
                          <p>
                            已收到 {progress.characters.toLocaleString()} 個字元
                          </p>
                        )}
                        <button
                          onClick={() => {
                            const articleId = analysisArticle.current;
                            if (articleId)
                              void api
                                .cancelAnalysis(articleId)
                                .catch((error) => setError(error.message));
                          }}
                        >
                          取消解析
                        </button>
                      </div>
                    )}
                    {!busy && error && (
                      <button onClick={() => void analyze(lastKind)}>
                        重試{labels[lastKind]}
                      </button>
                    )}
                    {analysis ? (
                      <div className="analysis-result">
                        <div className="result-heading">
                          <span>{labels[analysis.kind]}</span>
                          <small>已保存 · {analysis.model}</small>
                        </div>
                        {analysis.result.summary && (
                          <AnalysisText
                            title="摘要 SUMMARY"
                            text={analysis.result.summary}
                          />
                        )}
                        {analysis.result.translation && (
                          <AnalysisText
                            title="句意翻譯"
                            text={analysis.result.translation}
                          />
                        )}
                        {analysis.result.structure && (
                          <AnalysisText
                            title="句子結構 STRUCTURE"
                            text={analysis.result.structure}
                          />
                        )}
                        {analysis.result.idioms && (
                          <AnalysisText
                            title="慣用語 IDIOMS"
                            text={analysis.result.idioms}
                          />
                        )}
                        {analysis.result.tone && (
                          <AnalysisText
                            title="語氣 TONE"
                            text={analysis.result.tone}
                          />
                        )}
                        {analysis.result.items.map((item, i) => (
                          <div className="learning-item" key={i}>
                            <div className="term-line">
                              <h3>{item.term}</h3>
                              <button
                                title="收藏此項目"
                                onClick={() => void star(item)}
                              >
                                ☆ 收藏
                              </button>
                            </div>
                            <span className="part-of-speech">
                              {item.partOfSpeech}
                            </span>
                            <p>{item.meaning}</p>
                            <p className="english">{item.explanation}</p>
                            {!!item.collocations.length && (
                              <p className="collocations">
                                常見搭配：{item.collocations.join(" · ")}
                              </p>
                            )}
                            {item.examples.map((e, j) => (
                              <div className="example" key={j}>
                                <small>
                                  {e.context === "daily"
                                    ? "日常情境"
                                    : "接近原文的情境"}
                                </small>
                                <p>{e.english}</p>
                                <p className="muted">{e.chinese}</p>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      !selection.text && (
                        <div className="assistant-empty">
                          <span>“ ”</span>
                          <h3>理解，從一個詞開始。</h3>
                          <p>
                            選取原文中的字詞或句子，再點擊解析，探索它在文章中的意思。
                          </p>
                          {!data.chatGPT.sharing && (
                            <button onClick={() => setPage("settings")}>
                              使用 ChatGPT 訂閱 →
                            </button>
                          )}
                        </div>
                      )
                    )}
                    {(selection.text ||
                      (analysis && analysis.kind !== "overview")) && (
                      <div className="personal-note">
                        <label>
                          我的筆記
                          <textarea
                            placeholder="記下你對這個語境的理解…"
                            value={draftNote}
                            onChange={(e) => setDraftNote(e.target.value)}
                            maxLength={100000}
                          />
                        </label>
                        <input
                          placeholder="標籤，以逗號分隔"
                          aria-label="收藏標籤"
                          value={draftTags}
                          onChange={(e) => setDraftTags(e.target.value)}
                        />
                        <button
                          className="primary full"
                          onClick={() => void star(analysis?.result.items[0])}
                        >
                          ☆ 收藏並保存筆記
                        </button>
                      </div>
                    )}
                    {!!history.length && (
                      <div className="history">
                        <h4>這篇文章的解析紀錄</h4>
                        {history.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => {
                              setAnalysis(a);
                              setSelection({
                                text: a.selection,
                                start: a.start,
                                end: a.end,
                                sentence: a.selection,
                              });
                              setDraftNote("");
                              setDraftTags("");
                            }}
                          >
                            <span>{labels[a.kind]}</span>
                            {a.selection || "全文摘要與學習項目"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-book">
                  Aa<span>READING DESK</span>
                </div>
                <span className="eyebrow">ONE ARTICLE, A LITTLE FURTHER.</span>
                <h2>讀原文，累積自己的理解。</h2>
                <p>
                  貼上感興趣的英文文章，以自己的步調閱讀。
                  <br />
                  讓每一個字詞，回到它所在的語境。
                </p>
                <button className="primary" onClick={() => setAdding(true)}>
                  ＋ 貼上第一篇文章
                </button>
                <div className="welcome-features">
                  <span>▤ 原文完整保留</span>
                  <span>☆ 語境收藏</span>
                  <span>◉ 本機保存</span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      {adding && (
        <ArticleDialog
          onClose={() => setAdding(false)}
          onSave={async (input) => {
            flushPosition();
            const a = await api.addArticle(input);
            await refresh();
            openArticle(a);
          }}
        />
      )}
      {rename && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api.renameArticle({ id: rename.id, title: rename.title });
                await refresh();
                setRename(undefined);
              });
            }}
          >
            <h2>重新命名文章</h2>
            <input
              aria-label="新標題"
              autoFocus
              required
              maxLength={300}
              value={rename.title}
              onChange={(e) => setRename({ ...rename, title: e.target.value })}
            />
            <div className="modal-actions">
              <button type="button" onClick={() => setRename(undefined)}>
                取消
              </button>
              <button className="primary">保存</button>
            </div>
          </form>
        </div>
      )}
      {deleteId && (
        <div className="modal-backdrop">
          <div className="modal compact">
            <h2>刪除這篇文章？</h2>
            <p>文章與 AI 解析會刪除。星號收藏、原文摘錄與筆記會保留。</p>
            <div className="modal-actions">
              <button onClick={() => setDeleteId("")}>取消</button>
              <button
                className="danger"
                onClick={() =>
                  void action(async () => {
                    flushPosition();
                    await api.deleteArticle(deleteId);
                    if (activeId === deleteId) setActiveId("");
                    setDeleteId("");
                    await refresh();
                  })
                }
              >
                刪除文章
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <FavoriteDialog
          favorite={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (f) => {
            await api.saveFavorite(f);
            await refresh();
            setEditing(undefined);
          }}
          onDelete={async () => {
            await api.deleteFavorite(editing.id);
            await refresh();
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
function AnalysisText({ title, text }: { title: string; text: string }) {
  return (
    <section className="analysis-text">
      <h4>{title}</h4>
      <p>{text}</p>
    </section>
  );
}
function ArticleDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: {
    title: string;
    source: string;
    body: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal article-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              title: title.trim(),
              source: source.trim(),
              body: body.replace(/\r\n/g, "\n"),
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">A NEW CHAPTER</span>
            <h2>新增英文文章</h2>
          </div>
          <button type="button" aria-label="關閉新增文章" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted">
          保留原文程度。儲存後立即開始閱讀，AI 解析由您決定。
        </p>
        <label>
          文章標題
          <input
            autoFocus
            required
            maxLength={300}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="為這次閱讀取個名字"
          />
        </label>
        <label>
          來源網址 <small>選填</small>
          <input
            type="url"
            maxLength={2000}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label>
          英文原文
          <textarea
            required
            maxLength={200000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste your article here…"
          />
        </label>
        <small className="muted">
          {body.length.toLocaleString()} / 200,000 字元 · AI 解析上限 60,000
          字元
        </small>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !title.trim() || !body.trim()}
          >
            儲存並開始閱讀 →
          </button>
        </div>
      </form>
    </div>
  );
}
function FavoriteDialog({
  favorite,
  onClose,
  onSave,
  onDelete,
}: {
  favorite: Favorite;
  onClose: () => void;
  onSave: (f: Favorite) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [f, setF] = useState(favorite);
  const [tags, setTags] = useState(f.tags.join(", "));
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave({
              ...f,
              tags: Array.from(
                new Set(
                  tags
                    .split(/[,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              ),
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="modal-heading">
          <h2>★ 語境收藏</h2>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <label>
          字詞／句型
          <input
            required
            maxLength={10000}
            value={f.term}
            onChange={(e) => setF({ ...f, term: e.target.value })}
          />
        </label>
        <label>
          本文意思
          <textarea
            value={f.meaning}
            onChange={(e) => setF({ ...f, meaning: e.target.value })}
          />
        </label>
        <label>
          原文句子
          <textarea
            value={f.sentence}
            onChange={(e) => setF({ ...f, sentence: e.target.value })}
          />
        </label>
        <p className="muted small">
          來源：{f.title}
          <br />
          {f.source}
        </p>
        {f.examples.map((ex, i) => (
          <div className="example" key={i}>
            <p>{ex.english}</p>
            <p>{ex.chinese}</p>
          </div>
        ))}
        <label>
          個人筆記
          <textarea
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </label>
        <label>
          標籤
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="以逗號分隔"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="danger-text"
            onClick={() => {
              if (!confirm) {
                setConfirm(true);
                return;
              }
              void onDelete().catch((e) => setError(e.message));
            }}
          >
            {confirm ? "確定取消收藏" : "取消收藏"}
          </button>
          <button type="button" onClick={onClose}>
            關閉
          </button>
          <button className="primary">保存變更</button>
        </div>
      </form>
    </div>
  );
}
function Settings({
  data,
  onSave,
  onSessionChange,
  onBackup,
  onError,
}: {
  data: Snapshot;
  onSave: (p: Preferences) => Promise<void>;
  onSessionChange: () => Promise<void>;
  onBackup: (mode: "export" | "merge" | "replace") => Promise<void>;
  onError: (s: string) => void;
}) {
  const [p, setP] = useState(data.preferences);
  useEffect(() => setP(data.preferences), [data.preferences]);
  const [connecting, setConnecting] = useState(false);
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [modelError, setModelError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const account = data.chatGPT;
  const activeProfile = account.profiles.find(
    (profile) => profile.id === account.activeProfileId,
  );
  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModelError("");
    if (!account.sharing) return;
    setModelLoading(true);
    void api
      .models()
      .then((result) => {
        if (!cancelled) setModels(result);
      })
      .catch((error) => {
        if (!cancelled) setModelError(error.message);
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.activeProfileId, account.sharing]);
  async function connectionAction(operation: () => Promise<unknown>) {
    setConnecting(true);
    setConnectionNotice("");
    try {
      await operation();
    } catch (error) {
      setConnectionNotice((error as Error).message);
    } finally {
      try {
        await onSessionChange();
      } catch (error) {
        onError((error as Error).message);
      }
      setConnecting(false);
    }
  }
  return (
    <section className="settings-page">
      <div className="section-title">
        <div>
          <h2>建立適合自己的閱讀空間。</h2>
          <p>本機優先，解析由您掌握。</p>
        </div>
      </div>
      <div className="settings-card">
        <h3>ChatGPT 訂閱</h3>
        <p>
          使用自己的 ChatGPT 帳戶登入，並允許 Reading Desk
          使用方案中的用量。解析會計入您的訂閱限制，可在 ChatGPT 管理本 App
          的用量。
        </p>
        {!!account.profiles.length && (
          <label>
            ChatGPT 帳戶
            <select
              aria-label="ChatGPT 帳戶"
              disabled={connecting || account.signingIn}
              value={account.activeProfileId ?? ""}
              onChange={(event) =>
                void connectionAction(() =>
                  api.selectAccount(event.target.value),
                )
              }
            >
              {account.profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.email} · {profile.id.slice(0, 6)}
                  {profile.connected ? "" : "（已登出）"}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="status-pill" role="status">
          {account.sharing
            ? "已啟用 · 使用 ChatGPT 訂閱"
            : account.connected
              ? "已登入 · 尚未允許使用訂閱"
              : "尚未登入 ChatGPT"}
        </p>
        {activeProfile && <p>{activeProfile.email}</p>}
        <div className="button-row">
          <button
            className="primary"
            disabled={connecting || account.signingIn}
            onClick={() =>
              void connectionAction(() =>
                api.signIn({ profileId: account.activeProfileId ?? undefined }),
              )
            }
          >
            Continue with ChatGPT
          </button>
          {account.connected && !account.sharing && (
            <button
              disabled={connecting}
              onClick={() =>
                void connectionAction(() =>
                  api.signIn({
                    profileId: account.activeProfileId!,
                    enableSharing: true,
                  }),
                )
              }
            >
              啟用訂閱使用授權
            </button>
          )}
          {!!account.profiles.length && (
            <button
              disabled={connecting || account.signingIn}
              onClick={() => void connectionAction(() => api.signIn())}
            >
              新增帳戶
            </button>
          )}
          {account.connected && (
            <button
              disabled={connecting || account.signingIn}
              onClick={() =>
                void connectionAction(async () => {
                  const result = await api.signOut();
                  setConnectionNotice(
                    result.remoteRevoked
                      ? "已登出 ChatGPT。"
                      : "已在此電腦登出，遠端撤銷尚未確認。請到 ChatGPT 設定中中斷此 App 的連線。",
                  );
                })
              }
            >
              登出
            </button>
          )}
          <button
            onClick={() =>
              void api.manageUsage().catch((error) => onError(error.message))
            }
          >
            管理 ChatGPT 用量
          </button>
        </div>
        {(connecting || account.signingIn) && (
          <p role="status">
            請在瀏覽器完成登入與授權。
            <button
              onClick={() =>
                void api.cancelSignIn().catch((error) => onError(error.message))
              }
            >
              取消登入
            </button>
          </p>
        )}
        {(connectionNotice || account.error) && (
          <p role="alert" className="error-text">
            {connectionNotice || account.error}
          </p>
        )}
        <p className="muted small">
          登入憑證由 Windows
          安全儲存機制加密保存。未登入時仍可閱讀、管理收藏筆記與備份。
        </p>
      </div>
      <form
        className="settings-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave(p);
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <h3>✧ AI 解析</h3>
        <p>解析由 ChatGPT 訂閱提供。只有主動解析時會傳送該篇原文及選取內容。</p>
        <label>
          解析模型
          <select
            aria-label="解析模型"
            disabled={!account.sharing || modelLoading}
            value={p.model}
            onChange={(e) => setP({ ...p, model: e.target.value })}
          >
            {!models.some((model) => model.slug === p.model) && (
              <option value={p.model}>
                {account.sharing ? "請選擇帳戶可用模型" : "登入後載入可用模型"}
              </option>
            )}
            {models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        {modelError && (
          <p role="alert" className="error-text">
            {modelError}
          </p>
        )}
        {account.sharing && (
          <button
            type="button"
            disabled={modelLoading || connecting}
            onClick={async () => {
              setModelLoading(true);
              try {
                setModels(await api.models());
                setModelError("");
              } catch (error) {
                setModelError((error as Error).message);
              } finally {
                setModelLoading(false);
              }
            }}
          >
            {modelLoading ? "正在載入模型…" : "重新整理可用模型"}
          </button>
        )}
        <h3>閱讀外觀</h3>
        <div className="settings-row">
          <label>
            模式
            <select
              value={p.theme}
              onChange={(e) =>
                setP({ ...p, theme: e.target.value as Preferences["theme"] })
              }
            >
              <option value="light">淺色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label>
            字體大小
            <input
              type="number"
              min={16}
              max={32}
              value={p.fontSize}
              onChange={(e) => setP({ ...p, fontSize: Number(e.target.value) })}
            />
          </label>
          <label>
            行距
            <input
              type="number"
              step={0.1}
              min={1.4}
              max={2.6}
              value={p.lineHeight}
              onChange={(e) =>
                setP({ ...p, lineHeight: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <button className="primary" disabled={saving}>
          保存設定
        </button>
      </form>
      <div className="settings-card">
        <h3>備份與還原</h3>
        <p>
          包含文章、閱讀位置、解析、收藏及筆記。備份為未加密
          JSON，請自行妥善保存。
        </p>
        <div className="button-row">
          <button onClick={() => void onBackup("export")}>匯出備份</button>
          <button onClick={() => void onBackup("merge")}>合併還原</button>
          <button onClick={() => void onBackup("replace")}>取代還原</button>
        </div>
        <p className="muted small">
          合併：ID 衝突時建立副本，保留本機外觀設定。
          <br />
          取代：取代本機文章、解析、收藏及外觀設定。
          <br />
          還原前會驗證格式並在資料目錄自動保存安全備份。ChatGPT
          登入憑證獨立保存在這台電腦。
        </p>
        <h4>資料儲存位置</h4>
        <code>{data.dataPath}</code>
      </div>
    </section>
  );
}
