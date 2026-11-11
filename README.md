# 北科圖書館座位預約｜GitHub Pages + Supabase

這是依 `NTUT-library-main(1).zip` 原始介面改寫的獨立預約系統。前端為原生 HTML、CSS、JavaScript，直接上傳即可發布，**不用 npm、不用 Vite、不用建置**。預約與權限由 Supabase 資料庫實際處理，不使用假登入或模擬占位。

本專案尚未連接北科正式校務系統或實體報到機，不會在校方現有系統建立預約。樓層／座位目錄沿用原始設計（B1、2F，各 A/B/C 區、每區 16 席），並非經實地核實的館方資料。公開使用前，請由場域管理者確認配置、開放時段與使用規則。

## 一、交付內容

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網站入口，必須放在 GitHub Pages 發布目錄的根層 |
| `styles.css` | 原生 CSS，灰白與深色按鈕風格、手機版面規則 |
| `app.js` | 頁面、預約、Auth、Realtime 與錯誤處理 |
| `config.js` | 僅兩個空欄位：Supabase URL 與 Publishable Key |
| `setup.sql` | 座位目錄、預約、RLS、RPC、Trigger、Realtime publication |
| `vendor/supabase.js` | 已附 Supabase JS 2.49.8 瀏覽器 SDK，不依賴線上 CDN |
| `vendor/SUPABASE-LICENSE.txt` | SDK 授權 |
| `assets/favicon.svg` | 網站圖示 |
| `assets/original-wireframe.png` | 保留原 ZIP 的圖片素材，供設計參照；原程式未將它用作頁面背景 |
| `.nojekyll` | GitHub Pages 靜態發布設定 |
| `VERIFICATION.md` | 本機驗證結果及仍需實際部署測試的項目 |

不需要 Edge Functions。需要後端權限的操作已由 PostgreSQL RPC 處理，沒有 `supabase/functions/` 空殼檔案，也不需要 Gemini、reCAPTCHA、Turnstile 或其他服務金鑰。

## 二、先建立 Supabase 專案

1. 開啟 <https://supabase.com/dashboard>，登入並建立一個新的專案。
2. 設定專案名稱、資料庫密碼、區域，等待專案建立完成。資料庫密碼**不需要**填入網站。
3. 建議使用新的專案。本 SQL 以 `ntut_` 作為資料表前綴，可重複執行；不會刪除既有預約。它不是任意舊版本資料表的升級工具。
4. 不必提供專案管理權限給網站使用者。

## 三、用網頁執行 setup.sql

1. 解壓下載的新 ZIP，用文字編輯器開啟 `setup.sql`，全選並複製。
2. 在 Supabase 左側開啟 **SQL Editor → New query**。
3. 貼上整份 SQL，以預設的 `postgres` 管理角色按 **Run**。
4. 確認沒有紅色錯誤。SQL 以交易執行，錯誤時應先修正再重跑完整檔案。
5. 到 **Table Editor** 確認有以下四張表：
   - `ntut_zones`：6 筆區域設定。
   - `ntut_seats`：96 筆座位設定。
   - `ntut_reservations`：初始應為 **0 筆**。
   - `ntut_changes`：1 筆更新計數。
6. SQL 已將 `ntut_changes` 加入 `supabase_realtime`。若即時通知不工作，到 Database 的 Publications／Replication 設定，確認此表已啟用。**不要為了顯示空位而公開 `ntut_reservations`。**

若收到 `permission denied to create extension`，請確認是專案管理者在 SQL Editor 執行，而非用網站的公開金鑰執行。

## 四、設定帳號：不增加任何服務金鑰

### 建議首次驗收：由專案管理者建立帳號

這條路不需要郵件寄送或新增 SMTP 服務，能實際登入、預約及取消。

1. 到 **Authentication → Sign In / Providers**（或同義的 Providers／設定頁），啟用 Email/password 登入。
2. 若只供指定使用者測試，關閉 **Allow new users to sign up**，避免任意註冊。
3. 到 **Authentication → Users → Add user → Create new user**。
4. 輸入使用者的電子郵件與一組新密碼（至少 8 字元），選擇 **Auto Confirm User**／自動確認。不要選擇會寄信的 Invite user。
5. 建立兩個不同帳號供驗收。登入網址、帳號與密碼由管理者另行交付給本人。
6. 網站上的「註冊」會遵守專案設定；關閉註冊時會顯示請聯絡管理者，不會偽造帳號。

