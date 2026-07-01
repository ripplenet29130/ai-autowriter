# Google Gemini API 設定ガイド

このガイドでは、AutomaticWriterでGoogle Gemini APIを使用するための設定方法を説明します。

## 1. APIキーを取得する

1. [Google AI Studio](https://aistudio.google.com/app/apikey)を開きます。
2. Googleアカウントでログインします。
3. 「Create API key」からAPIキーを作成します。
4. 発行されたキーを安全な場所に保存します。

APIキーは公開リポジトリやチャットへ貼り付けないでください。

## 2. AutomaticWriterへ登録する

1. サイドバーから「AI設定」を開きます。
2. プロバイダーで「Google Gemini」を選択します。
3. APIキーを入力します。
4. モデルを選択します。
5. 「接続テスト」を実行します。
6. 成功を確認して設定を保存します。

## 3. 選択できるモデル

| モデル | 用途 | 注意点 |
|---|---|---|
| `gemini-3.5-flash` | 通常の記事生成 | 安定版。既定モデル |
| `gemini-3.1-pro-preview` | 複雑で高品質な生成 | プレビュー版。仕様変更や終了告知に注意 |
| `gemini-3.1-flash-lite` | 低コスト・大量処理 | 複雑な推論より速度と費用を優先 |

通常は`gemini-3.5-flash`を使用してください。モデル名に`models/`プレフィックスを付ける必要はありません。

## 4. 接続エラーを確認する

### `API key not valid`

- APIキーの前後に空白や改行がないか確認します。
- Google AI Studioでキーが有効か確認します。
- 必要に応じて新しいキーを発行します。

### `Quota exceeded`

- [Google AI Studio](https://aistudio.google.com/)またはGoogle Cloud Consoleで利用量と請求設定を確認します。
- 無料枠やレート制限は変更されるため、現在の上限を公式画面で確認してください。

### `Model not found`

- AI設定で現行モデルを選び直します。
- 保存後にページを再読み込みし、接続テストをやり直します。
- スケジュール固有のモデル上書きがある場合は、スケジュール設定側も確認します。

## 5. 料金とモデル終了情報

料金や提供状況は変更されます。固定値をこのガイドへ転記せず、実行前に公式ページを確認してください。

- [Gemini API モデル一覧](https://ai.google.dev/gemini-api/docs/models)
- [Gemini API 料金](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API モデル終了情報](https://ai.google.dev/gemini-api/docs/deprecations)

## 6. 運用上の注意

- 接続テストに成功してからアクティブ設定へ切り替えます。
- プレビュー版は本番の唯一のモデルにしないことを推奨します。
- 定期的にモデル終了情報を確認します。
- APIキーは定期的にローテーションします。
