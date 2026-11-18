import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractArticle,
  resolvePublicTarget,
  ArticleImporter,
} from "../electron/article-import";
import { articleInputSchema } from "../shared/schema";

const paragraphs = [
  "The proposal gained traction among residents. A group of neighbors planted new trees along the streets to make their city more comfortable during the summer. The project brought together families and local businesses.",
  "The trees provide shade and create more pleasant places to walk. Researchers say that thoughtful planning can help people enjoy their neighborhoods while reducing the effects of rising temperatures in crowded areas.",
  "Residents will continue caring for the trees over the coming years. They hope the experience encourages other communities to work together and take small steps toward a healthier environment for everyone.",
];
const html = `<!doctype html><html><head><title>City trees - Example News</title></head><body><nav>Subscribe | Sign in | More news</nav><main><article><h1>A greener city</h1>${paragraphs.map((text) => `<p>${text}</p>`).join("")}</article></main><script>globalThis.articleImportExecuted = true;</script><footer>Copyright and advertising</footer></body></html>`;
const fixtureExtractor = async (html: string, source: string) =>
  extractArticle(html, source);
test("URL-only input is accepted while manual articles still require a title and content", () => {
  assert.doesNotThrow(() =>
    articleInputSchema.parse({
      title: "",
      source: "https://example.com/story",
      body: "",
    }),
  );
  assert.throws(() =>
    articleInputSchema.parse({ title: "Title", source: "", body: "" }),
  );
  assert.throws(() =>
    articleInputSchema.parse({ title: "", source: "", body: "Text" }),
  );
});
test("extracts real paragraphs without navigation or executing page scripts", () => {
  const result = extractArticle(html, "https://example.com/story");
  assert.ok(result.title.includes("City") || result.title.includes("city"));
  assert.ok(result.body.includes(paragraphs[0]));
  assert.ok(result.body.includes("\n\n"));
  assert.ok(!result.body.includes("Subscribe |"));
  assert.ok(!result.body.includes("articleImportExecuted"));
  assert.equal((globalThis as any).articleImportExecuted, undefined);
  assert.throws(
    () =>
      extractArticle(
        "<html><body><nav>Home Sign in</nav></body></html>",
        "https://example.com/",
      ),
    /正文/,
  );
  assert.throws(
    () =>
      extractArticle(
        html.replace(
          "</head>",
          '<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>',
        ),
        "https://example.com/story",
      ),
    /付費|登入/,
  );
});
test("rejects private DNS addresses including IPv6 and DNS rebinding mixtures", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ]) {
    await assert.rejects(
      resolvePublicTarget("https://example.com/story", async () => [
        { address, family: address.includes(":") ? 6 : 4 },
      ]),
      /公開|內網/,
    );
  }
  await assert.rejects(
    resolvePublicTarget("https://example.com/", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /公開|內網/,
  );
  assert.equal(
    (
      await resolvePublicTarget("https://example.com/", async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).address,
    "8.8.8.8",
  );
});
test("importer rejects non-HTML, oversized pages and cancellation; uses the verified final source", async () => {
  const importer = new ArticleImporter(
    async () => ({
      html,
      url: "https://example.com/final",
      contentType: "text/html",
    }),
    fixtureExtractor,
  );
  const result = await importer.import(
    "https://example.com/start",
    new AbortController().signal,
  );
  assert.equal(result.source, "https://example.com/final");
  assert.ok(result.body.includes("gained traction"));
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    importer.import("https://example.com/", controller.signal),
    /cancelled/,
  );
  await assert.rejects(
    new ArticleImporter(
      async () => ({
        html: "file",
        url: "https://example.com/f",
        contentType: "application/pdf",
      }),
      fixtureExtractor,
    ).import("https://example.com/f", new AbortController().signal),
    /HTML|網頁/,
  );
  await assert.rejects(
    new ArticleImporter(
      async () => ({
        html: "x".repeat(3 * 1024 * 1024),
        url: "https://example.com/f",
        contentType: "text/html",
      }),
      fixtureExtractor,
    ).import("https://example.com/f", new AbortController().signal),
    /過大/,
  );
});
