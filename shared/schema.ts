import { z } from "zod";
import {
  dailyRecommendationSchema,
  recommendationSettingsSchema,
  articleBookmarkSchema,
} from "./recommendations";
export const text = z.string().max(100000);
export const id = z.string().uuid();
export const kindSchema = z.enum([
  "word",
  "sentence",
  "overview",
  "translation",
]);
export type Kind = z.infer<typeof kindSchema>;
export const exampleSchema = z
  .object({
    context: z.enum(["daily", "article"]),
    english: z.string().min(1).max(3000),
    chinese: z.string().min(1).max(3000),
  })
  .strict();
export const itemSchema = z
  .object({
    term: z.string().min(1).max(1000),
    originalSentence: z.string().min(1).max(10000),
    meaning: z.string().min(1).max(4000),
    explanation: z.string().min(1).max(6000),
    partOfSpeech: z.string().max(500),
    collocations: z.array(z.string().max(500)).max(20),
    examples: z.array(exampleSchema).length(2),
  })
  .strict();
export const resultSchema = z
  .object({
    summary: z.string().max(10000),
    translation: z.string().max(10000),
    structure: z.string().max(10000),
    idioms: z.string().max(10000),
    tone: z.string().max(5000),
    items: z.array(itemSchema).max(15),
  })
  .strict();
export type Result = z.infer<typeof resultSchema>;
export type LearningItem = z.infer<typeof itemSchema>;
export function validateResult(kind: Kind, value: unknown): Result {
  const result = resultSchema.parse(value);
  if (
    kind === "translation" &&
    (!result.translation.trim() ||
      result.items.length ||
      result.summary ||
      result.structure ||
      result.idioms ||
      result.tone)
  )
    throw new Error("全文翻譯段落必須包含完整翻譯，不可夾帶其他解析欄位。");
  if (
    kind === "overview" &&
    (result.items.length < 8 || !result.summary.trim())
  )
    throw new Error("全文重點必須包含摘要及 8–15 個學習項目。");
  if (kind === "word" && result.items.length !== 1)
    throw new Error("字詞解析必須包含一個學習項目。");
  if (
    kind === "sentence" &&
    (!result.translation.trim() ||
      !result.structure.trim() ||
      !result.tone.trim())
  )
    throw new Error("句子解析缺少翻譯、結構或語氣。");
  for (const item of result.items)
    if (
      !item.examples.some((e) => e.context === "daily") ||
      !item.examples.some((e) => e.context === "article")
    )
      throw new Error("例句必須包含日常及原文情境。");
  return result;
}
export const sourceSchema = z
  .string()
  .max(2000)
  .refine(
    (s) =>
      !s ||
      (() => {
        try {
          return ["https:", "http:"].includes(new URL(s).protocol);
        } catch {
          return false;
        }
      })(),
    "來源須為 http 或 https 網址",
  );
export const articleSchema = z
  .object({
    importedFrom: sourceSchema.optional(),
    id,
    title: z.string().trim().min(1).max(300),
    source: sourceSchema,
    body: z.string().min(1).max(200000),
    position: z.number().min(0).max(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Article = z.infer<typeof articleSchema>;
export const articleInputSchema = z
  .object({
    title: z.string().trim().max(300),
    source: sourceSchema,
    body: z.string().max(200000),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.body.trim() && !input.source.trim())
      context.addIssue({
        code: "custom",
        message: "請貼上文章正文或輸入文章網址。",
      });
    if (input.body.trim() && !input.title.trim())
      context.addIssue({
        code: "custom",
        message: "貼上正文時請填寫文章標題。",
      });
  });
export const analysisSchema = z
  .object({
    id,
    articleId: id,
    kind: kindSchema,
    selection: z.string().max(10000),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    result: resultSchema,
    model: z.string().max(200),
    createdAt: z.string().datetime(),
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const favoriteSchema = z
  .object({
    id,
    articleId: id,
    title: z.string().max(300),
    source: sourceSchema,
    term: z.string().min(1).max(10000),
    meaning: text,
    sentence: text,
    examples: z.array(exampleSchema).max(2),
    note: text,
    tags: z.array(z.string().trim().min(1).max(50)).max(20),
    analysisId: id.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Favorite = z.infer<typeof favoriteSchema>;
export const preferencesSchema = z
  .object({
    theme: z.enum(["light", "dark"]),
    fontSize: z.number().int().min(16).max(32),
    lineHeight: z.number().min(1.4).max(2.6),
    model: z.string().trim().min(1).max(100),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  theme: "light",
  fontSize: 21,
  lineHeight: 1.9,
  model: "gpt-4.1-mini",
};
export const backupSchema = z
  .object({
    format: z.literal("reading-desk"),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    articles: z.array(articleSchema).max(10000),
    analyses: z.array(analysisSchema).max(50000),
    favorites: z.array(favoriteSchema).max(50000),
    preferences: preferencesSchema,
    recommendationSettings: recommendationSettingsSchema.optional(),
    recommendations: z.array(dailyRecommendationSchema).max(5000).optional(),
    articleBookmarks: z.array(articleBookmarkSchema).max(10000).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (
      new Set(b.articleBookmarks?.map((item) => item.url)).size !==
      (b.articleBookmarks?.length ?? 0)
    )
      ctx.addIssue({ code: "custom", message: "文章收藏有重複網址" });
    if (
      new Set(b.recommendations?.map((item) => item.day)).size !==
      (b.recommendations?.length ?? 0)
    )
      ctx.addIssue({ code: "custom", message: "推薦紀錄有重複日期" });
    for (const key of ["articles", "analyses", "favorites"] as const)
      if (new Set(b[key].map((x) => x.id)).size !== b[key].length)
        ctx.addIssue({ code: "custom", message: `${key} 有重複 ID` });
    const articles = new Map(b.articles.map((a) => [a.id, a]));
    for (const bookmark of b.articleBookmarks ?? [])
      if (bookmark.articleId && !articles.has(bookmark.articleId))
        ctx.addIssue({ code: "custom", message: "文章收藏的本機文章不存在" });
    const analyses = new Map(b.analyses.map((a) => [a.id, a]));
    for (const a of b.analyses) {
      const article = articles.get(a.articleId);
      if (
        !article ||
        a.end < a.start ||
        a.end > article.body.length ||
        (a.kind !== "overview" &&
          article.body.slice(a.start, a.end) !== a.selection)
      )
        ctx.addIssue({ code: "custom", message: "解析與文章位置不一致" });
      try {
        validateResult(a.kind, a.result);
      } catch {
        ctx.addIssue({ code: "custom", message: "解析內容格式錯誤" });
      }
    }
    for (const f of b.favorites)
      if (
        f.analysisId &&
        (!analyses.has(f.analysisId) ||
          analyses.get(f.analysisId)?.articleId !== f.articleId)
      )
        ctx.addIssue({ code: "custom", message: "收藏解析關聯錯誤" });
  });
export type Backup = z.infer<typeof backupSchema>;
