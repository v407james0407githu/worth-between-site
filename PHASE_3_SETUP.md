# 第三階段部署設定

第三階段新增診斷摘要、商機分類、診斷後諮詢、成效報表、Token 累積與 API 成本估算。

## 部署前

1. 在 Supabase SQL Editor 再次執行 `supabase/marketing_clinic_phase_1.sql`。
2. 保留第二階段既有的 OpenAI、Supabase 與管理者環境變數。
3. 視需要在 Cloudflare Pages 新增：

- `OPENAI_SUMMARY_MODEL`：摘要與商機分類模型，預設沿用 `OPENAI_MODEL`
- `MARKETING_CLINIC_MAX_OUTPUT_TOKENS`：單輪回答輸出上限，預設 `900`
- `OPENAI_INPUT_COST_PER_MILLION`：模型每百萬輸入 Token 美元價格
- `OPENAI_OUTPUT_COST_PER_MILLION`：模型每百萬輸出 Token 美元價格

未設定成本單價時，系統依模型名稱使用內建估算；模型價格異動時應更新環境變數。

## 品質檢查

```bash
node --test tests/marketing-clinic-quality.mjs
```

上線前另以測試對話確認：

- 無關主題會被簡短拒絕並引導回行銷診斷。
- 資訊不足時會追問，不會虛構數據。
- 完成診斷後會產生主題、摘要、商機分級、分數與下一步。
- 填有姓名、Email、公司／品牌的訪客可將摘要送出成為諮詢紀錄。
- 後台完成率、諮詢轉換率、熱門商機與預估成本會隨紀錄更新。
