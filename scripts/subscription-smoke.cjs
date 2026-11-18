// Real Electron UI with OAuth and inference fixtures confined to this test process.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(".test-data", `subscription-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const env = { ...process.env, READING_DESK_TEST_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await electron.launch({
    ...(process.env.READING_DESK_EXECUTABLE
      ? { executablePath: process.env.READING_DESK_EXECUTABLE }
      : {}),
    args: process.env.READING_DESK_EXECUTABLE ? [] : ["."],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "文章庫", exact: true }).waitFor();
  return page;
}
async function installFixtures() {
  await app.evaluate(({ shell, app }) => {
    const path = process.getBuiltinModule("node:path");
    const loader = process
      .getBuiltinModule("node:module")
      .createRequire(path.join(app.getAppPath(), "package.json"));
    const importer = loader("./dist-electron/electron/article-import.js");
    globalThis.importHang = false;
    globalThis.importFail = false;
    importer.ArticleImporter.prototype.import = async (url, signal) => {
      if (globalThis.importHang) return new Promise(() => {});
      if (globalThis.importFail)
        throw new Error("Unable to import public article fixture");
      const text =
        "The proposal gained traction among residents. Reading in context helps build understanding. Communities have worked together to plant trees and make their streets cooler during the summer. The project gives neighbors new opportunities to care for the places they share.";
      return importer.extractArticleInWorker(
        `<html><head><title>Imported public article</title></head><body><article><h1>Imported public article</h1><p>${text}</p><p>${text}</p><p>${text}</p></article></body></html>`,
        url,
        signal,
      );
    };
    const crypto = process.getBuiltinModule("node:crypto");
    const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = pair.publicKey.export({ format: "jwk" });
    let nonce = "";
    const network = globalThis.fetch;
    shell.openExternal = async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname === "chatgpt.com") {
        globalThis.testUsageUrl = url;
        return;
      }
      if (parsed.hostname === "www.npr.org") {
        globalThis.testArticleUrl = url;
        return;
      }
      nonce = parsed.searchParams.get("nonce");
      const callback = new URL(parsed.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", parsed.searchParams.get("state"));
      callback.searchParams.set("code", "fixture-code");
      callback.searchParams.set("client_id", "oaiapp_desktop_fixture");
      await network(callback);
    };
    globalThis.testAICalls = 0;
    globalThis.testSearchCalls = 0;
    globalThis.testRefreshFail = false;
    globalThis.testRefreshHang = false;
    globalThis.testRefreshSame = false;
    globalThis.fetch = async (value, init) => {
      const url = String(value);
      if (url.endsWith("/.well-known/jwks.json"))
        return new Response(
          JSON.stringify({
            keys: [
              { ...jwk, kid: "desktop-fixture", alg: "RS256", use: "sig" },
            ],
          }),
        );
      if (url.endsWith("/oauth/token")) {
        const header = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "desktop-fixture" }),
        ).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            iss: "https://auth.openai.com",
            aud: "oaiapp_desktop_fixture",
            sub: "desktop-reader",
            email: "reader@example.test",
            nonce,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url");
        const signed = `${header}.${payload}`;
        const signature = crypto
          .sign("RSA-SHA256", Buffer.from(signed), pair.privateKey)
          .toString("base64url");
        return new Response(
          JSON.stringify({
            access_token: "fixture-subscription-access",
            refresh_token: "fixture-subscription-refresh",
            id_token: `${signed}.${signature}`,
            token_type: "Bearer",
            expires_in: 3600,
            scope:
              "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
          }),
        );
      }
      if (url.endsWith("/models"))
        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "fixture-subscription-model",
                display_name: "測試訂閱模型",
                visibility: "list",
              },
            ],
          }),
        );
      if (url.endsWith("/oauth/revoke"))
        return new Response(null, { status: 200 });
      if (!url.endsWith("/responses"))
        throw new Error("Unexpected network request");
      const request = JSON.parse(init.body);
      if (
        request.stream !== true ||
        request.store !== false ||
        request.max_output_tokens !== undefined ||
        init.headers.Authorization !== "Bearer fixture-subscription-access"
      )
        throw new Error("Invalid subscription request");
      if (request.tools?.some((tool) => tool.type === "web_search")) {
        globalThis.testSearchCalls++;
        globalThis.testSearchInput = request.input;
        if (globalThis.testRefreshFail)
          throw new Error("Refresh fixture unavailable");
        if (globalThis.testRefreshHang) return new Promise(() => {});
        const { localDate: day, excludedUrls = [] } = JSON.parse(
          request.input[0].content,
        );
        const article = {
          title: excludedUrls.length
            ? `A fresh article ${globalThis.testSearchCalls}`
            : "A greener city, one tree at a time",
          url: globalThis.testRefreshSame
            ? excludedUrls[0]
            : excludedUrls.length
              ? `https://www.npr.org/sections/science/refreshed-${globalThis.testSearchCalls}`
              : "https://www.npr.org/sections/science/daily-reading-fixture",
          publishedDate: day,
          reasonChinese: "城市與自然的報導，適合一般成人原文閱讀。",
        };
        return new Response(
          "data: " +
            JSON.stringify({
              type: "response.completed",
              response: {
                status: "completed",
                output: [
                  {
                    type: "web_search_call",
                    status: "completed",
                    action: { type: "search", sources: [{ url: article.url }] },
                  },
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify(article),
                        annotations: [
                          { type: "url_citation", url: article.url },
                        ],
                      },
                    ],
                  },
                ],
              },
            }) +
            "\n\n",
        );
      }
      globalThis.testAICalls++;
      const input = JSON.parse(request.input[0].content);
      const item = {
        term: "gained traction",
        originalSentence: "The proposal gained traction among residents.",
        meaning: "開始獲得支持",
        explanation: "Began to attract support in this context.",
        partOfSpeech: "verb phrase",
        collocations: ["gain traction"],
        examples: [
          {
            context: "daily",
            english: "My idea gained traction at work.",
            chinese: "我的想法在工作場合開始獲得支持。",
          },
          {
            context: "article",
            english: "The policy gained traction among voters.",
            chinese: "該政策開始獲得選民支持。",
          },
        ],
      };
      const result = {
        summary: input.mode === "overview" ? "Article summary / 文章摘要" : "",
        translation:
          input.mode === "sentence" ? "這項提案開始獲得居民支持。" : "",
        structure:
          input.mode === "sentence"
            ? "Subject + verb + object / 主詞＋動詞＋受詞"
            : "",
        idioms:
          input.mode === "sentence"
            ? "gain traction: attract support / 獲得支持"
            : "",
        tone: input.mode === "sentence" ? "Neutral reporting / 中性報導" : "",
        items:
          input.mode === "overview"
            ? Array.from({ length: 8 }, (_, index) => ({
                ...item,
                term: `test learning item ${index + 1}`,
              }))
            : input.mode === "word"
              ? [item]
              : [],
      };
      const toWire = (item) => ({
        ...item,
        examples: Object.fromEntries(
          item.examples.map(({ context, english, chinese }) => [
            context,
            { english, chinese },
          ]),
        ),
      });
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify(
                        input.mode === "word"
                          ? toWire(result.items[0])
                          : input.mode === "sentence"
                            ? {
                                translation: result.translation,
                                structure: result.structure,
                                idioms: result.idioms,
                                tone: result.tone,
                              }
                            : {
                                summary: result.summary,
                                items: result.items.map(toWire),
                              },
                      ),
                    },
                  ],
                },
              ],
            },
          }) +
          "\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });
}
(async () => {
  try {
    let page = await launch();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "＋ 新增文章", exact: true })
      .click();
    await page.getByLabel("文章標題").fill("Desktop persistence test");
    await page
      .getByLabel("英文原文")
      .fill(
        "The proposal gained traction among residents. Reading in context helps build understanding.\n\n".repeat(
          80,
        ),
      );
    await page.getByRole("button", { name: "儲存並開始閱讀 →" }).click();
    await page.locator(".original-text").waitFor();
    await page.locator(".original-text").evaluate((element) => {
      const text = element.firstChild;
      const start = text.textContent.indexOf("gained traction");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 15);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "請先到設定使用 ChatGPT 登入" })
      .waitFor();
    assert.equal(
      await page.locator(".selection-box blockquote").innerText(),
      "gained traction",
    );
    await page.getByRole("button", { name: "關閉", exact: true }).click();
    await page
      .getByPlaceholder("記下你對這個語境的理解…")
      .fill("重開後仍要保留的筆記");
    await page.getByLabel("收藏標籤").fill("新聞,搭配");
    await page.getByRole("button", { name: "☆ 收藏並保存筆記" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "已加入星號收藏" })
      .waitFor();
    await page.locator(".reader").evaluate((element) => {
      element.scrollTop = element.scrollHeight * 0.5;
    });
    await page.waitForTimeout(600);
    const position = await page.evaluate(
      async () => (await window.readingDesk.snapshot()).articles[0].position,
    );
    assert.ok(position > 0.3);
    await installFixtures();
    await page.getByRole("button", { name: /設定/ }).click();
    assert.equal(await page.getByLabel("API Key", { exact: true }).count(), 0);
    await page
      .getByLabel("收藏英文網站", { exact: true })
      .fill(
        "https://www.npr.org/sections/science/\nhttps://www.smithsonianmag.com/",
      );
    await page
      .getByRole("button", { name: "保存推薦設定", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "推薦設定已保存" })
      .waitFor();
    await page
      .getByRole("button", { name: "Continue with ChatGPT", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "已啟用 · 使用 ChatGPT 訂閱" })
      .waitFor();
    await page
      .getByLabel("解析模型")
      .selectOption("fixture-subscription-model");
    const session = await page.evaluate(
      async () => (await window.readingDesk.snapshot()).chatGPT,
    );
    assert.equal(session.sharing, true);
    assert.equal(
      JSON.stringify(session).includes("fixture-subscription-access"),
      false,
    );
    assert.equal(
      fs
        .readFileSync(path.join(directory, "chatgpt-session.encrypted"))
        .includes("fixture-subscription-access"),
      false,
    );
    await page
      .getByRole("button", { name: "管理 ChatGPT 用量", exact: true })
      .click();
    assert.equal(
      await app.evaluate(() => globalThis.testUsageUrl),
      "https://chatgpt.com/settings/usage",
    );
    await page.screenshot({
      path: path.join(directory, "subscription-settings.png"),
    });
    await page.getByRole("button", { name: /文章庫/ }).click();
    await page
      .getByRole("link", {
        name: "A greener city, one tree at a time",
        exact: true,
      })
      .waitFor();
    assert.equal(await app.evaluate(() => globalThis.testSearchCalls), 1);
    const aiBeforeBookmark = await app.evaluate(() => globalThis.testAICalls);
    await page.getByRole("button", { name: "☆ 收藏文章", exact: true }).click();
    await page
      .getByRole("button", { name: "★ 已收藏文章", exact: true })
      .waitFor();
    await page.evaluate(async () => {
      const { recommendation } = await window.readingDesk.snapshot();
      await Promise.all([
        window.readingDesk.bookmarkRecommendation(recommendation.day),
        window.readingDesk.bookmarkRecommendation(recommendation.day),
      ]);
    });
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.readingDesk.snapshot()).articleBookmarks.length,
      ),
      1,
    );
    assert.equal(
      await app.evaluate(() => globalThis.testAICalls),
      aiBeforeBookmark,
    );
    assert.ok(
      JSON.stringify(
        await app.evaluate(() => globalThis.testSearchInput),
      ).includes("www.npr.org"),
    );
    assert.ok(
      !JSON.stringify(
        await app.evaluate(() => globalThis.testSearchInput),
      ).includes("Desktop persistence test"),
    );
    await page
      .getByRole("link", {
        name: "A greener city, one tree at a time",
        exact: true,
      })
      .click();
    assert.equal(
      await app.evaluate(() => globalThis.testArticleUrl),
      "https://www.npr.org/sections/science/daily-reading-fixture",
    );
    await page.evaluate(async () => {
      await Promise.all([
        window.readingDesk.recommendation(true),
        window.readingDesk.recommendation(false),
      ]);
    });
    assert.equal(await app.evaluate(() => globalThis.testSearchCalls), 1);
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page
      .locator(".term-line h3")
      .filter({ hasText: "gained traction" })
      .waitFor();
    await page.locator(".term-line button").click();
    const learned = await page.evaluate(async () => {
      const data = await window.readingDesk.snapshot();
      const favorite = data.favorites.find((favorite) => favorite.analysisId);
      await window.readingDesk.deleteFavorite(favorite.id);
      return favorite;
    });
    assert.equal(learned.examples.length, 2);
    assert.equal(
      learned.sentence,
      "The proposal gained traction among residents.",
    );
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page.getByRole("button", { name: "句子解析", exact: true }).click();
    await page.getByRole("heading", { name: "句子結構 STRUCTURE" }).waitFor();
    await page
      .getByRole("button", { name: "✧ 整理全文學習重點", exact: true })
      .click();
    await page.getByRole("heading", { name: "摘要 SUMMARY" }).waitFor();
    assert.equal(await page.locator(".learning-item").count(), 8);
    assert.equal(await app.evaluate(() => globalThis.testAICalls), 3);
    // A stalled transport must remain cancellable through the real UI and IPC.
    await app.evaluate(() => {
      globalThis.savedFixtureFetch = globalThis.fetch;
      globalThis.fetch = () => new Promise(() => {});
    });
    await page.locator(".original-text").evaluate((element) => {
      const text = element.firstChild;
      const start = text.textContent.indexOf("residents");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 9);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page.getByRole("button", { name: "取消解析", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "已取消解析" })
      .waitFor({ timeout: 2000 });
    await app.evaluate(() => {
      globalThis.fetch = globalThis.savedFixtureFetch;
    });
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page
      .locator(".term-line h3")
      .filter({ hasText: "gained traction" })
      .waitFor();
    await page.screenshot({ path: path.join(directory, "reading.png") });
    await app.close();
    page = await launch();
    await page
      .getByRole("button", { name: "★ 已收藏文章", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.readingDesk.snapshot()).articleBookmarks.length,
      ),
      1,
    );
    await page
      .getByRole("link", {
        name: "A greener city, one tree at a time",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(
        async () => (await window.readingDesk.snapshot()).chatGPT.sharing,
      ),
      true,
    );
    await page
      .getByRole("button")
      .filter({
        has: page.getByText("Desktop persistence test", { exact: true }),
      })
      .click();
    await page.locator(".original-text").waitFor();
    await page.waitForTimeout(400);
    const restored = await page
      .locator(".reader")
      .evaluate(
        (element) =>
          element.scrollTop / (element.scrollHeight - element.clientHeight),
      );
    assert.ok(Math.abs(restored - position) < 0.03);
    await page.getByRole("button", { name: /星號收藏/ }).click();
    await page
      .getByRole("heading", { name: "gained traction", exact: true })
      .waitFor();
    await page.getByText("重開後仍要保留的筆記", { exact: true }).click();
    await page.getByLabel("本文意思").fill("開始獲得支持");
    await page.getByRole("button", { name: "保存變更" }).click();
    await page.getByLabel("搜尋收藏").fill("獲得支持");
    assert.equal(await page.locator(".favorite-card").count(), 1);
    const backup = path.join(directory, "backup.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    assert.equal(
      await page.evaluate(() => window.readingDesk.exportBackup()),
      true,
    );
    const content = JSON.parse(fs.readFileSync(backup, "utf8"));
    assert.equal(content.articleBookmarks.length, 1);
    assert.equal(content.favorites[0].note, "重開後仍要保留的筆記");
    assert.ok(!JSON.stringify(content).includes("fixture-subscription-access"));
    assert.equal(
      await page.evaluate(() => window.readingDesk.importBackup("merge")),
      true,
    );
    assert.equal(
      await page.evaluate(
        async () => (await window.readingDesk.snapshot()).articles.length,
      ),
      2,
    );
    assert.equal(
      await page.evaluate(() => window.readingDesk.importBackup("replace")),
      true,
    );
    assert.equal(
      await page.evaluate(
        async () => (await window.readingDesk.snapshot()).articles.length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.readingDesk.snapshot()).articleBookmarks.length,
      ),
      1,
    );
    fs.writeFileSync(backup, JSON.stringify({ format: "wrong" }));
    await assert.rejects(
      () => page.evaluate(() => window.readingDesk.importBackup("replace")),
      /格式/,
    );
    assert.equal(
      await page.evaluate(
        async () => (await window.readingDesk.snapshot()).favorites.length,
      ),
      1,
    );
    const security = await app.evaluate(({ BrowserWindow }) => {
      const preferences =
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        sandbox: preferences.sandbox,
      };
    });
    assert.deepEqual(security, {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    assert.deepEqual(errors, []);
    await installFixtures();
    const beforeImport = await page.evaluate(
      async () => (await window.readingDesk.snapshot()).articles.length,
    );
    await page
      .getByRole("button", { name: "＋ 新增文章", exact: true })
      .click();
    await page
      .getByLabel("來源網址", { exact: true })
      .fill("https://example.com/public-article");
    await page.getByRole("button", { name: "儲存並開始閱讀 →" }).click();
    await page
      .getByRole("heading", { name: "Imported public article", exact: true })
      .waitFor();
    const imported = await page.evaluate(async () =>
      (await window.readingDesk.snapshot()).articles.find(
        (a) => a.title === "Imported public article",
      ),
    );
    assert.ok(imported.body.length > 200);
    assert.equal(imported.source, "https://example.com/public-article");
    await page.locator(".original-text").evaluate((element) => {
      const text = element.firstChild;
      const start = text.textContent.indexOf("gained traction");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 15);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "字詞解析", exact: true }).click();
    await page
      .locator(".term-line h3")
      .filter({ hasText: "gained traction" })
      .waitFor();
    await app.evaluate(() => {
      globalThis.importFail = true;
    });
    await page
      .getByRole("button", { name: "＋ 新增文章", exact: true })
      .click();
    const sourceInput = page.getByLabel("來源網址", { exact: true });
    await sourceInput.fill("https://example.com/failure");
    await page.getByRole("button", { name: "儲存並開始閱讀 →" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Unable to import public article fixture" })
      .waitFor();
    assert.equal(await sourceInput.inputValue(), "https://example.com/failure");
    await app.evaluate(() => {
      globalThis.importFail = false;
      globalThis.importHang = true;
    });
    await page.getByRole("button", { name: "儲存並開始閱讀 →" }).click();
    await page.getByRole("button", { name: "取消擷取", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "已取消擷取" }).waitFor();
    assert.equal(await sourceInput.inputValue(), "https://example.com/failure");
    assert.equal(
      await page.evaluate(
        async () => (await window.readingDesk.snapshot()).articles.length,
      ),
      beforeImport + 1,
    );
    await page
      .getByRole("button", { name: "關閉新增文章", exact: true })
      .click();
    await app.evaluate(() => {
      globalThis.importHang = false;
    });
    await page.getByRole("button", { name: /星號收藏/ }).click();
    await page.getByRole("button", { name: /文章收藏（/ }).click();
    await page
      .getByRole("heading", {
        name: "A greener city, one tree at a time",
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: path.join(directory, "article-bookmarks.png"),
    });
    await page.getByRole("button", { name: "開啟原文", exact: true }).click();
    assert.equal(
      await app.evaluate(() => globalThis.testArticleUrl),
      "https://www.npr.org/sections/science/daily-reading-fixture",
    );
    await app.evaluate(() => {
      globalThis.importFail = true;
    });
    await page.getByRole("button", { name: "匯入閱讀", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Unable to import public article fixture" })
      .waitFor();
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.readingDesk.snapshot()).articleBookmarks.length,
      ),
      1,
    );
    await app.evaluate(() => {
      globalThis.importFail = false;
    });
    await page.getByRole("button", { name: "匯入閱讀", exact: true }).click();
    await page
      .locator(".original-text")
      .filter({ hasText: "gained traction" })
      .waitFor();
    await page.getByRole("button", { name: /星號收藏/ }).click();
    await page.getByRole("button", { name: "取消收藏", exact: true }).click();
    await page
      .getByRole("button", { name: "確認取消收藏", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "尚無符合的文章收藏", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /文章庫/ }).click();
    const card = page.locator(".daily-card");
    await card.getByRole("button", { name: "☆ 收藏文章", exact: true }).click();
    await card
      .getByRole("button", { name: "★ 已收藏文章", exact: true })
      .waitFor();
    await card
      .getByRole("button", { name: "↻ 刷新今日推薦", exact: true })
      .click();
    await card.getByRole("link", { name: /A fresh article/ }).waitFor();
    const freshTitle = await card.locator(".daily-title").innerText();
    const freshUrl = await card.locator(".daily-title").getAttribute("href");
    const sentInput = JSON.parse(
      (await app.evaluate(() => globalThis.testSearchInput))[0].content,
    );
    assert.deepEqual(sentInput.excludedUrls, [
      "https://www.npr.org/sections/science/daily-reading-fixture",
    ]);
    assert.equal(
      await page.evaluate(
        async () =>
          (await window.readingDesk.snapshot()).articleBookmarks[0].url,
      ),
      "https://www.npr.org/sections/science/daily-reading-fixture",
    );
    await card
      .getByRole("button", { name: "☆ 收藏文章", exact: true })
      .waitFor();
    await app.evaluate(() => {
      globalThis.testRefreshSame = true;
    });
    await card
      .getByRole("button", { name: "↻ 刷新今日推薦", exact: true })
      .click();
    await card.getByRole("alert").filter({ hasText: "相同文章" }).waitFor();
    assert.equal(
      await card.locator(".daily-title").getAttribute("href"),
      freshUrl,
    );
    await app.evaluate(() => {
      globalThis.testRefreshSame = false;
      globalThis.testRefreshFail = true;
    });
    await card
      .getByRole("button", { name: "↻ 刷新今日推薦", exact: true })
      .click();
    await card
      .getByRole("alert")
      .filter({ hasText: "Refresh fixture unavailable" })
      .waitFor();
    assert.equal(
      await card.locator(".daily-title").getAttribute("href"),
      freshUrl,
    );
    await app.evaluate(() => {
      globalThis.testRefreshFail = false;
      globalThis.testRefreshHang = true;
    });
    await card
      .getByRole("button", { name: "↻ 刷新今日推薦", exact: true })
      .click();
    await card.getByRole("button", { name: "取消搜尋", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "已取消搜尋" }).waitFor();
    assert.equal(
      await card.locator(".daily-title").getAttribute("href"),
      freshUrl,
    );
    await page.screenshot({
      path: path.join(directory, "refresh-preserved.png"),
    });
    await app.close();
    page = await launch();
    await page
      .locator(".daily-title")
      .filter({ hasText: freshTitle })
      .waitFor();
    assert.equal(
      await page.locator(".daily-title").getAttribute("href"),
      freshUrl,
    );
    await installFixtures();
    await page.evaluate(() => window.readingDesk.recommendation(true));
    assert.equal(await app.evaluate(() => globalThis.testSearchCalls), 0);
    await page.getByRole("button", { name: /設定/ }).click();
    await page.getByRole("button", { name: "登出", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "尚未登入 ChatGPT" })
      .waitFor();
    console.log(
      "PASS: Electron OAuth/subscription/search/citations/daily cache/manual refresh/exclusions/same URL rejection/failure/cancel/reopen/model picker/SSE/cache/sign-out/encryption/article/favorite/note/position/backup/security/URL import/analysis/failure/cancel/article bookmarks/reopen/dedup/backup/import/remove",
    );
    console.log("Artifacts:", directory);
  } finally {
    if (app) await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