### 若要讓使用者自行註冊

開啟 Allow new users to sign up 後，前端的註冊功能使用真正的 Supabase Auth `signUp`。保留 Confirm email 時必須完成郵件驗證。

**Supabase 內建寄信服務並非無限制寄信服務**：預設通常只寄給該 Supabase 組織的團隊成員，且有很低的寄信配額。因此，未額外設定寄信服務時，對一般使用者的驗證信與忘記密碼信可能被拒絕。本專案遵照「不新增額外金鑰服務」的要求，未加入其他寄信供應商。請先使用上面的管理者建帳流程。

若自行關閉 Confirm email，註冊可直接得到登入 session，但**不代表電子郵件所有權或學生身份已驗證**；不應把這種設定當作校園身份驗證。公開使用前須決定適合場域的帳號管理方式。

忘記密碼已實作 `resetPasswordForEmail` 及信件返回後的 `updateUser`，但寄信仍受上述限制。若無法收信，請聯絡專案管理者處理帳號，不要將 Supabase 管理金鑰放進前端。

## 五、用 GitHub 網頁上傳檔案

1. 在 GitHub 開啟你要發布的儲存庫，例如 `bbdaisy46-hash/NTUT-library`。
2. 建議先建立一個新的儲存庫，或備份現有版本。若沿用舊專案，移除原本的 React/Vite 入口與舊建置發布設定，避免舊網站被重新部署覆蓋。
3. 選擇 **Add file → Upload files**。
4. 上傳解壓後的內容，包含 `assets` 與 `vendor` 資料夾。**不要只上傳 ZIP，也不要將整個網站再包在一層新資料夾內。**
5. 確認 GitHub 的 Code 首頁直接看得到 `index.html`、`app.js`、`config.js` 等檔案，然後 Commit changes。

## 六、用 GitHub 網頁填寫 config.js

1. 在 Supabase 的 **Connect** 視窗或 **Project Settings → API Keys** 找到 **Publishable key**（格式以 `sb_publishable_` 開頭）。
2. 在 Connect 或 Project Settings 的 Data API／API 區找到 **Project URL**，例如 `https://專案識別碼.supabase.co`。
3. 這兩個值必須來自**同一個專案**。
4. 在 GitHub 點開 `config.js`，按鉛筆圖示 Edit this file，填入兩個雙引號內：

```javascript
window.APP_CONFIG = Object.freeze({
  SUPABASE_URL: "https://你的專案識別碼.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_你的公開金鑰"
});
```

5. 保留引號與逗號，按 Commit changes。
6. 本版只接受 Publishable Key。不要使用資料庫密碼、`sb_secret_...` 或 `service_role`。Publishable Key 放在公開網站屬預期用法；資料保護依賴 RLS 與 RPC 的伺服器端驗證。

空白設定時，首頁可顯示，但查詢、登入與預約會提示尚未設定，不顯示假的空位。

## 七、開啟 GitHub Pages

1. 在儲存庫開啟 **Settings → Pages**。
2. Build and deployment 的 Source 選擇 **Deploy from a branch**。
3. Branch 選 **main**，目錄選 **/(root)**，按 Save。
4. 等待 GitHub 完成發布，開啟 Pages 顯示的網址。以你的儲存庫為例：
   `https://bbdaisy46-hash.github.io/NTUT-library/`
5. 若看見舊內容，確認 Pages 的來源分支，等待部署完成後強制重新整理。
6. 本站使用 `./` 相對路徑與 `#` 頁面導航，例如 `.../NTUT-library/#my-reservations`，不用設定 SPA rewrite 或 404 轉址。

若 GitHub 沒有提供 Pages 選項，請檢查該儲存庫的可見性及帳號方案是否支援 Pages；最簡單的首次測試可用公開儲存庫。**不要在公開儲存庫放私密金鑰。**

## 八、設定 Auth 返回網址

1. 回到 Supabase → **Authentication → URL Configuration**。
2. **Site URL** 設成完整的 Pages 網址，例如：
   `https://bbdaisy46-hash.github.io/NTUT-library/`
3. **Redirect URLs** 加入相同網址（包含專案路徑與最後的 `/`）。若另用 `index.html` 網址，可一併加入該完整網址。
4. 儲存。前端會以網站所在目錄作為註冊／忘記密碼的返回網址。
5. 使用 Email Templates 的預設驗證連結即可；若曾自行改模板，確認仍使用 Supabase 的確認網址。

