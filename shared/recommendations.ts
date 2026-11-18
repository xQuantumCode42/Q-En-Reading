import { z } from "zod";

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function publicUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("請輸入公開的 http 或 https 網站網址。");
  }
  const host = url.hostname.toLowerCase();
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    /[:\[\]]/.test(host) ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
    host.endsWith(".")
  )
    throw new Error("只接受公開網站，不接受本機網址、登入資訊或自訂連接埠。");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      publicUrl(value);
      return true;
    } catch {
      return false;
    }
  }, "請使用沒有登入資訊的公開 http/https 網址。")
  .transform(publicUrl);
export const recommendationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    websites: z
      .array(urlSchema.transform((value) => new URL(value).origin + "/"))
      .max(10)
      .transform((values) => [...new Set(values)]),
  })
  .strict();
export type RecommendationSettings = z.infer<
  typeof recommendationSettingsSchema
>;
export const defaultRecommendationSettings: RecommendationSettings = {
  enabled: true,
  websites: [],
};
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
export const dailyRecommendationSchema = z
  .object({
    day: daySchema,
    title: z.string().trim().min(1).max(400),
    url: urlSchema,
    publishedDate: daySchema.nullable(),
    reasonChinese: z.string().trim().min(1).max(1000),
    citations: z.array(urlSchema).min(1).max(8),
    model: z.string().min(1).max(100),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (record) => record.citations.includes(record.url),
    "推薦文章必須有相符的搜尋來源。",
  )
  .refine(
    (record) => !record.publishedDate || record.publishedDate <= record.day,
    "刊登日期不能晚於推薦日期。",
  );
export type DailyRecommendation = z.infer<typeof dailyRecommendationSchema>;
export const articleBookmarkSchema = z
  .object({
    url: urlSchema,
    title: z.string().trim().min(1).max(400),
    reasonChinese: z.string().max(1000),
    recommendedDay: daySchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type ArticleBookmark = z.infer<typeof articleBookmarkSchema>;
export type RecommendationState = {
  day: string;
  status: "idle" | "searching" | "ready" | "error";
  recommendation?: DailyRecommendation;
  error?: string;
};
