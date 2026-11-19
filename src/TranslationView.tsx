import { useState } from "react";
import type { Article, Analysis } from "../shared/schema";
import { savedTranslations } from "../shared/translation";

export function TranslationView({
  article,
  history,
  model,
  busy,
  translating,
  completed,
  error,
  onGenerate,
  onCancel,
}: {
  article: Article;
  history: Analysis[];
  model: string;
  busy: boolean;
  translating: boolean;
  completed: number;
  error: string;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const [chineseOnly, setChineseOnly] = useState(false);
  const [chosenModel, setChosenModel] = useState<string>();
  const available = savedTranslations(article.body, history, model);
  const selectedModel = chosenModel ?? available.selectedModel;
  const { chunks, saved } = savedTranslations(
    article.body,
    history.filter((a) => a.model === selectedModel),
    selectedModel,
  );
  const models = [
    model,
    ...available.models.map((m) => m.model).filter((m) => m !== model),
  ];
  const count = saved.filter(Boolean).length;
  return (
    <section className="translation-view" aria-label="全文中文對照">
      <div className="translation-heading">
        <div>
          <h2>{article.title}</h2>
          <p>完整翻譯原文，不縮寫、不簡化；每段完成後保存在這台電腦。</p>
        </div>
        <button
          aria-pressed={chineseOnly}
          onClick={() => setChineseOnly((v) => !v)}
        >
          {chineseOnly ? "顯示英文對照" : "只看中文"}
        </button>
      </div>
      <div className="translation-actions">
        <label>
          翻譯版本
          <select
            aria-label="翻譯版本"
            disabled={busy}
            value={selectedModel}
            onChange={(e) => setChosenModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === model ? "（目前設定）" : "（已保存）"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || count === chunks.length}
          onClick={() => {
            setChosenModel(model);
            onGenerate();
          }}
        >
          {count === chunks.length
            ? "全文翻譯已保存"
            : selectedModel !== model
              ? "使用目前模型產生翻譯"
              : count
                ? "繼續全文翻譯"
                : "產生全文中文翻譯"}
        </button>
        <span role="status">
          已保存 {count}／{chunks.length} 段
          {translating ? ` · 正在處理第 ${completed + 1} 段` : ""}
        </span>
        {translating && <button onClick={onCancel}>取消翻譯</button>}
      </div>
      <p className="muted small">
        已保存的翻譯不會因切換模型而消失，可用「翻譯版本」查看。產生或接續翻譯會使用目前設定的模型。
        只有按產生／繼續時才使用 ChatGPT
        訂閱。失敗或取消會保留已完成的段落，下次接續；每段最多等待 90 秒。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {chunks.map((chunk, index) => (
        <article
          className={`translation-pair ${chineseOnly ? "chinese-only" : ""}`}
          key={chunk.start}
        >
          {!chineseOnly && (
            <div className="translation-original">
              <small>原文 · {index + 1}</small>
              <p>{article.body.slice(chunk.start, chunk.end)}</p>
            </div>
          )}
          <div className="translation-chinese">
            <small>繁體中文 · {index + 1}</small>
            <p>
              {saved[index]?.result.translation ??
                "尚未翻譯，請按上方按鈕開始。"}
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}
