import { useEffect, useState } from "react";
import {
  localDay,
  recommendationSettingsSchema,
  type RecommendationSettings,
  type RecommendationState,
} from "../shared/recommendations";

export function DailyRecommendation({
  state,
  connected,
  enabled,
  compact,
  onRetry,
  onRefresh,
  onCancel,
  onSettings,
  onOpen,
  bookmarked,
  onBookmark,
}: {
  state?: RecommendationState;
  connected: boolean;
  enabled: boolean;
  compact: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onSettings: () => void;
  onOpen: (day: string) => void;
  bookmarked: boolean;
  onBookmark: (day: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const day = localDay();
  const current = state?.day === day ? state : undefined;
  const record = current?.recommendation;
  return (
    <section
      className={`daily-card ${compact ? "compact" : ""}`}
      aria-label="今日推薦"
    >
      <div className="daily-heading">
        <span>✦ TODAY'S READING</span>
        <small>{day} · 每日一篇</small>
        <button className="text-button" onClick={onSettings}>
          管理推薦來源
        </button>
      </div>
      {record ? (
        <>
          <a
            className="daily-title"
            href={record.url}
            onClick={(event) => {
              event.preventDefault();
              onOpen(record.day);
            }}
          >
            {record.title}
          </a>
          {!compact && <p className="daily-reason">{record.reasonChinese}</p>}
          <div className="daily-meta">
            <button
              disabled={
                !connected ||
                !enabled ||
                current?.status === "searching" ||
                saving
              }
              onClick={onRefresh}
            >
              {current?.status === "searching"
                ? "正在刷新推薦…"
                : "↻ 刷新今日推薦"}
            </button>
            <button
              disabled={saving || bookmarked || current?.status === "searching"}
              aria-pressed={bookmarked}
              onClick={async () => {
                setSaving(true);
                try {
                  await onBookmark(record.day);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {bookmarked ? "★ 已收藏文章" : saving ? "收藏中…" : "☆ 收藏文章"}
            </button>
            <a
              href={record.url}
              onClick={(event) => {
                event.preventDefault();
                onOpen(record.day);
              }}
            >
              搜尋來源：{new URL(record.url).hostname}
            </a>
            <span>
              {record.publishedDate
                ? `刊登於 ${record.publishedDate}`
                : "刊登日期未確認"}
            </span>
            <span>重開沿用這篇，也可手動刷新</span>
          </div>
          {current?.status === "searching" && (
            <div className="daily-status" role="status">
              <p>正在重新搜尋不同的文章，完成前保留原推薦。</p>
              <button onClick={onCancel}>取消搜尋</button>
            </div>
          )}
          {current?.error && (
            <p role="alert" className="error-text">
              {current.error}
            </p>
          )}
        </>
      ) : current?.status === "searching" ? (
        <div className="daily-status" role="status">
          <p>正在從收藏網站與近期新聞中挑選今天值得讀的一篇…</p>
          <button onClick={onCancel}>取消搜尋</button>
        </div>
      ) : current?.status === "error" ? (
        <div className="daily-status">
          <p role="alert">{current.error}</p>
          <button disabled={!connected || !enabled} onClick={onRetry}>
            重試今日推薦
          </button>
        </div>
      ) : (
        <div className="daily-status">
          <p>
            {!enabled
              ? "每日推薦已關閉，可在推薦設定重新開啟。"
              : !connected
                ? "登入 ChatGPT 並啟用訂閱後，會自動尋找今日推薦。"
                : "今天尚未選定文章。收藏網站與近期新聞會一起評選。"}
          </p>
          {connected && enabled && (
            <button onClick={onRetry}>尋找今日推薦</button>
          )}
        </div>
      )}
    </section>
  );
}

export function RecommendationSettingsEditor({
  settings,
  onSave,
}: {
  settings: RecommendationSettings;
  onSave: (settings: RecommendationSettings) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [websites, setWebsites] = useState(settings.websites.join("\n"));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEnabled(settings.enabled);
    setWebsites(settings.websites.join("\n"));
  }, [settings]);
  return (
    <form
      className="settings-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          await onSave(
            recommendationSettingsSchema.parse({
              enabled,
              websites: websites
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
            }),
          );
          setSaved(true);
        } catch {
          setError(
            "無法保存，請確認最多 10 個公開網站網址（每行一個），不含登入資訊或本機位址；若資料正確請稍後重試。",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>每日文章推薦</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setSaved(false);
          }}
        />
        登入後自動尋找每日推薦
      </label>
      <label>
        收藏英文網站
        <textarea
          aria-label="收藏英文網站"
          rows={4}
          value={websites}
          placeholder={"https://www.npr.org/\nhttps://www.smithsonianmag.com/"}
          onChange={(event) => {
            setWebsites(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <p className="muted small">
        最多 10
        個，每行一個。只保存公開網站的網域；收藏網站與一般時事一起評選，不保證只從收藏網站選文。只有網站網域會交給
        AI，不傳送文章庫與筆記。
      </p>
      <p className="muted small">
        每天自動推薦一篇，重開及修改網站或模型會沿用今天的結果；按「刷新今日推薦」才會重新搜尋不同文章，會使用訂閱搜尋用量。失敗或取消保留原推薦。推薦可一鍵收藏連結，之後在文章收藏匯入公開正文；不繞過付費牆。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {saved && <p role="status">推薦設定已保存。</p>}
      <button className="primary" disabled={busy}>
        保存推薦設定
      </button>
    </form>
  );
}
