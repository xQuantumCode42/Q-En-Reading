import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  session,
  shell,
} from "electron";
import { join } from "node:path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store } from "./store";
import { OpenAIProvider, type AIProvider } from "./ai";
import { ChatGPTAuth } from "./chatgpt-auth";
import { abortable } from "./abort";
import type { AnalysisPhase } from "../shared/api";
import {
  articleSchema,
  favoriteSchema,
  id,
  kindSchema,
  preferencesSchema,
  type Article,
  type Analysis,
  type Favorite,
} from "../shared/schema";
import type { Reply } from "../shared/api";

app.setName("Reading Desk");
if (process.env.READING_DESK_TEST_DATA)
  app.setPath("userData", process.env.READING_DESK_TEST_DATA);
let win: BrowserWindow;
let store: Store;
let auth: ChatGPTAuth;
const provider: AIProvider = new OpenAIProvider();
const pending = new Map<string, Promise<Analysis>>();
const activeRequests = new Map<
  string,
  { articleId: string; controller: AbortController }
>();
const now = () => new Date().toISOString();
const safeAvailable = async () =>
  (await safeStorage.isAsyncEncryptionAvailable()) &&
  !(
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  );
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
function assertAccountIdle() {
  if (pending.size) throw new Error("請等待 AI 解析完成後再變更登入帳戶。");
}
async function chooseAccountModel() {
  const state = await auth.session();
  if (!state.sharing) return;
  const models = await auth.models();
  if (!models.length)
    throw new Error("這個 ChatGPT 帳戶目前沒有可用模型，請確認訂閱授權。");
  const preferences = store.preferences();
  if (!models.some((model) => model.slug === preferences.model))
    store.setPreferences({ ...preferences, model: models[0].slug });
}
function register<T>(
  channel: string,
  schema: z.ZodType<T>,
  fn: (arg: T) => unknown,
) {
  ipcMain.handle(channel, async (event, input): Promise<Reply<unknown>> => {
    try {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("未授權的介面請求。");
      const url = event.senderFrame.url;
      if (
        process.env.READING_DESK_DEV === "1"
          ? !url.startsWith("http://127.0.0.1:5173/")
          : url !==
            require("node:url").pathToFileURL(
              join(__dirname, "../../dist/index.html"),
            ).href
      )
        throw new Error("未授權的頁面來源。");
      return { ok: true, data: await fn(schema.parse(input)) };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof z.ZodError
            ? "資料格式不正確，請檢查輸入或備份檔。"
            : e instanceof Error
              ? e.message
              : "操作失敗，請重試。",
      };
    }
  });
}
function articleById(articleId: string) {
  const a = store.get<Article>("article", articleId);
  if (!a) throw new Error("文章不存在，可能已被刪除。");
  return a;
}
function registerHandlers() {
  ipcMain.on("article:position:flush", (event, input) => {
    try {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error("未授權");
      const p = z
        .object({ id, position: z.number().min(0).max(1) })
        .strict()
        .parse(input);
      store.put("article", { ...articleById(p.id), position: p.position });
      event.returnValue = { ok: true, data: undefined };
    } catch {
      event.returnValue = { ok: false, error: "閱讀位置保存失敗。" };
    }
  });
  register("snapshot", z.undefined(), async () => ({
    articles: store.list<Article>("article"),
    favorites: store.list<Favorite>("favorite"),
    preferences: store.preferences(),
    chatGPT: await auth.session(),
    dataPath: app.getPath("userData"),
  }));
  register(
    "article:add",
    articleSchema.pick({ title: true, source: true, body: true }),
    (input) => {
      const a: Article = {
        ...input,
        id: randomUUID(),
        position: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      store.put("article", a);
      return a;
    },
  );
  register(
    "article:rename",
    z.object({ id, title: articleSchema.shape.title }).strict(),
    (input) =>
      store.put("article", {
        ...articleById(input.id),
        title: input.title,
        updatedAt: now(),
      }),
  );
  register("article:delete", id, (articleId) => store.deleteArticle(articleId));
  register(
    "article:position",
    z.object({ id, position: z.number().min(0).max(1) }).strict(),
    (input) =>
      store.put("article", {
        ...articleById(input.id),
        position: input.position,
      }),
  );
  register("analysis:history", id, (articleId) =>
    store.list<Analysis>("analysis").filter((a) => a.articleId === articleId),
  );
  register(
    "analysis:run",
    z
      .object({
        articleId: id,
        kind: kindSchema,
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .strict(),
    async (input) => {
      const article = articleById(input.articleId);
      const { kind } = input;
      if (input.end < input.start || input.end > article.body.length)
        throw new Error("選取範圍不正確。");
      const start = kind === "overview" ? 0 : input.start;
      const end = kind === "overview" ? 0 : input.end;
      const selection =
        kind === "overview" ? "" : article.body.slice(start, end);
      if (
        kind !== "overview" &&
        (!selection.trim() || selection.length > 10000)
      )
        throw new Error("請選取 1–10,000 個字元。");
      const model = store.preferences().model;
      const cached = store
        .list<Analysis>("analysis")
        .find(
          (a) =>
            a.articleId === article.id &&
            a.kind === kind &&
            a.start === start &&
            a.end === end &&
            a.model === model,
        );
      if (cached) return cached;
      if (article.body.length > 60000)
        throw new Error(
          "AI 解析目前支援最多 60,000 字元，請將文章分篇；閱讀及儲存仍可使用。",
        );
      const cacheKey = JSON.stringify([article.id, kind, start, end, model]);
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      if (pending.size >= 2) throw new Error("已有解析進行中，請完成後重試。");
      const controller = new AbortController();
      let phase: AnalysisPhase = "authorizing";
      let lastSent = 0;
      const publish = (next: AnalysisPhase, characters: number) => {
        const changed = phase !== next;
        phase = next;
        if (!changed && Date.now() - lastSent < 200) return;
        lastSent = Date.now();
        if (!win.isDestroyed())
          win.webContents.send("analysis:progress", {
            articleId: article.id,
            phase,
            characters,
          });
      };
      const timeout = setTimeout(
        () =>
          controller.abort(
            new Error(
              `AI 解析逾時（90 秒，階段：${{ authorizing: "確認訂閱", connecting: "連線服務", reasoning: "整理語境", generating: "產生解析", validating: "驗證資料" }[phase]}），請重試或選擇其他可用模型。`,
            ),
          ),
        90000,
      );
      activeRequests.set(cacheKey, { articleId: article.id, controller });
      const promise = (async () => {
        publish("authorizing", 0);
        const accessToken = await abortable(
          auth.accessToken(),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const result = await provider.analyze(
          article,
          kind,
          selection,
          model,
          accessToken,
          {
            signal: controller.signal,
            selectionStart: start,
            onProgress: publish,
          },
        );
        controller.signal.throwIfAborted();
        articleById(article.id);
        const analysis: Analysis = {
          id: randomUUID(),
          articleId: article.id,
          kind,
          selection,
          start,
          end,
          result,
          model,
          createdAt: now(),
        };
        store.put("analysis", analysis);
        return analysis;
      })();
      pending.set(cacheKey, promise);
      try {
        return await abortable(promise, controller.signal);
      } finally {
        clearTimeout(timeout);
        activeRequests.delete(cacheKey);
        pending.delete(cacheKey);
      }
    },
  );
  register("analysis:cancel", id, (articleId) => {
    for (const request of activeRequests.values())
      if (request.articleId === articleId)
        request.controller.abort(
          new Error("已取消解析。文章與選取內容已保留。"),
        );
  });
  register("favorite:save", favoriteSchema, (f) => {
    store.put("favorite", { ...f, updatedAt: now() });
  });
  register("favorite:delete", id, (f) => store.remove("favorite", f));
  register(
    "settings:save",
    z
      .object({
        preferences: preferencesSchema,
      })
      .strict(),
    (input) => {
      store.setPreferences(input.preferences);
    },
  );
  register(
    "chatgpt:sign-in",
    z
      .object({
        profileId: id.optional(),
        enableSharing: z.boolean().optional(),
      })
      .strict()
      .optional(),
    async (input) => {
      assertAccountIdle();
      await auth.signIn(input);
      const legacyKey = join(app.getPath("userData"), "api-key.encrypted");
      if (existsSync(legacyKey)) unlinkSync(legacyKey);
      await chooseAccountModel();
    },
  );
  register("chatgpt:cancel", z.undefined(), () => auth.cancelSignIn());
  register("chatgpt:select", id, async (profileId) => {
    assertAccountIdle();
    await auth.selectAccount(profileId);
    await chooseAccountModel();
  });
  register("chatgpt:sign-out", z.undefined(), () => {
    assertAccountIdle();
    return auth.signOut();
  });
  register("chatgpt:models", z.undefined(), () => auth.models());
  register("chatgpt:usage", z.undefined(), () =>
    shell.openExternal("https://chatgpt.com/settings/usage"),
  );
  register("backup:export", z.undefined(), async () => {
    const result = await dialog.showSaveDialog(win, {
      title: "匯出 Reading Desk 備份",
      defaultPath: `reading-desk-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Reading Desk 備份", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(
      result.filePath,
      JSON.stringify(store.backup(), null, 2),
      "utf8",
    );
    return true;
  });
  register("backup:import", z.enum(["merge", "replace"]), async (mode) => {
    if (pending.size) throw new Error("請等待 AI 解析完成後再還原備份。");
    const result = await dialog.showOpenDialog(win, {
      title: "選擇 Reading Desk 備份",
      properties: ["openFile"],
      filters: [{ name: "Reading Desk 備份", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    const file = result.filePaths[0];
    if (statSync(file).size > 100 * 1024 * 1024)
      throw new Error("備份不得超過 100 MB。");
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error("無法讀取 JSON 備份。");
    }
    // Validate before confirmation, automatic safety copy, and transaction.
    const { backupSchema } = await import("../shared/schema");
    const b = backupSchema.parse(value);
    const confirm = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["取消", "還原"],
      defaultId: 0,
      cancelId: 0,
      title: "確認還原備份",
      message:
        mode === "replace"
          ? "將取代所有文章、解析與收藏。"
          : "合併備份；ID 衝突會建立新副本，不覆寫本機資料。",
      detail: `備份包含 ${b.articles.length} 篇文章、${b.favorites.length} 筆收藏。還原前將自動保存一份本機安全備份。ChatGPT 登入憑證由此電腦獨立保存。`,
    });
    if (confirm.response !== 1) return false;
    writeFileSync(
      join(app.getPath("userData"), `before-restore-${Date.now()}.json`),
      JSON.stringify(store.backup()),
    );
    store.restore(b, mode);
    return true;
  });
}
app.whenReady().then(() => {
  if (!primaryInstance) return;
  mkdirSync(app.getPath("userData"), { recursive: true });
  store = new Store(join(app.getPath("userData"), "reading-desk.sqlite"));
  auth = new ChatGPTAuth(app.getPath("userData"), {
    openBrowser: (url) => shell.openExternal(url),
    encrypt: async (text) => {
      if (!(await safeAvailable()))
        throw new Error("作業系統安全儲存無法使用，無法保存 ChatGPT 登入。");
      return safeStorage.encryptStringAsync(text);
    },
    decrypt: async (buffer) => {
      if (!(await safeAvailable()))
        throw new Error("作業系統安全儲存無法使用。");
      return (await safeStorage.decryptStringAsync(buffer)).result;
    },
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  win = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: "#f4f3ef",
    title: "Reading Desk",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.removeMenu();
  registerHandlers();
  if (process.env.READING_DESK_DEV === "1")
    void win.loadURL("http://127.0.0.1:5173");
  else void win.loadFile(join(__dirname, "../../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  auth?.cancelSignIn();
  store?.close();
});
