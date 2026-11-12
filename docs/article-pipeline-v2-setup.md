# 新方式（v2）を動かすための準備

作成日: 2026-11-11（2026-11-12 更新: 広い調査＋1回で書き切る書き方、役割ごとの AI）
仕様: `article-pipeline-v2-spec-2026-11-11.md`

新方式は、記事作成を工程ごとに分けて実行する Edge Function `article-pipeline` で動く。
今の標準は「広い調査＋1回で書き切る」（仕様書 4.2）で、調査・執筆・修正は Gemini、ファクトチェックは ChatGPT（仕様書 4.3）。
本番で動かすには、次の 6 つを行う。

## 1. マイグレーションを適用する

| ファイル | 内容 |
|---|---|
| `supabase/migrations/20261111090000_add_length_mode_to_schedule_settings.sql` | スケジュールの文字数の決め方（段階 1） |
| `supabase/migrations/20261111120000_article_pipeline_v2.sql` | ジョブと工程のテーブル、ジョブを取り出す関数、スケジュールの「使う方式」の列 |

```bash
npx supabase db push
```

## 2. Edge Function をデプロイする

`article-pipeline` を新しくデプロイする。あわせて、今回直したものも再デプロイする。

```bash
npx supabase functions deploy article-pipeline
```

```bash
npx supabase functions deploy scheduler-executor
```

```bash
npx supabase functions deploy review-wordpress-publish
```

```bash
npx supabase functions deploy ai-proxy
```

- `article-pipeline`: 新方式の本体（広い調査・1回で書き切る・役割ごとの AI・ChatGPT のファクトチェック）
- `scheduler-executor`: 段階 1・2 の変更、表の崩れの修正、新方式への引き継ぎ、文の途中で終わる行を見出しにしない修正
- `review-wordpress-publish`・`ai-proxy`: 共通部品（表・リンクの整形）を使っているため、合わせて再デプロイする

## 3. 毎分の定期実行を追加する

`article-pipeline` は、工程が終わるたびに自分自身を呼んで次の工程に進む。
呼び出しに失敗したり、実行が途中で止まったりしたときのために、毎分の定期実行でも進める。

SQL Editor で次を実行する（`YOUR_PROJECT_REF` を置き換える）。
サービスロールキーは Vault に `service_role_key` という名前で入れておく（SQL に直接書かない）。

```sql
-- Vault にキーを入れる（1 回だけ）
select vault.create_secret('ここにサービスロールキー', 'service_role_key');

-- 毎分の定期実行
select cron.schedule(
  'article-pipeline-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/article-pipeline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"action":"tick"}'::jsonb
  );
  $$
);
```

止めるとき:

```sql
select cron.unschedule('article-pipeline-tick');
```

## 4. 画面を公開する

AI 設定の「役割ごとの AI」と、スケジュールの「記事の作り方」（新方式を選ぶ欄）は画面側の変更なので、`main` を GitHub に push して Netlify で公開する。

## 5. AI 設定で OpenAI の API キーを保存する

ファクトチェックの標準は ChatGPT（GPT-5.4）。AI 設定の OpenAI に API キーを保存する（「このAIを使用する」で有効にする必要はない）。
キーがない場合は Gemini でファクトチェックを行い、通知に「Gemini で行いました」と出る。
「役割ごとの AI」で、調査・執筆・ファクトチェック・修正に使う AI を選び直せる。選択はジョブを作った時点のものが使われる。

## 6. 環境変数（任意）

Edge Function の環境変数で変えられる。設定しなければ既定値で動く。

| 名前 | 既定 | 内容 |
|---|---|---|
| `ARTICLE_PIPELINE_ALLOW_PUBLISH` | （なし） | `true` にしたときだけ「公開」で投稿できる。テスト期間中は設定しない（常に下書き） |
| `ARTICLE_PIPELINE_WHOLE_WRITING_MAX_CHARS` | 4500 | これを超える文字数の記事は、記事全体を一度に書かず見出しごとに順番に書く |
| `AUTO_LENGTH_MAX_CHARS` | 6000 | 文字数おまかせの上限 |
| `WRITER_THINKING_BUDGET` | 4096 | 執筆の思考の上限 |
| `REVIEW_THINKING_BUDGET` | 8192 | 批評・書き直しの思考の上限 |
| `GEMINI_MAX_PARALLEL` | 2 | ファクトチェックを Gemini で行うときの検索の並列数（ChatGPT・Claude では 5 組を同時に確かめる） |

`APP_URL` など、今の `scheduler-executor` と共通の設定はそのまま使われる。

## 使い方

- **画面から試す**: 管理画面の「新方式（テスト）」タブで、キーワード・Gemini の AI 設定・投稿先を選んで「作成開始」を押す。工程の進み具合・本文の版・ファクトチェックの結果が見られる（管理者のみ）。
- **手動作成**: お客さんの手動作成の画面は、まだ以前の方式のまま（新方式への対応は次の段階）。
- **スケジュールで使う**: スケジュール設定の「記事の作り方」で「新方式・テスト中」を選ぶ。キーワードやタイトルの選び方は今の方式と同じで、選んだあとの記事作成を新方式に引き継ぐ。実行履歴は新方式が最後まで進んだときに「成功／失敗」になる。

## 動きの確認（デプロイ前）

`experiments/pipeline-compare` で、新方式の工程そのものをこの PC の上で動かせる（DB・WordPress・通知は使わない）。

```bash
npx -y deno@2.9.6 run --allow-net --allow-env --allow-read --allow-write --env-file=experiments/pipeline-compare/.env experiments/pipeline-compare/run.ts "相続税 申告期限" --flow pipeline --article-only
```

工程ごとの時間が比較ページの「工程ごとの時間」に出る。120 秒を超えた工程があれば「注意」に出る。

## 今の版でまだないもの

- 手動作成の画面からの新方式（今は自動投稿と管理画面のテストだけ）
- 新方式で作った記事のレビュー依頼（Chatwork のレビュー用リンク）。結果の通知は送る
- 画像の生成
- 本文の版の差分表示（版ごとに切り替えて見ることはできる）

## 気をつけること

- 記事 1 本は約 6〜7 分・約 220 円（ファクトチェックを ChatGPT で行う場合。全部 Gemini なら約 4 分・約 70 円）。
- スケジュールから引き継いだジョブが 12 分以上かかると、今の自動投稿の「止まった実行を失敗にする」処理が、実行履歴を一度「失敗」にする。ジョブが最後まで進めば「成功」に上書きされる。
- 工程が失敗すると、30 秒待ってから毎分の定期実行がやり直す。同じ工程で 3 回失敗するとジョブは「失敗」になり、通知が届く。画面の「失敗した工程からやり直す」で再開できる。
