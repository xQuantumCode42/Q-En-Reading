import { z } from "zod";
export const text = z.string().max(100000);
export const id = z.string().uuid();
export const kindSchema = z.enum(["word", "sentence", "overview"]);
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
  })
  .strict()
  .superRefine((b, ctx) => {
    for (const key of ["articles", "analyses", "favorites"] as const)
      if (new Set(b[key].map((x) => x.id)).size !== b[key].length)
        ctx.addIssue({ code: "custom", message: `${key} 有重複 ID` });
    const articles = new Map(b.articles.map((a) => [a.id, a]));
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
