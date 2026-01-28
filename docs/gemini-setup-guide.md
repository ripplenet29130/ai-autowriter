# Google Gemini API 設定ガイド

このガイドでは、AI WordPress システムでGoogle Gemini APIを使用するための設定方法を説明します。

## 1. Gemini APIキーの取得

### ステップ1: Google AI Studioにアクセス

1. ブラウザで [Google AI Studio](https://makersuite.google.com/app/apikey) にアクセスします
2. Googleアカウントでログインします

### ステップ2: APIキーの作成

1. 「Get API Key」または「APIキーを取得」ボタンをクリック
2. 「Create API key」をクリック
3. 既存のGoogle Cloudプロジェクトを選択するか、新しいプロジェクトを作成
4. APIキーが生成されます（例: `AIzaSyC...` で始まる文字列）
5. **重要**: このAPIキーをコピーして安全な場所に保存してください

## 2. アプリケーションでの設定

### ステップ1: AI設定画面を開く

1. アプリケーションのサイドバーから「AI設定」をクリック

### ステップ2: Geminiプロバイダーを選択

1. 「AIプロバイダー」のドロップダウンから「Google Gemini」を選択
2. 自動的に推奨モデル「Gemini 1.5 Pro」が選択されます

### ステップ3: APIキーを入力

1. 「APIキー」フィールドに、コピーしたGemini APIキーを貼り付け
2. 形式: `AIzaSyC...` で始まる文字列

### ステップ4: モデルを選択

利用可能なモデル:
- **Gemini 1.5 Pro** (推奨): 最も高性能なモデル、複雑な記事生成に最適
  - 内部モデル名: `models/gemini-1.5-pro`
  - APIバージョン: `v1`
- **Gemini 1.5 Flash**: 高速で効率的、シンプルな記事に最適
  - 内部モデル名: `models/gemini-1.5-flash`
  - APIバージョン: `v1`
- **Gemini Pro**: 標準モデル、バランスの取れたパフォーマンス
  - 内部モデル名: `models/gemini-pro`
  - APIバージョン: `v1`

**重要**: Google は `v1beta` エンドポイントを廃止し、現在は `v1` エンドポイントを使用しています。モデル名には必ず `models/` プレフィックスが必要です。

### ステップ5: パラメーターの調整

1. **Temperature (0.0 - 1.0)**
   - 推奨値: `0.7`
   - 低い値 (0.3-0.5): より一貫性のある、予測可能な出力
   - 高い値 (0.8-1.0): より創造的で多様な出力

2. **Max Tokens**
   - 推奨値: `4000`
   - 記事の長さに応じて調整
   - より長い記事には `8000` 以上を設定

### ステップ6: 接続テスト

1. 「接続テスト」ボタンをクリック
2. 成功メッセージが表示されることを確認
   - ✅ 成功: 「Gemini API接続テスト成功！」
   - ❌ エラー: エラーメッセージを確認して修正

### ステップ7: 設定を保存

1. すべての設定を確認
2. 「設定を保存」ボタンをクリック
3. 「AI設定を保存しました」メッセージが表示されることを確認

## 3. トラブルシューティング

### エラー: "API key not valid"

**原因**: APIキーが正しくないか、無効です

**解決方法**:
1. APIキーをコピー時にスペースや改行が含まれていないか確認
2. Google AI Studioで新しいAPIキーを生成
3. APIキーの形式が `AIzaSy` で始まっているか確認

### エラー: "Quota exceeded"

**原因**: APIの使用量制限を超えました

**解決方法**:
1. [Google Cloud Console](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas) でクォータを確認
2. 無料枠の場合: 1分あたり60リクエストまで
3. 有料プランへのアップグレードを検討

### エラー: "Model not found" または "not found for API version v1beta"

**原因**: 古いAPIバージョンまたは誤ったモデル名を使用しています

**解決方法**:
1. モデル名に `models/` プレフィックスが含まれているか確認（正: `models/gemini-1.5-pro`、誤: `gemini-1.5-pro`）
2. APIエンドポイントが `v1` を使用しているか確認（`v1beta` は廃止されました）
3. 設定を保存してページをリロード
4. 「Gemini 1.5 Flash」（`models/gemini-1.5-flash`）に変更してテスト

### エラー: "CORS error"

**原因**: ブラウザのCORSポリシーによるエラー

**解決方法**:
このアプリケーションではクライアント側から直接APIを呼び出すため、CORS エラーが発生する場合があります。通常は問題ありませんが、エラーが続く場合は:
1. ブラウザのコンソールでエラー詳細を確認
2. 別のブラウザで試す
3. シークレットモード/プライベートブラウジングで試す

## 4. API使用量の確認

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. プロジェクトを選択
3. 「APIs & Services」→「Dashboard」
4. 「Generative Language API」を選択
5. 使用量グラフで確認

## 5. 料金について

### 無料枠
- 1分あたり60リクエスト
- 1日あたり1,500リクエスト
- 月あたり100万トークン

### 有料プラン
- Gemini 1.5 Pro: $0.00125 / 1,000文字 (入力)
- Gemini 1.5 Flash: $0.000075 / 1,000文字 (入力)

詳細は [Google AI 価格ページ](https://ai.google.dev/pricing) を参照してください。

## 6. ベストプラクティス

1. **APIキーの管理**
   - APIキーは絶対に公開しない
   - GitHubなどにコミットしない
   - 定期的にローテーション（更新）する

2. **モデルの選択**
   - 日常的な使用: Gemini 1.5 Flash（高速・低コスト）
   - 高品質な記事: Gemini 1.5 Pro（高精度）

3. **パラメーターの最適化**
   - ニュース記事: Temperature 0.5-0.6
   - ブログ記事: Temperature 0.7-0.8
   - クリエイティブな記事: Temperature 0.8-0.9

4. **エラーハンドリング**
   - 接続テストを定期的に実行
   - エラーログを確認
   - クォータ制限に注意

## 7. 参考リンク

- [Google AI Studio](https://makersuite.google.com/)
- [Gemini API ドキュメント](https://ai.google.dev/docs)
- [Gemini API 価格](https://ai.google.dev/pricing)
- [Google Cloud Console](https://console.cloud.google.com/)

## サポート

問題が解決しない場合は、以下を確認してください:
1. ブラウザのコンソールエラー (F12キーで開く)
2. APIキーの有効性
3. インターネット接続
4. Google Cloud プロジェクトのステータス
