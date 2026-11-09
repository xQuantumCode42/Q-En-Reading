# Reading Desk · 英文閱讀桌面 App

Windows 桌面應用程式，Electron + React + TypeScript，以 SQLite 儲存個人的英文原文、語境收藏與筆記。介面為繁體中文，AI 使用英文解釋並提供繁體中文輔助。原文不會自動簡化。

## 開啟專案

在 VS Code 選擇「檔案 → 開啟資料夾」，選取專案根目錄。也可在專案目錄開啟終端機並執行：

```powershell
code .
```

## 直接使用 Windows 版本

訂閱版 1.1.1 安裝檔位於 `release/Reading Desk Setup 1.1.1.exe`。亦可直接執行 `release/win-unpacked/Reading Desk.exe`，無須 Node.js。

此為尚未使用程式碼簽章憑證的個人使用版本。Windows 可能顯示發行者不明。已驗證 Windows 打包與解壓版執行；未進行實際安裝／解除安裝，也未驗證其他乾淨 Windows 電腦。

## 開發與建置

需要 Node.js **24 或更新版本**（建議 Node 24 LTS）與 npm。內建 `node:sqlite`，不需另外安裝 SQLite 或 Visual Studio C++ 工具鏈。

開發時請先讓 Node 24+ 位於 PATH，`scripts/run.ps1` 會從 PATH 中選擇第一個符合的版本。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1 install
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1 dev
```

若 PATH 已使用 Node 24+，標準指令如下：

```powershell
npm ci
npm run dev           # Vite 開發伺服器 + Electron 桌面視窗
npm run typecheck     # React / 主程序 / preload 型別檢查
npm test              # SQLite、備份、AI 結構驗證與 HTTP adapter 測試
npm run test:desktop  # 建置後啟動真實 Electron 進行整合測試
npm run build         # 正式建置
npm start             # 啟動正式建置的桌面 App，須先 build
npm run pack:win      # Windows x64 NSIS 安裝檔，輸出至 release/
npm run pack:dir      # 不產生安裝檔，只產生解壓版
npm run format        # 格式化原始碼
```

`run.ps1` 也接受 `build`、`start`、`test`、`test:desktop`、`pack:win`、`pack:dir`。VS Code 的「終端機 → 執行工作」也有開發、建置與測試工作。

開發伺服器只監聽 `127.0.0.1:5173`；正式版讀取打包的本機檔案，不需要啟動網站伺服器。修改 `electron/` 或 `shared/` 主程序程式碼時請重新啟動開發指令；React 修改會即時更新。首次安裝套件、下載 Electron 或 NSIS 工具需要網路。

## 使用方式

1. 點「新增文章」，輸入標題、貼上英文原文，選填 http/https 來源網址。儲存後立即進入閱讀，不會自動呼叫 AI。
2. 在「設定 → ChatGPT 訂閱」按 **Continue with ChatGPT**，在系統瀏覽器登入自己的 Plus／Pro 帳戶，並允許 Reading Desk 使用訂閱。返回 App 後應顯示「已啟用 · 使用 ChatGPT 訂閱」。模型清單取自登入帳戶，首次登入會自動選擇可用模型，其他選擇需按「保存設定」。
3. 滑鼠選取或使用鍵盤選取原文，再點「字詞解析」或「句子解析」。AI 會收到選取與附近的原文作為語境。點「整理全文學習重點」會傳送整篇文章，產生摘要與八個項目。等待時會顯示目前階段、經過秒數與已收到的字元數，也可按「取消解析」保留選取後重試。
4. 解析後按項目旁的星號，或填寫右側筆記／標籤再按「收藏並保存筆記」。每筆收藏獨立保存語境，支援同詞多義。未登入也能先收藏選取文字並手動編輯本文意思與筆記。
5. 在「星號收藏」搜尋字詞、意思、文章來源標題、標籤或筆記，點卡片編輯。取消收藏需再次點擊確認。
6. 文章清單可重新命名、刪除。刪除文章會移除文章與解析，但保留收藏中的來源快照、原文句子、例句及筆記。
7. 閱讀捲動位置會保存；重新開啟後選擇同篇文章即會回到該位置。可調字體、行距及明暗模式。

未登入時，文章庫、原文閱讀、收藏與筆記管理、備份都可離線使用。設定頁提供取消登入、切換／新增帳戶、重新授權及登出。登出會嘗試撤銷遠端可更新的登入憑證，若撤銷未確認，App 會提示至 ChatGPT 設定中斷連線。

此版本只使用 ChatGPT 訂閱授權。登入與使用訂閱是兩項權限，若僅完成登入，請按「啟用訂閱使用授權」。實際資格、可用模型及用量上限由 OpenAI 回應決定。按「管理 ChatGPT 用量」可開啟官方設定，調整這個 App 的用量。授權說明見 [官方文件](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)。

## 資料與安全

- 正常使用資料位於 Electron 的 `app.getPath('userData')`，Windows 一般為 `%APPDATA%\Reading Desk`。設定頁顯示實際絕對路徑，不會存入安裝目錄或專案目錄。
- `reading-desk.sqlite` 保存文章、位置、解析、收藏、筆記與閱讀設定。SQLite WAL 與交易保護寫入；請透過匯出功能備份，勿在程式執行時只複製單一 sqlite 檔。
- `chatgpt-session.encrypted` 使用 Electron `safeStorage` 非同步 API，由 Windows DPAPI 加密。內容包含各帳戶的已驗證身分、獨立客戶端註冊、存取及更新憑證、有效時間與授權範圍，以及此安裝的穩定主機識別碼。畫面僅取得帳戶名稱及授權狀態。憑證不會包含在文章備份中。
- 登入使用官方 OAuth + PKCE，驗證 state、nonce、ID token 簽章、issuer、audience、到期時間及帳戶身分。臨時回呼只監聽 `127.0.0.1`，五分鐘逾時或取消後關閉。過期憑證的更新會共用同一個進行中的請求，並一起保存輪替後的憑證。
- Linux 若只能使用 `basic_text` 或 OS 安全儲存不可用，程式拒絕保存登入憑證。macOS/Linux 執行與打包未驗證。
- 升級保留原有 SQLite 文章、收藏、筆記與解析。成功登入後會移除舊版未再使用的 `api-key.encrypted`。程式採單一實例，避免同時更新同一個帳戶的輪替憑證。
- Renderer 採 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。preload 只暴露固定方法，主程序驗證 IPC 來源、主框架與輸入，拒絕新視窗、任意導向與權限請求。文章及 AI 結果當純文字顯示，不插入 HTML。
- AI 僅主程序可呼叫，使用訂閱 OAuth 存取憑證、官方 Responses 串流、嚴格 JSON Schema 與 Zod 驗證。字詞、句子、全文各自使用精簡的回傳結構，字詞固定一個項目，全文固定八個項目，每項包含必填的日常與原文情境例句。只有收到 `response.completed` 且原文引句確實存在文章內，才轉成既有本機格式保存。舊解析與備份相容。
- 解析按文章、類型、選取起迄位置與模型快取，同一請求進行中也會共用，避免重複消耗用量。既有解析仍可離線查看。
- 失敗顯示設定、認證、額度、網路、逾時或格式錯誤，保留文章／選取並提供重試。從憑證更新開始計算整體 90 秒期限，最多同時進行兩個請求。即使網路讀取或清理無法即時完成，取消與逾時仍會釋放畫面等待狀態，逾期結果不會保存。
- 為保留完整語境，單篇可保存 200,000 字元，AI 解析限制 60,000 字元；選取解析限制 10,000 字元。較長文章請自行分篇。
- 訂閱解析使用 `store:false`、`stream:true`、陣列形式的 `input`，並遵守官方預覽限制。服務商自身的資料保留政策仍適用。

## 備份格式與衝突處理

設定頁可匯出 UTF-8 JSON，包含 `format: "reading-desk"`、`version: 1`、匯出時間、文章、解析、收藏與偏好設定。登入憑證由各電腦獨立保存。舊版文章備份仍可還原。備份是未加密的個人資料，請自行妥善保管。

還原先驗證整份結構、欄位界限、版本、重複 ID、解析的原文位置、收藏關聯與 AI 資料格式。檔案上限 100 MB。不合法就拒絕，不會修改既有資料。確認後先將現有資料保存至資料目錄的 `before-restore-時間戳記.json`，再以單一 SQLite 交易寫入。

- **合併還原**：保留本機所有資料；ID 衝突的文章、解析與收藏建立新 UUID，相關關聯同步更新。本機偏好設定保留。重複匯入同一備份會出現副本，這是明確採用的保留雙方策略。
- **取代還原**：取代全部文章、解析、收藏與偏好設定。需原生確認對話框再次確認。還原後可在設定重新選擇目前帳戶的可用模型。

AI 仍在執行時不允許還原，以避免進行中的結果寫入已更換的資料。

## 本次驗證與限制

- TypeScript 型別檢查、正式建置與核心測試紀錄見 `VERIFICATION.md`。
- Windows Electron 測試涵蓋登入 UI、PKCE、JWT 簽章、訂閱授權、模型清單、串流解析、快取、加密保存、重開、登出，以及既有文章／收藏／備份功能。
- 1.1.1 已通過十六項核心測試，以及打包版的取消、重試、登入、收藏和備份桌面測試。單字與全文解析已經實際服務驗證，實際速度取決於模型、內容及服務狀態。
- Windows x64 NSIS 安裝檔建置成功；未驗證正式簽章、安裝／解除安裝與乾淨機器部署。
- 最終 Windows 解壓版已重跑完整桌面整合測試，Vite 開發模式也已實際驗證新增文章及 IPC。詳見 `VERIFICATION.md`。
- 目前功能範圍為本機原文閱讀、學習收藏及 ChatGPT 訂閱解析。

## 程式結構

```text
electron/main.ts       主程序、受限制 IPC、備份與視窗安全
electron/chatgpt-auth.ts  ChatGPT OAuth、驗證、加密憑證、模型與登出
electron/preload.ts    固定的 renderer API
electron/store.ts      SQLite、交易、備份衝突處理
electron/ai.ts         可替換 AIProvider、OpenAI 真實整合
shared/schema.ts      共用資料結構、Zod 驗證與備份規格
shared/api.ts         IPC 介面型別
src/App.tsx           繁體中文閱讀／收藏／設定畫面
src/styles.css        明暗模式與閱讀版面
tests/store.test.ts    核心資料及 API adapter 測試
tests/chatgpt-auth.test.ts  OAuth、PKCE、JWT、憑證輪替與 SSE 測試
scripts/subscription-smoke.cjs  訂閱版 Electron 桌面整合測試
scripts/run.ps1        Windows Node 24+ 啟動輔助
```

訂閱登入與解析依據 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)、[模型與推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) 及 [預覽限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) 官方文件。Electron 安全設定與憑證儲存依據 [Security](https://www.electronjs.org/docs/latest/tutorial/security) 及 [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 官方文件。
