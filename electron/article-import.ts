import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import * as ipaddr from "ipaddr.js";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { publicUrl } from "../shared/recommendations";
import { abortable } from "./abort";
import { Worker } from "node:worker_threads";
import { join } from "node:path";

export const maxHtmlBytes = 2 * 1024 * 1024;
export type ImportedArticle = { title: string; body: string; source: string };
type Page = { html: string; url: string; contentType: string };
type Resolver = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
export async function resolvePublicTarget(
  value: string,
  resolver: Resolver = (hostname) =>
    dnsLookup(hostname, { all: true, verbatim: true }),
) {
  const url = new URL(publicUrl(value));
  const addresses = await resolver(url.hostname);
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      try {
        return ipaddr.process(address).range() !== "unicast";
      } catch {
        return true;
      }
    })
  )
    throw new Error("網址必須指向公開網站，不可存取本機或內網位址。");
  return addresses[0];
}

export async function downloadArticlePage(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Page> {
  signal.throwIfAborted();
  if (redirects > 5)
    throw new Error("網站轉址次數過多，請開啟原文後手動貼上。");
  const url = new URL(publicUrl(value));
  const address = await abortable(resolvePublicTarget(url.href), signal);
  signal.throwIfAborted();
  // Pin the checked address so a second DNS resolution cannot switch to an internal IP.
  const lookup: LookupFunction = (_hostname, _options, callback) =>
    callback(null, address.address, address.family);
  return new Promise<Page>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        lookup,
        family: address.family,
        headers: {
          "User-Agent": "ReadingDesk/1.2.0 (public article reader)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) {
            reject(new Error("網站轉址沒有提供可用網址。"));
            return;
          }
          let target: string;
          try {
            target = publicUrl(new URL(location, url).href);
          } catch {
            reject(new Error("網站轉址至不允許的位址，已停止擷取。"));
            return;
          }
          downloadArticlePage(target, signal, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          reject(
            new Error(
              [401, 403, 429].includes(status)
                ? "網站限制自動讀取、需要登入或暫時限制請求，請在瀏覽器開啟原文並手動貼上。"
                : `網站回應錯誤（${status}），請確認文章網址或手動貼上正文。`,
            ),
          );
          return;
        }
        const contentType = response.headers["content-type"] ?? "";
        if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
          response.destroy();
          reject(new Error("目前只能匯入 HTML 文章網頁，請改貼上正文。"));
          return;
        }
        if (Number(response.headers["content-length"]) > maxHtmlBytes) {
          response.destroy();
          reject(new Error("網頁內容過大，請手動貼上正文。"));
          return;
        }
        const encoding = (
          response.headers["content-encoding"] ?? "identity"
        ).toLowerCase();
        let reader: Readable = response;
        if (encoding === "gzip") reader = response.pipe(createGunzip());
        else if (encoding === "deflate")
          reader = response.pipe(createInflate());
        else if (encoding === "br")
          reader = response.pipe(createBrotliDecompress());
        else if (encoding !== "identity") {
          response.destroy();
          reject(new Error("網站使用不支援的壓縮格式，請手動貼上。"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        let wireBytes = 0;
        const abort = () => {
          response.destroy();
          if (reader !== response) reader.destroy();
          reject(signal.reason ?? new Error("已取消擷取。"));
        };
        const fail = (error: Error) => {
          response.destroy();
          if (reader !== response) reader.destroy();
          reject(error);
        };
        signal.addEventListener("abort", abort, { once: true });
        response.on("data", (chunk: Buffer) => {
          wireBytes += chunk.length;
          if (wireBytes > maxHtmlBytes)
            fail(new Error("網頁內容過大，請手動貼上正文。"));
        });
        response.on("error", () =>
          fail(new Error("網頁傳輸中斷，請重試或手動貼上。")),
        );
        reader.on("error", () =>
          fail(new Error("網頁壓縮內容無法讀取，請手動貼上。")),
        );
        reader.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxHtmlBytes) {
            fail(new Error("網頁解壓後內容過大，請手動貼上正文。"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        reader.on("end", () => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          try {
            const raw = Buffer.concat(chunks);
            const metaCharset =
              /<meta\b[^>]*\bcharset\s*=\s*["']?([^\s;"'/>]+)/i.exec(
                raw.subarray(0, 4096).toString("latin1"),
              )?.[1];
            const charset =
              /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ??
              metaCharset ??
              "utf-8";
            resolve({
              html: new TextDecoder(charset).decode(raw),
              url: url.href,
              contentType,
            });
          } catch {
            reject(new Error("無法辨識網頁編碼，請手動貼上正文。"));
          }
        });
      },
    );
    request.on("error", () =>
      reject(
        signal.aborted
          ? signal.reason
          : new Error(
              "無法連線文章網站，請檢查網址與網路後重試，或手動貼上正文。",
            ),
      ),
    );
    request.end();
  });
}

