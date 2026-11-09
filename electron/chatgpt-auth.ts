import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { ChatGPTSession, ChatGPTModel } from "../shared/api";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const sharingScope = "chatgpt.tokens.use.direct";
const scopes = `openid profile email offline_access resource.invoke ${sharingScope}`;
const credentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  idToken: z.string().min(1),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});
const profileSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string(),
  credentials: credentialSchema.optional(),
});
const vaultSchema = z.object({
  hostId: z.string().startsWith("urn:uuid:"),
  activeProfileId: z.string().uuid().nullable(),
  pendingClientId: z.string().optional(),
  profiles: z.array(profileSchema),
});
type Vault = z.infer<typeof vaultSchema>;
type Credentials = z.infer<typeof credentialSchema>;
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  token_type: z.string().regex(/^Bearer$/i),
  expires_in: z.number().positive().max(86400),
  scope: z.string().optional(),
});
type TokenResponse = z.infer<typeof tokenResponseSchema>;
export interface AuthOptions {
  openBrowser: (url: string) => Promise<void>;
  encrypt: (text: string) => Promise<Buffer>;
  decrypt: (buffer: Buffer) => Promise<string>;
  // Dependency injection is only used by tests. Production uses OpenAI's pinned JWKS.
  verifyIdentity?: (
    token: string,
    clientId: string,
    nonce?: string,
  ) => Promise<{ subject: string; email: string }>;
}
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
  timeoutDuration: 15000,
});
export async function verifyChatGPTIdentity(
  token: string,
  clientId: string,
  nonce?: string,
) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (nonce !== undefined && payload.nonce !== nonce)
    throw new Error("登入驗證碼不符，請重新登入。");
  return {
    subject: payload.sub!,
    email: typeof payload.email === "string" ? payload.email : payload.sub!,
  };
}

