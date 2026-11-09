import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  generateKeyPairSync,
} from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import {
  ChatGPTAuth,
  verifyChatGPTIdentity,
  type AuthOptions,
} from "../electron/chatgpt-auth";
import { readResponsesStream } from "../electron/ai";

// Fixture encryption is independent of the production Windows DPAPI implementation.
const encryptionKey = randomBytes(32);
const encrypt = async (text: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  return Buffer.concat([
    iv,
    cipher.update(text, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
};
const decrypt = async (buffer: Buffer) => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    buffer.subarray(0, 12),
  );
  decipher.setAuthTag(buffer.subarray(-16));
  return Buffer.concat([
    decipher.update(buffer.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
};
const tokenResponse = {
  access_token: "fixture-access",
  refresh_token: "fixture-refresh",
  id_token: "fixture-id",
  token_type: "Bearer",
  expires_in: 3600,
  scope:
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
};

test("OAuth loopback validates state, exchanges PKCE, encrypts tokens, reopens, refreshes once, and reuses registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reading-subscription-"));
  const original = globalThis.fetch;
  const calls: URLSearchParams[] = [];
  let browserCount = 0;
  let verifierChallenge = "";
  let callbackClient = "oaiapp_fixture";
  const options: AuthOptions = {
    encrypt,
    decrypt,
    verifyIdentity: async (_token, clientId, nonce) => {
      assert.equal(clientId, "oaiapp_fixture");
      assert.ok(nonce === undefined || nonce.length > 20);
      return { subject: "fixture-user", email: "reader@example.test" };
    },
    openBrowser: async (value) => {
      const url = new URL(value);
      browserCount++;
      assert.equal(url.origin, "https://auth.openai.com");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      verifierChallenge = url.searchParams.get("code_challenge")!;
      assert.equal(
        url.searchParams.get("client_id"),
        browserCount === 1 ? "dynamic_agent_client" : "oaiapp_fixture",
      );
      if (browserCount === 1)
        assert.equal(url.searchParams.get("agent_name_hint"), "Reading Desk");
      else assert.equal(url.searchParams.has("agent_name_hint"), false);
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "fixture-code");
      callback.searchParams.set("client_id", callbackClient);
      callback.searchParams.set("state", "wrong");
      assert.equal((await original(callback)).status, 400);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      assert.equal((await original(callback)).status, 200);
    },
  };
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/oauth/token")) {
        const form = new URLSearchParams(init?.body as URLSearchParams);
        calls.push(form);
        assert.equal(form.get("client_id"), "oaiapp_fixture");
        assert.equal(form.get("resource"), "https://api.openai.com/v1");
        if (form.get("grant_type") === "authorization_code")
          assert.equal(
            createHash("sha256")
              .update(form.get("code_verifier")!)
              .digest("base64url"),
            verifierChallenge,
          );
        return new Response(
          JSON.stringify({
            ...tokenResponse,
            ...(form.get("grant_type") === "refresh_token"
              ? {
                  access_token: "renewed-access",
                  refresh_token: "renewed-refresh",
                }
              : {}),
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith("/oauth/revoke"))
        return new Response(null, { status: 200 });
      if (String(url).endsWith("/models"))
        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "fixture-model",
                display_name: "Fixture model",
                visibility: "list",
              },
              { slug: "hidden", display_name: "Hidden", visibility: "hide" },
            ],
          }),
        );
      throw new Error("unexpected network request");
    };
    const auth = new ChatGPTAuth(directory, options);
    await auth.signIn();
    const session = await auth.session();
    assert.equal(session.sharing, true);
    assert.equal(session.profiles[0].email, "reader@example.test");
    assert.ok(!JSON.stringify(session).includes("fixture-access"));
    const encrypted = await readFile(
      join(directory, "chatgpt-session.encrypted"),
    );
    assert.equal(encrypted.includes("fixture-access"), false);
    const saved = JSON.parse(await decrypt(encrypted));
    saved.profiles[0].credentials.expiresAt = Date.now() - 1;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(directory, "chatgpt-session.encrypted"),
      await encrypt(JSON.stringify(saved)),
    );
    const reopened = new ChatGPTAuth(directory, options);
    const tokens = await Promise.all([
      reopened.accessToken(),
      reopened.accessToken(),
    ]);
    assert.deepEqual(tokens, ["renewed-access", "renewed-access"]);
    assert.equal(
      calls.filter((c) => c.get("grant_type") === "refresh_token").length,
      1,
    );
    assert.deepEqual(await reopened.models(), [
      { slug: "fixture-model", displayName: "Fixture model" },
    ]);
    assert.deepEqual(await reopened.signOut(), { remoteRevoked: true });
    assert.equal((await reopened.session()).connected, false);
    await reopened.signIn({ profileId: session.activeProfileId! });
    assert.equal((await reopened.session()).profiles.length, 1);
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("declined plan permission retains identity and blocks inference; cancelling sign-in closes listener", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reading-consent-"));
  const original = globalThis.fetch;
  let callbackUrl = "";
  let resolveBrowser!: () => void;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ...tokenResponse, scope: "openid email" }));
    const auth = new ChatGPTAuth(directory, {
      encrypt,
      decrypt,
      verifyIdentity: async () => ({
        subject: "user",
        email: "reader@example.test",
      }),
      openBrowser: async (url) => {
        const query = new URL(url).searchParams;
        const callback = new URL(query.get("redirect_uri")!);
        callback.searchParams.set("state", query.get("state")!);
        callback.searchParams.set("code", "code");
        callback.searchParams.set("client_id", "oaiapp_consent");
        await original(callback);
      },
    });
    await auth.signIn();
    assert.equal((await auth.session()).connected, true);
    assert.equal((await auth.session()).sharing, false);
    await assert.rejects(() => auth.accessToken(), /啟用/);
    const opened = new Promise<void>((resolve) => {
      resolveBrowser = resolve;
    });
    const cancelled = new ChatGPTAuth(directory, {
      encrypt,
      decrypt,
      openBrowser: async (url) => {
        callbackUrl = new URL(url).searchParams.get("redirect_uri")!;
        resolveBrowser();
      },
    });
    const pending = cancelled.signIn();
    await opened;
    cancelled.cancelSignIn();
    await assert.rejects(pending, /取消/);
    await assert.rejects(() => original(callbackUrl));
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test("real JWT verifier checks signature, issuer, audience, expiry and nonce", async () => {
  const original = globalThis.fetch;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = await importPKCS8(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    "RS256",
  );
  const jwk = publicKey.export({ format: "jwk" });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        keys: [{ ...jwk, kid: "reading-fixture", alg: "RS256", use: "sig" }],
      }),
    );
  try {
    const sign = (audience: string, expiry: string | number = "1h") =>
      new SignJWT({ nonce: "expected", email: "reader@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "reading-fixture" })
        .setIssuer("https://auth.openai.com")
        .setAudience(audience)
        .setSubject("verified-reader")
        .setIssuedAt()
        .setExpirationTime(expiry)
        .sign(key);
    const token = await sign("oaiapp_verified");
    assert.equal(
      (await verifyChatGPTIdentity(token, "oaiapp_verified", "expected"))
        .subject,
      "verified-reader",
    );
    await assert.rejects(() =>
      verifyChatGPTIdentity(token, "different", "expected"),
    );
    await assert.rejects(
      () => verifyChatGPTIdentity(token, "oaiapp_verified", "wrong"),
      /驗證碼/,
    );
    await assert.rejects(async () =>
      verifyChatGPTIdentity(
        await sign("oaiapp_verified", 1),
        "oaiapp_verified",
        "expected",
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("SSE handles bytewise UTF-8 and CRLF boundaries, refuses partial and failed streams", async () => {
  const output = JSON.stringify({ translation: "這是測試。" });
  const frame = `event: response.completed\r\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ content: [{ type: "output_text", text: output }] }] } })}\r\n\r\n`;
  const bytes = new TextEncoder().encode(frame);
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(index, index++ + 1));
    },
  });
  assert.equal(await readResponsesStream(new Response(stream)), output);
  await assert.rejects(
    () =>
      readResponsesStream(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        ),
      ),
    /中斷/,
  );
  await assert.rejects(
    () =>
      readResponsesStream(
        new Response(
          'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n',
        ),
      ),
    /用量上限/,
  );
});
