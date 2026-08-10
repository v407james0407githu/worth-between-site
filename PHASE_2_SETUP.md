# 第二階段部署設定

第二階段新增 `#/marketing-clinic` 行銷診斷室、OpenAI Responses API 串流對話、Supabase 對話保存、後台瀏覽與 CSV 匯出。

## 必要設定

1. 再次執行 `supabase/marketing_clinic_phase_1.sql`，建立 `chat_rate_limits`。
2. 在 Cloudflare Pages `worth-between-site` 設定：

- Secret `OPENAI_API_KEY`
- Secret `MARKETING_CLINIC_INSTRUCTIONS`：自訂 GPT 的完整私有 Instructions
- Variable `OPENAI_MODEL`：預設為 `gpt-5.4-mini`
- Variable `OPENAI_VECTOR_STORE_ID`：有知識庫時填入 OpenAI Vector Store ID
- Variable `MARKETING_CLINIC_HOURLY_LIMIT`：單一來源每小時訊息上限，預設 `20`
- Variable `MARKETING_CLINIC_MAX_MESSAGE_LENGTH`：單則訊息字數上限，預設 `6000`

既有的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET` 仍為必要設定。

## 功能網址

- 前台：`https://worthbetween.com/#/marketing-clinic`
- 後台：`https://worthbetween.com/#/private-manager`，登入後選擇「行銷診斷室」

## 尚未包含

訪客檔案上傳與知識庫檔案建立需在取得原始自訂 GPT Knowledge 檔案後另行設定。現有 MVP 已可透過 `OPENAI_VECTOR_STORE_ID` 使用預先建立的知識庫。