不需要部署任何 Edge Function，也不用在 GitHub 設定任何 secret。

## 九、主要功能驗收

### A. 基本預約流程

1. 開啟首頁 → 查看座位。
2. 切換 B1／2F 與 A／B／C 區；空位數應來自資料庫，初始沒有預約時所有啟用座位皆可選。
3. 下一步選擇明天、10:00–12:00。日期範圍為今天至未來 30 天；時間皆為臺灣時間。
4. 選擇 A01 → 下一步 → 登入帳號 A → 勾選使用規則 → 確認預約。
5. 應出現預約成功與 UUID 編號；到 Supabase Table Editor 應看到新紀錄。
6. 重整網站、再次登入或換一台裝置，仍可在「我的預約」查看該筆資料。
7. 取消後紀錄顯示「已取消」，其他使用者可重新預約該座位。

### B. 兩個帳號與重複訂位

1. 正常視窗登入 A，無痕視窗登入 B。
2. A 建立一筆未來預約，B 查詢相同日期／時段時應看到該座位不可選。
3. B 的「我的預約」不得看見 A 的預約編號、電子郵件或個人紀錄。
4. 兩個帳號先選取同一座位，再幾乎同時送出。只能一筆成功；另一筆應收到衝突訊息。資料庫排他約束是最後防線。
5. 同一帳號選擇不同座位但重疊時段，也必須被拒絕。
6. 同一帳號先預約 4 小時，再預約不重疊的 3 小時，第二筆應被拒絕；4+2 小時可成功。

### C. 報到、逾時與離席

1. 預約下一個整點起始時段。
2. 距離開始超過 15 分鐘時，報到按鈕不開放；直接呼叫 RPC 也會被拒絕。
3. 開始前 15 分鐘至開始後 15 分鐘內可「網頁報到」，狀態改為已報到。
4. 已報到後可按「提前離席」，座位釋出，狀態為已結束。原預約時數仍計入每日上限，避免反覆提前離席繞過額度。
5. 未報到且超過開始後 15 分鐘，該筆不再占位。紀錄的 expired 狀態於下一次個人查詢或建立預約時寫入。沒有瀏覽器開啟時，資料表可能暫時仍顯示 upcoming，但查詢可用座位與建立新預約仍依伺服器時間正確判斷。
6. 網頁只允許預約尚未開始的整點，因此逾時釋出後，其他人可預約後續尚未開始的時段。

### D. 即時更新與錯誤狀態

1. 開兩個瀏覽器視窗。A 新增／取消預約後，B 的空位應更新；底部應顯示即時更新已連線。
2. 若 WebSocket 被網路阻擋，系統仍每 30 秒查詢資料；切回視窗亦重新同步。
3. 為避免打斷鍵盤操作，背景更新時若焦點仍在主要表單／按鈕，畫面重繪會延後；可按重新整理或切換步驟。送出預約始終由資料庫重新檢查。
4. 斷網或錯誤的 URL／Key 應顯示錯誤，不能假裝成功；恢復網路後重新整理。
5. 用手機檢查導覽、日期選擇、座位圖與彈窗，確認沒有水平溢出或無法按到的按鈕。

## 十、權限與資料結構

| 物件 | 匿名訪客 | 已登入使用者 | 管理者 |
| --- | --- | --- | --- |
| zones / seats | 讀取配置 | 讀取配置 | Supabase Dashboard 編輯 |
| reservations | 無法直接讀寫 | RLS 僅可讀自己的紀錄，不能直接新增／修改／刪除 | Dashboard 查看 |
| availability RPC | 只查詢座位占用時段 | 同左 | 同左 |
| book / change RPC | 禁止 | 驗證 auth.uid、時間與本人所有權後操作 | 不需要前端管理員角色 |
| changes | 讀取更新計數 | 同左 | Trigger 自動更新 |

RPC 對應前端名稱完全一致：

- `ntut_availability(p_date)`：傳回 seat_id、start_hour、end_hour，不傳回使用者資訊。
- `ntut_book(p_seat_id,p_date,p_start,p_end)`：新增預約。
- `ntut_my_reservations()`：查詢本人預約，並更新逾時狀態。
- `ntut_change_reservation(p_id,p_action)`：`cancel`、`check-in`、`finish`。

