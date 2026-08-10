# 第一階段部署設定

第一階段將管理者登入與站台資料寫入移到 Cloudflare Pages Functions，並撤銷 Supabase 匿名寫入權限。

## Cloudflare Pages Secrets

正式部署前，在 `worth-between-site` Pages 專案設定以下加密 Secrets，並在 **Custom domains** 綁定正式網址 `worthbetween.com`：

- `ADMIN_EMAIL`：管理者登入 Email
- `ADMIN_PASSWORD`：管理者登入密碼，請使用新的強密碼
- `ADMIN_SESSION_SECRET`：至少 32 bytes 的隨機值
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SITE_ASSETS_BUCKET`：選填，圖片上傳用 Storage bucket 名稱，未設定時使用 `site-assets`

不要把這些值寫入 Git、HTML 或一般環境變數。

## Supabase Migration

以 Supabase Dashboard SQL Editor 執行：

1. `supabase/site_state.sql`
2. `supabase/marketing_clinic_phase_1.sql`

第二支 migration 會：

- 撤銷 `site_state` 的匿名新增、修改與刪除權限
- 建立 `contact_inquiries`
- 建立 `chat_sessions`、`chat_messages`、`chat_files`
- 建立 `admin_audit_logs`
- 啟用 RLS 並撤銷匿名與一般登入者直接存取

網站資料與未來行銷診斷室資料只透過持有 Supabase service-role secret 的 Pages Functions 存取。

後台選擇圖片後會先由瀏覽器壓縮成 WebP 作為預覽，按下儲存時再透過 `/api/admin-image` 上傳到 Supabase Storage。Function 會自動檢查並建立 public bucket，預設 bucket 為 `site-assets`；站台設定只保存 Storage 公開 URL，因此所有裝置都會讀到同一張更新後的圖片。