export class ChatGPTAuth {
  private vault?: Vault;
  private loading?: Promise<void>;
  private signInController?: AbortController;
  private refreshing?: Promise<string>;
  private changingAccount = false;
  private file: string;
  constructor(
    private directory: string,
    private options: AuthOptions,
  ) {
    this.file = join(directory, "chatgpt-session.encrypted");
  }
  private async load() {
    if (this.vault) return;
    if (!this.loading)
      this.loading = (async () => {
        try {
          this.vault = vaultSchema.parse(
            JSON.parse(await this.options.decrypt(await readFile(this.file))),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error(
              "無法讀取 ChatGPT 安全登入資料，請檢查作業系統安全儲存後重試。",
            );
          this.vault = {
            hostId: `urn:uuid:${randomUUID()}`,
            activeProfileId: null,
            profiles: [],
          };
        }
      })().finally(() => {
        this.loading = undefined;
      });
    await this.loading;
  }
  private async save(vault: Vault) {
    await mkdir(this.directory, { recursive: true });
    const encrypted = await this.options.encrypt(JSON.stringify(vault));
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.file);
      this.vault = vault;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  async session(): Promise<ChatGPTSession> {
    try {
      await this.load();
    } catch (error) {
      return {
        profiles: [],
        activeProfileId: null,
        connected: false,
        sharing: false,
        signingIn: false,
        error: (error as Error).message,
      };
    }
    const active = this.vault!.profiles.find(
      (p) => p.id === this.vault!.activeProfileId,
    );
    return {
      profiles: this.vault!.profiles.map((p) => ({
        id: p.id,
        email: p.email,
        connected: !!p.credentials,
        sharing: !!p.credentials?.scopes.includes(sharingScope),
      })),
      activeProfileId: this.vault!.activeProfileId,
      connected: !!active?.credentials,
      sharing: !!active?.credentials?.scopes.includes(sharingScope),
      signingIn: !!this.signInController,
    };
  }
  cancelSignIn() {
    this.signInController?.abort();
  }
  get busy() {
    return !!this.signInController || !!this.refreshing || this.changingAccount;
  }
  async signIn(input: { profileId?: string; enableSharing?: boolean } = {}) {
    if (this.busy) throw new Error("登入或憑證更新正在進行中，請稍候。");
    const controller = new AbortController();
    this.signInController = controller;
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      await this.load();
      const saved = input.profileId
        ? this.vault!.profiles.find((p) => p.id === input.profileId)
        : undefined;
      if (input.profileId && !saved) throw new Error("找不到已保存的帳戶。");
      // Persist the installation identity before opening the first authorization.
      await this.save(this.vault!);
      const clientId =
        saved?.clientId ??
        this.vault!.pendingClientId ??
        "dynamic_agent_client";
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const callback = await this.authorize({
        clientId,
        state,
        nonce,
        verifier,
        saved,
        input,
        signal: controller.signal,
      });
      if (!saved)
        await this.save({ ...this.vault!, pendingClientId: callback.clientId });
      const tokens = await this.exchange(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: callback.clientId,
          code: callback.code,
          code_verifier: verifier,
          redirect_uri: callback.redirectUri,
          resource,
        }),
        controller.signal,
      );
      if (!tokens.id_token)
        throw new Error("登入回應缺少可驗證的身分，請重新登入。");
      const identity = await (
        this.options.verifyIdentity ?? verifyChatGPTIdentity
      )(tokens.id_token, callback.clientId, nonce);
      controller.signal.throwIfAborted();
      if (saved && identity.subject !== saved.subject)
        throw new Error("登入帳戶與原先選取的帳戶不同，請改用新增帳戶。");
      const profile = {
        id: saved?.id ?? randomUUID(),
        clientId: callback.clientId,
        ...identity,
        credentials: this.credentials(tokens),
      };
      await this.save({
        ...this.vault!,
        pendingClientId: undefined,
        activeProfileId: profile.id,
        profiles: [
          ...this.vault!.profiles.filter((p) => p.id !== profile.id),
          profile,
        ],
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error("ChatGPT 登入已取消或超過五分鐘，請重新登入。");
      if (error instanceof TypeError)
        throw new Error("無法連線 ChatGPT 登入服務，請檢查網路後重試。");
      throw error;
    } finally {
      clearTimeout(timeout);
      this.signInController = undefined;
    }
  }
  private async authorize(context: {
    clientId: string;
    state: string;
    nonce: string;
    verifier: string;
    saved: z.infer<typeof profileSchema> | undefined;
    input: { enableSharing?: boolean };
    signal: AbortSignal;
  }) {
    const { clientId, state, nonce, verifier, saved, input, signal } = context;
    let resolveCallback!: (result: {
      code: string;
      clientId: string;
      redirectUri: string;
    }) => void;
    let rejectCallback!: (error: Error) => void;
    const callback = new Promise<{
      code: string;
      clientId: string;
      redirectUri: string;
    }>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    // Attach a handler immediately, including when browser opening fails.
    void callback.catch(() => {});
    let redirectUri = "";
    let accepting = true;
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      const url = new URL(request.url ?? "/", redirectUri);
      if (
        request.method !== "GET" ||
        url.pathname !== "/auth/callback" ||
        request.headers.host !== new URL(redirectUri).host
      ) {
        response.writeHead(404).end("Not found");
        return;
      }
      if (!accepting || url.searchParams.get("state") !== state) {
        response.writeHead(400).end("Invalid authorization state");
        return;
      }
      const returnedClientId =
        url.searchParams.get("client_id") ??
        (clientId !== "dynamic_agent_client" ? clientId : "");
      if (url.searchParams.has("error")) {
        accepting = false;
        response.end("授權已取消，請返回 Reading Desk。");
        rejectCallback(
          new Error("ChatGPT 授權未完成，請重新登入並允許使用訂閱方案。"),
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (
        !code ||
        !returnedClientId ||
        returnedClientId === "dynamic_agent_client" ||
        (clientId !== "dynamic_agent_client" && returnedClientId !== clientId)
      ) {
        response.writeHead(400).end("Invalid authorization callback");
        return;
      }
      accepting = false;
      response.end("已收到登入回應，請返回 Reading Desk 查看結果。");
      resolveCallback({ code, clientId: returnedClientId, redirectUri });
    });
    const onAbort = () => rejectCallback(new Error("登入已取消。"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("無法啟動本機登入接收器。");
      redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
      const query = new URLSearchParams({
        client_id: clientId,
        ext_agent_host_id: this.vault!.hostId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        resource,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      });
      if (clientId === "dynamic_agent_client")
        query.set("agent_name_hint", "Reading Desk");
      if (saved?.credentials?.idToken)
        query.set("id_token_hint", saved.credentials.idToken);
      if (saved?.email) query.set("login_hint", saved.email);
      if (input.enableSharing) query.set("prompt", "consent");
      signal.throwIfAborted();
      await this.options.openBrowser(
        `${issuer}/api/accounts/authorize?${query}`,
      );
      return await callback;
    } finally {
      signal.removeEventListener("abort", onAbort);
      server.close();
      server.closeAllConnections();
    }
  }
  private credentials(
    tokens: TokenResponse,
    previous?: Credentials,
  ): Credentials {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous?.refreshToken,
      idToken: tokens.id_token ?? previous!.idToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes:
        tokens.scope === undefined
          ? (previous?.scopes ?? [])
          : tokens.scope.split(/\s+/).filter(Boolean),
    };
  }
  private async exchange(
    body: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<TokenResponse> {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      let code = "";
      try {
        const data = (await response.json()) as {
          error?: string | { code?: string };
        };
        code =
          typeof data.error === "string"
            ? data.error
            : (data.error?.code ?? "");
      } catch {}
      const terminal = [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
      ].includes(code);
      if (terminal && body.get("grant_type") === "refresh_token") {
        const active = this.vault!.activeProfileId;
        await this.save({
          ...this.vault!,
          profiles: this.vault!.profiles.map((p) =>
            p.id === active ? { ...p, credentials: undefined } : p,
          ),
        });
      }
      throw new Error(
        terminal
          ? "ChatGPT 登入已失效，請選擇原帳戶重新登入。"
          : `ChatGPT 登入服務暫時無法完成操作（HTTP ${response.status}），請稍後重試。`,
      );
    }
    try {
      return tokenResponseSchema.parse(await response.json());
    } catch {
      throw new Error("ChatGPT 憑證回應格式不正確，請重新登入。");
    }
  }
  async accessToken(): Promise<string> {
    await this.load();
    if (this.changingAccount)
      throw new Error("正在變更 ChatGPT 帳戶，請稍候。");
    if (this.signInController) throw new Error("請等待 ChatGPT 登入完成。");
    const profile = this.vault!.profiles.find(
      (p) => p.id === this.vault!.activeProfileId,
    );
    if (!profile?.credentials) throw new Error("請先到設定使用 ChatGPT 登入。");
    if (!profile.credentials.scopes.includes(sharingScope))
      throw new Error("請在設定啟用「使用 ChatGPT 訂閱」，完成授權後再解析。");
    if (profile.credentials.expiresAt > Date.now() + 60000)
      return profile.credentials.accessToken;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!profile.credentials!.refreshToken)
        throw new Error("ChatGPT 登入已過期，請重新登入。");
      const tokens = await this.exchange(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: profile.clientId,
          refresh_token: profile.credentials!.refreshToken,
          resource,
        }),
      );
      if (tokens.id_token) {
        const identity = await (
          this.options.verifyIdentity ?? verifyChatGPTIdentity
        )(tokens.id_token, profile.clientId);
        if (identity.subject !== profile.subject)
          throw new Error("更新憑證的帳戶不符，請重新登入。");
      }
      const credentials = this.credentials(tokens, profile.credentials);
      await this.save({
        ...this.vault!,
        profiles: this.vault!.profiles.map((p) =>
          p.id === profile.id ? { ...p, credentials } : p,
        ),
      });
      if (!credentials.scopes.includes(sharingScope))
        throw new Error("ChatGPT 訂閱授權已停用，請到設定重新啟用。");
      return credentials.accessToken;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }
  async selectAccount(profileId: string) {
    if (this.busy) throw new Error("登入或憑證更新中，請稍候。");
    this.changingAccount = true;
    try {
      await this.load();
      if (!this.vault!.profiles.some((p) => p.id === profileId))
        throw new Error("帳戶不存在。");
      await this.save({ ...this.vault!, activeProfileId: profileId });
    } finally {
      this.changingAccount = false;
    }
  }
  async models(): Promise<ChatGPTModel[]> {
    const token = await this.accessToken();
    const response = await fetch(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `無法取得 ChatGPT 可用模型（HTTP ${response.status}），請檢查訂閱授權後重試。`,
      );
    const parsed = z
      .object({
        models: z.array(
          z.object({
            slug: z.string().min(1).max(100),
            display_name: z.string(),
            visibility: z.string(),
          }),
        ),
      })
      .safeParse(await response.json());
    if (!parsed.success)
      throw new Error("ChatGPT 模型清單格式不正確，請稍後重新整理。");
    return parsed.data.models
      .filter((m) => m.visibility === "list")
      .map((m) => ({ slug: m.slug, displayName: m.display_name }));
  }
  async signOut(): Promise<{ remoteRevoked: boolean }> {
    if (this.busy) throw new Error("請先完成或取消登入，稍後再登出。");
    this.changingAccount = true;
    try {
      await this.load();
      const profile = this.vault!.profiles.find(
        (p) => p.id === this.vault!.activeProfileId,
      );
      let remoteRevoked = !profile?.credentials?.refreshToken;
      if (profile?.credentials?.refreshToken) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(
              `${issuer}/api/accounts/oauth/revoke`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  token: profile.credentials.refreshToken,
                  token_type_hint: "refresh_token",
                  client_id: profile.clientId,
                }),
                signal: AbortSignal.timeout(10000),
              },
            );
            if (response.status === 200) {
              remoteRevoked = true;
              break;
            }
            if (response.status < 500) break;
          } catch {}
          if (attempt === 0)
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (profile)
        await this.save({
          ...this.vault!,
          profiles: this.vault!.profiles.map((p) =>
            p.id === profile.id ? { ...p, credentials: undefined } : p,
          ),
        });
      return { remoteRevoked };
    } finally {
      this.changingAccount = false;
    }
  }
}
