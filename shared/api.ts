import type { Article, Analysis, Favorite, Kind, Preferences } from "./schema";
export type ChatGPTSession = {
  profiles: {
    id: string;
    email: string;
    connected: boolean;
    sharing: boolean;
  }[];
  activeProfileId: string | null;
  connected: boolean;
  sharing: boolean;
  signingIn: boolean;
  error?: string;
};
export type ChatGPTModel = { slug: string; displayName: string };
export type AnalysisPhase =
  "authorizing" | "connecting" | "reasoning" | "generating" | "validating";
export type AnalysisProgress = {
  articleId: string;
  phase: AnalysisPhase;
  characters: number;
};
export type Snapshot = {
  articles: Article[];
  favorites: Favorite[];
  preferences: Preferences;
  chatGPT: ChatGPTSession;
  dataPath: string;
};
export interface API {
  snapshot(): Promise<Snapshot>;
  addArticle(input: {
    title: string;
    source: string;
    body: string;
  }): Promise<Article>;
  renameArticle(input: { id: string; title: string }): Promise<void>;
  deleteArticle(id: string): Promise<void>;
  position(input: { id: string; position: number }): Promise<void>;
  flushPosition(input: { id: string; position: number }): void;
  history(articleId: string): Promise<Analysis[]>;
  analyze(input: {
    articleId: string;
    kind: Kind;
    start: number;
    end: number;
  }): Promise<Analysis>;
  cancelAnalysis(articleId: string): Promise<void>;
  onAnalysisProgress(
    listener: (progress: AnalysisProgress) => void,
  ): () => void;
  saveFavorite(favorite: Favorite): Promise<void>;
  deleteFavorite(id: string): Promise<void>;
  settings(input: { preferences: Preferences }): Promise<void>;
  signIn(input?: {
    profileId?: string;
    enableSharing?: boolean;
  }): Promise<void>;
  cancelSignIn(): Promise<void>;
  selectAccount(profileId: string): Promise<void>;
  signOut(): Promise<{ remoteRevoked: boolean }>;
  models(): Promise<ChatGPTModel[]>;
  manageUsage(): Promise<void>;
  exportBackup(): Promise<boolean>;
  importBackup(mode: "merge" | "replace"): Promise<boolean>;
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
