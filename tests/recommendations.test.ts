import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/store";
import { readResponsesStream } from "../electron/ai";
import {
  DailyRecommendations,
  SearchRecommendationProvider,
} from "../electron/recommendations";
import {
  localDay,
  publicUrl,
  recommendationSettingsSchema,
  type DailyRecommendation,
} from "../shared/recommendations";

function article(
  day = "2026-11-18",
  title = "How cities make room for trees",
): DailyRecommendation {
  return {
    day,
    title,
    url: "https://www.npr.org/2026/11/18/trees",
    publishedDate: day,
    reasonChinese: "城市與自然的報導，適合練習一般成人原文閱讀。",
    citations: ["https://www.npr.org/2026/11/18/trees"],
    model: "fixture-model",
    createdAt: "2026-11-18T08:00:00.000Z",
  };
}
test("recommendations use local calendar days and reject unsafe website links", () => {
  assert.equal(localDay(new Date(2026, 10, 18, 23, 59)), "2026-11-18");
  assert.equal(localDay(new Date(2026, 10, 19, 0, 1)), "2026-11-19");
  for (const url of [
    "file:///secret",
    "javascript:alert(1)",
    "http://127.0.0.1/a",
    "https://2130706433",
    "https://[::1]",
    "https://localhost",
    "https://news.local",
    "https://user:password@example.com",
    "https://example.com:9000",
  ])
    assert.throws(() => publicUrl(url));
  assert.deepEqual(
    recommendationSettingsSchema.parse({
      enabled: true,
      websites: [
        "https://www.npr.org/section?tracking=yes",
        "https://www.npr.org/",
      ],
    }).websites,
    ["https://www.npr.org/"],
  );
});
test("daily choice is single-flight, immutable across restart, and changes only on the next date", async () => {
  const directory = mkdtempSync(join(tmpdir(), "reading-daily-"));
  let store = new Store(join(directory, "data.sqlite"));
  try {
    let calls = 0;
    let clock = new Date(2026, 10, 18, 12);
    const generate = async (day: string) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return article(day);
    };
    const coordinator = new DailyRecommendations(store, generate, () => clock);
    const results = await Promise.all([
      coordinator.ensure(),
      coordinator.ensure(),
      coordinator.ensure(true),
    ]);
    assert.equal(calls, 1);
    assert.ok(
      results.every(
        (result) => result.recommendation?.title === article().title,
      ),
    );
    store.saveRecommendation(article("2026-11-18", "A competing article"));
    assert.equal(
      store.dailyRecommendation("2026-11-18")?.title,
      article().title,
    );
    store.close();
    store = new Store(join(directory, "data.sqlite"));
    const reopened = new DailyRecommendations(store, generate, () => clock);
    await reopened.ensure();
    assert.equal(calls, 1);
    clock = new Date(2026, 10, 19, 1);
    await reopened.ensure();
    assert.equal(calls, 2);
    coordinator.dispose();
    reopened.dispose();
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("explicit refresh replaces today's result, excludes current URL and preserves old article on failure/cancel", async () => {
  const store = new Store(":memory:");
  const original = store.saveRecommendation(article());
  store.saveArticleBookmark(original);
  let calls = 0;
  let mode = "success";
  let exclusions: string[] = [];
  const changed = {
    ...original,
    title: "A different story",
    url: "https://example.com/new-story",
    citations: ["https://example.com/new-story"],
  };
  const coordinator = new DailyRecommendations(
    store,
    async (_day, _sites, _signal, excluded) => {
      calls++;
      exclusions = excluded;
      if (mode === "fail") throw new Error("refresh failed");
      if (mode === "hang") return new Promise(() => {});
      return changed;
    },
    () => new Date(2026, 10, 18, 12),
  );
  try {
    await coordinator.ensure(true);
    assert.equal(calls, 0);
    const [first, second] = await Promise.all([
      coordinator.refresh(),
      coordinator.refresh(),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(exclusions, [original.url]);
    assert.equal(first.recommendation?.url, changed.url);
    assert.deepEqual(second, first);
    assert.equal(store.dailyRecommendation(original.day)?.url, changed.url);
    assert.equal(store.list<any>("article-bookmark")[0].url, original.url);
    await coordinator.ensure(true);
    assert.equal(calls, 1);
    mode = "same";
    const same = await coordinator.refresh();
    assert.match(same.error!, /不同|相同/);
    assert.equal(same.recommendation?.url, changed.url);
    mode = "fail";
    assert.equal(
      (await coordinator.refresh()).recommendation?.url,
      changed.url,
    );
    assert.match(coordinator.state().error!, /refresh failed/);
    mode = "hang";
    const pending = coordinator.refresh();
    assert.equal(coordinator.state().status, "searching");
    assert.equal(coordinator.state().recommendation?.url, changed.url);
    coordinator.cancel();
    const cancelled = await pending;
    assert.match(cancelled.error!, /取消/);
    assert.equal(cancelled.recommendation?.url, changed.url);
    assert.equal(store.dailyRecommendation(original.day)?.url, changed.url);
  } finally {
    coordinator.dispose();
    store.close();
  }
});

test("closing during a refresh settles without reading a closed database", async () => {
  const store = new Store(":memory:");
  store.saveRecommendation(article());
  const coordinator = new DailyRecommendations(
    store,
    () => new Promise(() => {}),
    () => new Date(2026, 10, 18, 12),
  );
  const pending = coordinator.refresh();
  coordinator.dispose();
  store.close();
  assert.equal((await pending).status, "error");
});

test("failed search can retry, hanging search can cancel, and late/yesterday responses never save", async () => {
  const store = new Store(":memory:");
  let clock = new Date(2026, 10, 18, 12);
  let fail = true;
  const coordinator = new DailyRecommendations(
    store,
    async (day) => {
      if (fail) throw new Error("搜尋暫時不可用");
      return article(day);
    },
    () => clock,
  );
  assert.equal((await coordinator.ensure()).status, "error");
  fail = false;
  assert.equal((await coordinator.ensure()).status, "error");
  assert.equal((await coordinator.ensure(true)).status, "ready");
  clock = new Date(2026, 10, 19, 1);
  let finish!: (value: DailyRecommendation) => void;
  const hanging = new DailyRecommendations(
    store,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => clock,
  );
  const pending = hanging.ensure();
  hanging.cancel();
  assert.equal((await pending).status, "error");
  finish(article("2026-11-19"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.dailyRecommendation("2026-11-19"), undefined);
  const midnight = new DailyRecommendations(
    store,
    async (day) => {
      clock = new Date(2026, 10, 20);
      return article(day);
    },
    () => clock,
  );
  await midnight.ensure();
  assert.equal(store.dailyRecommendation("2026-11-19"), undefined);
  coordinator.dispose();
  hanging.dispose();
  midnight.dispose();
  store.close();
});
test("backup includes sites and history, merge keeps local dates, replace keeps today's fixed choice, old backups work", () => {
  const store = new Store(":memory:");
  const restored = new Store(":memory:");
  store.setRecommendationSettings({
    enabled: true,
    websites: ["https://www.npr.org/"],
  });
  store.saveRecommendation(article());
  const backup = store.backup();
  restored.restore(backup, "merge", "2026-11-18");
  assert.deepEqual(restored.recommendationSettings().websites, [
    "https://www.npr.org/",
  ]);
  restored.saveRecommendation(article("2026-11-17", "Yesterday"));
  restored.restore(
    {
      ...backup,
      recommendations: [article("2026-11-18", "Changed by backup")],
    },
    "replace",
    "2026-11-18",
  );
  assert.equal(
    restored.dailyRecommendation("2026-11-18")?.title,
    article().title,
  );
  const {
    recommendations: _records,
    recommendationSettings: _settings,
    ...legacy
  } = backup;
  restored.restore(legacy, "replace", "2026-11-18");
  assert.equal(
    restored.dailyRecommendation("2026-11-18")?.title,
    article().title,
  );
  store.close();
  restored.close();
});
test("new-day errors are not overwritten by the cancelled previous day's search", async () => {
  const store = new Store(":memory:");
  let clock = new Date(2026, 10, 18, 23, 59);
  const coordinator = new DailyRecommendations(
    store,
    (day) => {
      if (day === "2026-11-19") throw new Error("Today's search failed");
      return new Promise(() => {});
    },
    () => clock,
  );
  const previous = coordinator.ensure();
  clock = new Date(2026, 10, 19, 0, 1);
  await coordinator.ensure();
  await previous;
  assert.equal(coordinator.state().error, "Today's search failed");
  assert.equal(coordinator.busy, false);
  coordinator.dispose();
  store.close();
});
test("real service-style done items are retained when the terminal event has an empty output array", async () => {
  const network = globalThis.fetch;
  const record = article();
  try {
    globalThis.fetch = async () =>
      new Response(
        [
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                sources: [{ type: "url", url: record.url }],
              },
            },
          },
          {
            type: "response.output_item.done",
            output_index: 1,
            item: {
              type: "message",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: record.title,
                    url: record.url,
                    publishedDate: record.publishedDate,
                    reasonChinese: record.reasonChinese,
                  }),
                },
              ],
            },
          },
          {
            type: "response.completed",
            response: { status: "completed", output: [] },
          },
        ]
          .map((event) => "data: " + JSON.stringify(event) + "\n\n")
          .join(""),
      );
    assert.equal(
      (
        await new SearchRecommendationProvider().search(
          record.day,
          [],
          "fixture",
          "fixture",
          new AbortController().signal,
        )
      ).url,
      record.url,
    );
  } finally {
    globalThis.fetch = network;
  }
});
test("finished streamed items never bypass failed, incomplete or missing terminal events", async () => {
  const done =
    "data: " +
    JSON.stringify({
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        content: [{ type: "output_text", text: "uncommitted" }],
      },
    }) +
    "\n\n";
  for (const suffix of [
    "",
    "data: " +
      JSON.stringify({
        type: "response.failed",
        response: { error: { message: "failed" } },
      }) +
      "\n\n",
    "data: " + JSON.stringify({ type: "response.incomplete" }) + "\n\n",
  ]) {
    let accepted = false;
    await assert.rejects(
      readResponsesStream(
        new Response(done + suffix),
        undefined,
        undefined,
        () => {
          accepted = true;
        },
      ),
    );
    assert.equal(accepted, false);
  }
});
test("search provider requires a real completed search and matching cited URL; no private article context is sent", async () => {
  const network = globalThis.fetch;
  const provider = new SearchRecommendationProvider();
  let output: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      assert.deepEqual(request.tools, [{ type: "web_search" }]);
      assert.equal(request.store, false);
      assert.equal(request.stream, true);
      assert.ok(request.include.includes("web_search_call.action.sources"));
      assert.ok(JSON.stringify(request.input).includes("www.npr.org"));
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: { status: "completed", output },
          }) +
          "\n\n",
      );
    };
    const a = article();
    const message = {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            title: a.title,
            url: a.url,
            publishedDate: a.publishedDate,
            reasonChinese: a.reasonChinese,
          }),
        },
      ],
    };
    output = [message];
    await assert.rejects(
      provider.search(
        a.day,
        ["https://www.npr.org/"],
        "fixture",
        "fixture-token",
        new AbortController().signal,
      ),
      /搜尋來源/,
    );
    output = [
      {
        type: "web_search_call",
        status: "completed",
        action: { type: "search", sources: [{ url: a.url }] },
      },
      message,
    ];
    assert.equal(
      (
        await provider.search(
          a.day,
          ["https://www.npr.org/"],
          "fixture",
          "fixture-token",
          new AbortController().signal,
        )
      ).url,
      a.url,
    );
    output = [
      {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          sources: [{ url: "https://example.com/other" }],
        },
      },
      message,
    ];
    await assert.rejects(
      provider.search(
        a.day,
        ["https://www.npr.org/"],
        "fixture",
        "fixture-token",
        new AbortController().signal,
      ),
      /搜尋來源/,
    );
  } finally {
    globalThis.fetch = network;
  }
});
