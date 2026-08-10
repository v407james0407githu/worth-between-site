# 行銷診斷室防護設定

本版已建立多層防護，避免行銷診斷室被當作一般免費聊天服務或遭大量消耗。

## 已實作

- 本機規則先攔截明顯 Prompt Injection、套取系統指令與繞過要求。
- 使用低成本分類模型判斷每則訊息是否屬於行銷診斷範圍。
- 不相關或疑似注入內容不交給主要模型，改用固定拒絕訊息。
- 被攔截訊息、原因與狀態保存至後台；連續攔截預設 3 次後停止該診斷。
- 單一來源每小時訊息限制。
- 姓名、Email 與電話皆為必填，資料保存於診斷工作階段並顯示於後台。
- 電話正規化後以雜湊值計數，同一電話在台灣時間當日最多建立 2 次診斷。
- 單次診斷提問數、單則字數及成本上限。
- 全站每日 API 預算熔斷。
- 可選啟用 Cloudflare Turnstile。
- 摘要已存在時不重複呼叫模型，避免送出諮詢時重複計費。
- 每次分類、AI 回覆與摘要皆記錄模型、輸入 Token、輸出 Token 與預估美元金額；後台可逐筆查看並匯出 CSV。

## 建議 Cloudflare Pages 環境變數

- `OPENAI_CLASSIFIER_MODEL=gpt-5.4-nano`
- `MARKETING_CLINIC_CLASSIFIER_ENABLED=true`
- `MARKETING_CLINIC_HOURLY_LIMIT=20`
- `MARKETING_CLINIC_DAILY_QUESTION_LIMIT=6`：同一電話每日可累計的提問數（每 3 題視為一次診斷）
- `MARKETING_CLINIC_MAX_SESSION_MESSAGES=15`
- `MARKETING_CLINIC_MAX_MESSAGE_LENGTH=1500`
- `MARKETING_CLINIC_MAX_OUTPUT_TOKENS=900`
- `MARKETING_CLINIC_MAX_SESSION_COST_USD=0.15`
- `MARKETING_CLINIC_DAILY_BUDGET_USD=5`
- `MARKETING_CLINIC_AUTO_BLOCK_THRESHOLD=3`

啟用 Turnstile 時另設定：

- Secret `TURNSTILE_SECRET_KEY`
- Variable `TURNSTILE_SITE_KEY`

## 部署前

1. 在 Supabase SQL Editor 再次執行 `supabase/marketing_clinic_phase_1.sql`。
2. 在 Cloudflare Pages 設定上述限制值。
3. 執行 `node --test tests/marketing-clinic-quality.mjs`。
4. 測試正常行銷問題、無關問題、Prompt Injection、超長訊息、超過提問上限與 Turnstile。

分類器採取無法確認時拒絕的策略，以成本與安全為優先。後台可查看誤判紀錄，再調整分類指令或暫時設定 `MARKETING_CLINIC_CLASSIFIER_ENABLED=false`。