export function extractArticle(html: string, source: string): ImportedArticle {
  source = publicUrl(source);
  if (Buffer.byteLength(html, "utf8") > maxHtmlBytes)
    throw new Error("網頁內容過大，請手動貼上正文。");
  const console = new VirtualConsole();
  // No runScripts/resources options: page JavaScript, images, frames and CSS never execute/load.
  const dom = new JSDOM(html, { url: source, virtualConsole: console });
  let extracted: JSDOM | undefined;
  try {
    for (const script of dom.window.document.querySelectorAll(
      'script[type="application/ld+json"]',
    ))
      if (
        /"isAccessibleForFree"\s*:\s*(false|"false")/i.test(
          script.textContent ?? "",
        )
      )
        throw new Error(
          "網站將這篇內容標示為非免費（付費或需登入），已停止自動匯入；這與反爬蟲連線錯誤不同。請在瀏覽器確認閱讀權限後貼上正文，或改選免費來源。",
        );
    const article = new Readability(dom.window.document, {
      charThreshold: 200,
      maxElemsToParse: 50000,
    }).parse();
    if (!article?.content)
      throw new Error(
        "找不到可閱讀的文章正文，網站可能需要 JavaScript 或登入，請手動貼上。",
      );
    extracted = new JSDOM(article.content, { virtualConsole: console });
    const root = extracted.window.document.body;
    root
      .querySelectorAll("script,style,nav,footer,iframe,noscript,form")
      .forEach((element) => element.remove());
    root
      .querySelectorAll(
        "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figure,figcaption,div,section,br",
      )
      .forEach((element) => {
        element.before(extracted!.window.document.createTextNode("\n\n"));
        element.after(extracted!.window.document.createTextNode("\n\n"));
      });
    const body = (root.textContent ?? "")
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body.length < 200)
      throw new Error(
        "擷取到的正文過短，可能只有摘要或登入提示，請手動貼上完整正文。",
      );
    if (body.length > 200000)
      throw new Error("文章正文超過 200,000 字元，請分篇貼上。");
    return {
      title: (
        article.title?.trim() ||
        dom.window.document.title.trim() ||
        new URL(source).hostname
      ).slice(0, 300),
      body,
      source,
    };
  } finally {
    extracted?.window.close();
    dom.window.close();
  }
}

export class ArticleImporter {
  constructor(
    private download: (
      url: string,
      signal: AbortSignal,
    ) => Promise<Page> = downloadArticlePage,
    private extract: (
      html: string,
      source: string,
      signal: AbortSignal,
    ) => Promise<ImportedArticle> = extractArticleInWorker,
  ) {}
  async import(url: string, signal: AbortSignal): Promise<ImportedArticle> {
    signal.throwIfAborted();
    const page = await abortable(this.download(publicUrl(url), signal), signal);
    signal.throwIfAborted();
    if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(page.contentType))
      throw new Error("目前只能匯入 HTML 文章網頁，請手動貼上正文。");
    return this.extract(page.html, page.url, signal);
  }
}

export function extractArticleInWorker(
  html: string,
  source: string,
  signal: AbortSignal,
): Promise<ImportedArticle> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, "article-import-worker.js"), {
      workerData: { html, source },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error?: Error, result?: ImportedArticle) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      void worker.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => finish(signal.reason ?? new Error("已取消擷取。"));
    signal.addEventListener("abort", cancel, { once: true });
    worker.once(
      "message",
      (message: { result?: ImportedArticle; error?: string }) => {
        if (signal.aborted) cancel();
        else if (message.error) finish(new Error(message.error));
        else if (message.result) finish(undefined, message.result);
        else finish(new Error("正文擷取未回傳有效內容，請手動貼上。"));
      },
    );
    worker.once("error", () =>
      finish(new Error("網頁過於複雜，無法擷取正文，請手動貼上。")),
    );
    worker.once("exit", () => {
      if (!settled) finish(new Error("正文擷取已中止，請重試或手動貼上。"));
    });
    if (signal.aborted) cancel();
  });
}
