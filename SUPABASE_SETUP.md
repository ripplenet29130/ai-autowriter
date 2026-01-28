# Supabase Edge Functions セットアップガイド

このガイドでは、検索機能のタイムアウト問題を解決するために作成したSupabase Edge Functionsのセットアップ方法を説明します。

## 前提条件

- Supabaseプロジェクトが作成済み
- Supabase CLIがインストール済み（未インストールの場合は以下で install）

```powershell
npm install -g supabase
```

## 1. Supabase CLIでログイン

```powershell
supabase login
```

ブラウザが開き、認証が完了します。

## 2. プロジェクトをリンク

```powershell
cd "c:\Users\syste\OneDrive\デスクトップ\AutomaticWriter-main"
supabase link --project-ref <あなたのプロジェクトID>
```

プロジェクトIDは、SupabaseダッシュボードのProject Settings > General > Reference IDで確認できます。

## 3. 環境変数の設定

以下のコマンドでSupabase Edge Functions用の環境変数（シークレット）を設定します：

```powershell
# Google Custom Search API設定
supabase secrets set GOOGLE_CUSTOM_SEARCH_API_KEY=ここにあなたのAPIキー

supabase secrets set GOOGLE_CUSTOM_SEARCH_ENGINE_ID=ここにあなたの検索エンジンID

# SerpAPI設定（オプション：トレンド分析で使用）
supabase secrets set SERPAPI_KEY=ここにあなたのSerpAPIキー
```

### 環境変数の取得方法

#### Google Custom Search API
1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. APIとサービス > 認証情報 > APIキーを作成
3. Custom Search APIを有効化
4. [Programmable Search Engine](https://programmablesearchengine.google.com/)で検索エンジンを作成
5. 検索エンジンIDをコピー

#### SerpAPI（オプション）
1. [SerpAPI](https://serpapi.com/)でアカウント作成
2. ダッシュボードからAPIキーをコピー

## 4. Edge Functionsのデプロイ

```powershell
# 競合検索関数をデプロイ
supabase functions deploy competitor-search

# トレンド分析関数をデプロイ
supabase functions deploy trend-analysis
```

デプロイが成功すると、以下のようなURLが表示されます：
- `https://<your-project-ref>.supabase.co/functions/v1/competitor-search`
- `https://<your-project-ref>.supabase.co/functions/v1/trend-analysis`

## 5. フロントエンド側の環境変数設定

プロジェクトルートに `.env` ファイルを作成（または既存を編集）：

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_SUPABASE_SERVICE_KEY=<your-service-key>
```

### Supabase認証情報の取得
1. Supabaseダッシュボード > Project Settings > API
2. Project URL → `VITE_SUPABASE_URL`
3. anon public → `VITE_SUPABASE_ANON_KEY`
4. service_role → `VITE_SUPABASE_SERVICE_KEY`

## 6. 動作確認

### Edge Functionsのテスト

```powershell
# ローカルでテスト（オプション）
supabase functions serve competitor-search

# 本番環境でテスト
curl -X POST \
  "https://<your-project-ref>.supabase.co/functions/v1/competitor-search" \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"keyword": "AI技術", "limit": 5}'
```

成功すると、以下のようなJSONレスポンスが返ります：
```json
{
  "topArticles": [...],
  "averageLength": 3500,
  "commonTopics": [...]
}
```

### アプリケーションのテスト

1. `npm run dev` でアプリケーションを起動
2. トレンド分析ページに移動
3. 任意のキーワードで検索を実行
4. **5件以上の競合記事が表示されることを確認**

## 7. ログの確認

デプロイ後、Edge Functionsのログを確認できます：

```powershell
supabase functions logs competitor-search
```

またはSupabaseダッシュボード > Edge Functions > Logsで確認できます。

## トラブルシューティング

### エラー: "API設定が不完全です"
→ 環境変数が正しく設定されていません。Step 3を再確認してください。

### エラー: "検索APIエラー: 403"
→ Google Custom Search APIのクォータ超過または認証情報が無効です。Google Cloud Consoleで確認してください。

### タイムアウトが発生する
→ Google Custom Search APIのレスポンスが遅い可能性があります。Edge Functionsは150秒まで実行可能なので、通常は問題ありません。

### 環境変数を確認する

```powershell
supabase secrets list
```

## 料金について

- **Supabase Edge Functions**: 無料枠 500,000リクエスト/月
- **Google Custom Search API**: 無料枠 100リクエスト/日（超過後は$5/1000リクエスト）
- **SerpAPI**: 無料枠 100リクエスト/月

## 次のステップ

✅ Edge Functionsのデプロイ完了
✅ 環境変数の設定完了
✅ フロントエンド側の修正完了

これで、検索機能が5件以上の結果を取得できるようになりました！

タイムアウト問題が解決したら、次はフェーズ1（型安全性の向上）に進むことをお勧めします。