`ntut_expire`、`ntut_notify_change` 是內部函式，不開放 API 使用者呼叫。SECURITY DEFINER 函式固定 search_path 並限定 execute 權限。預約建立以使用者 advisory lock 保護每日額度，兩個 exclusion constraints 保護座位與使用者的重疊時段。

原版沒有管理後台。本版亦未加上只靠前端隱藏的管理按鈕。座位停用請由有權限的專案管理者在 Table Editor 將 `ntut_seats.enabled` 改為 false；這只阻擋新預約，不自動取消已成立紀錄。原始固定 4×4 配置延續；若擴增樓層或營業政策，需一併修改 SQL 驗證及前端選項。

## 十一、與原始專案的差異

| 原版 | 改寫後 |
| --- | --- |
| React、TypeScript、Vite、Tailwind、Lucide | 原生 HTML／CSS／JS；用文字／簡單符號取代圖示套件，版型與流程延續 |
| 固定 2026 年 11 月日期 | 依臺灣時間動態開放今天至 30 天後 |
| 任意學號與非空密碼即可假登入 | 真正 Supabase Email/password Auth；不宣稱校園 SSO 驗證 |
| localStorage 儲存預約與模擬使用者 | 預約存 PostgreSQL；Supabase SDK 僅保留登入 session |
| 雜湊製造占位，A02/A07 永遠不可選 | 全部占用皆由有效預約計算，無預填假預約 |
| 可在前端直接改狀態 | 後端 RPC 驗證本人、時間窗口與狀態轉移 |
| 規則寫有單日 6 小時但未強制 | 資料庫真正檢查累計上限與重疊 |
| 「刷卡報到」實際只是改前端狀態 | 誠實標示「網頁報到」，不驗證實際到館；新增離席與逾時狀態 |
| 無跨裝置同步 | Database + Realtime 訊號 + 30 秒同步校正 |
| package.json 包含 Gemini／Express，但沒有對應實際服務呼叫 | 移除未使用套件與環境變數，不需要 AI API 或 Node.js 伺服器 |

原始首頁、樓層區域、日期時段、座位圖、確認、完成、我的預約、登入與規則彈窗皆已重建。灰白背景、深色主按鈕、卡片、步驟條、4×4 座位圖與不可用座位斜紋保留。字型改為系統中文字型，不依賴 Google Fonts；不是逐像素複製。

原始登入的姓名／科系是假資料，故移除。本版用帳號電子郵件辨識使用者，不新增未經驗證的學生個資。

## 十二、驗證範圍與常見問題

請看 `VERIFICATION.md`。本機 SQL 測試與 DOM 操作測試不等同已在你的 Supabase 專案上線；尚未取得你填寫的公開設定，因此實際 Auth、郵件、Realtime、Pages 發布及多人同時請求仍須依上述步驟驗收。

- **看到「尚未設定 Supabase」**：檢查 config.js 兩個欄位、引號、Publishable Key 前綴，並重新整理。
- **Could not find function／relation does not exist**：確認完整 SQL 已在同一專案執行；等待 schema cache 更新後重試。
- **登入成功但不能預約**：查看畫面錯誤，可能是已過時間、超過 6 小時、重疊、座位停用或未同意規則。
- **已成功送出卻遇到網路錯誤**：先到「我的預約」確認，再決定是否重送；若原請求已成立，資料庫會阻擋重複預約。
- **收不到驗證／重設信**：先看第四節的內建寄信限制及 Authentication Logs。管理者建帳流程不依賴寄信。
- **沒有即時通知**：確認 `ntut_changes` 在 publication、Realtime 已啟用、網路允許 WebSocket。輪詢仍可用。
- **開啟 ZIP 裡的 HTML 無法登入**：請發布到 HTTPS 的 GitHub Pages 後測試，勿用 `file://` 當作驗收環境。
- **SQL 重跑會把座位改回去嗎**：目錄使用 ON CONFLICT DO NOTHING，不覆寫既有配置；政策／函式會更新成此檔版本。

## 官方參考資料

- Supabase 公開金鑰：<https://supabase.com/docs/guides/getting-started/api-keys>
- Supabase RLS：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Auth 返回網址：<https://supabase.com/docs/guides/auth/redirect-urls>
- Auth 內建寄信限制：<https://supabase.com/docs/guides/auth/auth-smtp>
- Realtime Postgres Changes：<https://supabase.com/docs/guides/realtime/postgres-changes>
- GitHub Pages 發布來源：<https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>
