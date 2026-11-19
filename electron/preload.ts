import { contextBridge, ipcRenderer } from "electron";
import type { API, Reply, AnalysisProgress } from "../shared/api";
async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, input)) as Reply<T>;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const api: API = {
  // Only used during window unload, so the last scroll survives immediate close.
  flushPosition: (x) => {
    const r = ipcRenderer.sendSync("article:position:flush", x) as Reply<void>;
    if (!r.ok) throw new Error(r.error);
  },
  snapshot: () => invoke("snapshot"),
  recommendation: (retry) => invoke("recommendation:run", retry ?? false),
  refreshRecommendation: () => invoke("recommendation:refresh"),
  cancelRecommendation: () => invoke("recommendation:cancel"),
  recommendationSettings: (input) => invoke("recommendation:settings", input),
  openRecommendation: (day) => invoke("recommendation:open", day),
  bookmarkRecommendation: (day) => invoke("recommendation:bookmark", day),
  deleteArticleBookmark: (url) => invoke("article-bookmark:delete", url),
  openArticleBookmark: (url) => invoke("article-bookmark:open", url),
  linkArticleBookmark: (input) => invoke("article-bookmark:link", input),
  addArticle: (x) => invoke("article:add", x),
  cancelArticleImport: () => invoke("article:cancel-import"),
  touchReading: (id) => invoke("reading:touch", id),
  clearRecentReading: () => invoke("reading:clear", undefined),
  renameArticle: (x) => invoke("article:rename", x),
  deleteArticle: (x) => invoke("article:delete", x),
  position: (x) => invoke("article:position", x),
  history: (x) => invoke("analysis:history", x),
  analyze: (x) => invoke("analysis:run", x),
  cancelAnalysis: (x) => invoke("analysis:cancel", x),
  onAnalysisProgress: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: AnalysisProgress,
    ) => listener(progress);
    ipcRenderer.on("analysis:progress", handler);
    return () => {
      ipcRenderer.removeListener("analysis:progress", handler);
    };
  },
  saveFavorite: (x) => invoke("favorite:save", x),
  deleteFavorite: (x) => invoke("favorite:delete", x),
  settings: (x) => invoke("settings:save", x),
  signIn: (x) => invoke("chatgpt:sign-in", x),
  cancelSignIn: () => invoke("chatgpt:cancel"),
  selectAccount: (x) => invoke("chatgpt:select", x),
  signOut: () => invoke("chatgpt:sign-out"),
  models: () => invoke("chatgpt:models"),
  manageUsage: () => invoke("chatgpt:usage"),
  exportBackup: () => invoke("backup:export"),
  importBackup: (x) => invoke("backup:import", x),
};
contextBridge.exposeInMainWorld("readingDesk", Object.freeze(api));
