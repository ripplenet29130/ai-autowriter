# WP Config Consolidation Plan

## Summary

本番環境では WordPress 設定テーブルが `wp_configs` と `wordpress_configs` の二重管理になっている。
さらに `schedule_settings` は `wp_config_id` を持っている一方、アプリコードの一部は `wordpress_config_id` を前提にしており、不整合が発生している。

実際に確認できた事実:

- `schedule_settings` に `wordpress_config_id` は存在しない
- `schedule_settings` には `wp_config_id` が存在する
- `wp_configs` と `wordpress_configs` の両方に同一 `id` の行が存在している
- 手動実行と投稿処理は動作している
- WordPress 設定保存時に `wordpress_config_id` 参照で 400 エラーが発生していた

## Goal

以下を満たす状態に整理する。

- WordPress 設定の正本テーブルを 1 つに統一する
- スケジュール設定の外部キー参照を 1 系統に揃える
- フロントエンド、バックエンド、Edge Function の参照先を統一する
- 移行期間中も投稿運用を止めない

## Recommended Canonical Schema

当面の正本は `wp_configs` とする。

理由:

- 本番 `schedule_settings` が `wp_config_id` を使っている
- スケジューラー実行系がこの前提で動いている
- 既存本番運用への影響が最も小さい

最終的に目指す構成:

- `wp_configs`
  - `id`
  - `name`
  - `url`
  - `username`
  - `app_password`
  - `default_category`
  - `post_type`
  - `is_active`
- `schedule_settings.wp_config_id`
  - `wp_configs(id)` のみを参照
- `wordpress_configs`
  - 廃止

## Current Problems

### 1. Column Name Mismatch

本番 DB:

- `schedule_settings.wp_config_id`

一部コード:

- `schedule_settings.wordpress_config_id`

この差により、WordPress 設定保存時に schema cache error が発生する。

### 2. Table Name Split

コードベースに以下の参照が混在している。

- `wp_configs`
- `wordpress_configs`

これにより、更新先と読取先が一致しない可能性がある。

### 3. Dual Foreign Keys

本番 `schedule_settings.wp_config_id` には、`wp_configs(id)` と `wordpress_configs(id)` の両方に対する外部キーが存在している。

これは設計上不自然であり、長期運用では障害要因になる。

## Migration Strategy

段階的に移行する。いきなり DB テーブルを削除しない。

### Phase 1: Stabilize Application Behavior

目的:

- 本番の運用を止めずに不整合エラーを止める

実施内容:

- フロントエンドの `schedule_settings` 保存処理を `wp_config_id` に統一する
- スケジュール設定の列参照を本番スキーマに合わせる
  - `status`
  - `post_time`
  - `related_keywords`
  - `post_status`
- WordPress 設定保存時は、互換性維持のため `wordpress_configs` と `wp_configs` の両方に同期する

状態:

- 実施済み
- 対象ファイル: [src/services/supabaseSchedulerService.ts](C:/Users/syste/OneDrive/デスクトップ/AutomaticWriter-main/src/services/supabaseSchedulerService.ts)

### Phase 2: Audit Remaining References

目的:

- `wordpress_configs` 系の参照を洗い出し、`wp_configs` へ寄せる

主な確認対象:

- [src/services/supabaseSchedulerService.ts](C:/Users/syste/OneDrive/デスクトップ/AutomaticWriter-main/src/services/supabaseSchedulerService.ts)
- [src/services/scheduleService.ts](C:/Users/syste/OneDrive/デスクトップ/AutomaticWriter-main/src/services/scheduleService.ts)
- [src/services/wordPressService.ts](C:/Users\syste\OneDrive\デスクトップ\AutomaticWriter-main\src\services\wordPressService.ts)
- [supabase/functions/scheduler-executor/index.ts](C:/Users/syste/OneDrive/デスクトップ/AutomaticWriter-main/supabase/functions/scheduler-executor/index.ts)

具体的な監査項目:

- `.from('wordpress_configs')`
- `wordpress_config_id`
- `execution_history` の参照先
- join 条件
- 関連型定義

### Phase 3: Switch Reads to Canonical Table

目的:

- 読取側も `wp_configs` を正本として統一する

実施内容:

- `wordpress_configs` を読む箇所を `wp_configs` に変更する
- 必要に応じて `wp_configs` の列名差分を吸収する
  - `password` -> `app_password`
  - `category` -> `default_category`

必要なら中間層で正規化する。

### Phase 4: Clean Up Database Constraints

目的:

- 二重参照をやめ、DB 制約を正規化する

実施内容:

- `schedule_settings.wp_config_id -> wordpress_configs(id)` の外部キーを削除
- `schedule_settings.wp_config_id -> wp_configs(id)` のみを残す
- `schedule_settings` の参照整合性を再確認する

実施前に必ず確認すること:

- 全ての `schedule_settings.wp_config_id` が `wp_configs.id` に存在する
- アプリコード上で `wordpress_configs` 参照が残っていない

### Phase 5: Remove Compatibility Sync

目的:

- 二重書き込みをやめる

実施内容:

- `supabaseSchedulerService.saveWordPressConfig()` の `wp_configs` 同期以外の互換処理を削除
- `wordpress_configs` への書き込みを停止する

### Phase 6: Retire `wordpress_configs`

目的:

- 旧テーブルを廃止する

実施内容:

- 必要ならバックアップを取得
- `wordpress_configs` を削除、または read-only view に置き換える

## Risks

### High Risk

- 外部キー削除やテーブル削除を先に行うこと
- 実行系がまだ `wordpress_configs` を読んでいる状態で同期を止めること

### Medium Risk

- `wp_configs` と `wordpress_configs` の列差分を吸収せずに読取先を切り替えること
- `execution_history` や関連 join の参照先を見落とすこと

### Low Risk

- 互換期間中に二重書き込みを残すこと

## Validation Checklist

各フェーズ後に以下を確認する。

### Functional Checks

- WordPress 設定の新規作成
- WordPress 設定の更新
- WordPress 設定の削除
- スケジュール設定の保存
- 手動実行
- 定期実行
- 投稿成功
- 実行履歴の表示

### Database Checks

- `schedule_settings.wp_config_id` が正しく保存される
- `wp_configs` に最新値が反映される
- 互換期間中は `wordpress_configs` にも反映される
- 外部キー違反が発生しない

### Logging Checks

- Supabase Edge Function `scheduler-executor` で DB query failure が出ない
- `schema cache` 系エラーが再発しない

## Suggested SQL Checks

### Current Reference Integrity

```sql
select
  s.id as schedule_id,
  s.wp_config_id,
  exists(select 1 from public.wp_configs w where w.id = s.wp_config_id) as exists_in_wp_configs,
  exists(select 1 from public.wordpress_configs wc where wc.id = s.wp_config_id) as exists_in_wordpress_configs
from public.schedule_settings s
order by s.created_at desc;
```

### Table Column Audit

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('wp_configs', 'wordpress_configs', 'schedule_settings')
order by table_name, ordinal_position;
```

### Foreign Key Audit

```sql
select
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name = 'schedule_settings';
```

## Implementation Notes

- 互換レイヤを残す期間は短くする
- 先にアプリを安定化させ、その後 DB を整理する
- 旧テーブル削除は最後に行う
- 本番変更前に SQL バックアップを取得する

## Next Action

次に着手する作業:

1. コードベース全体の `wordpress_configs` / `wordpress_config_id` 参照棚卸し
2. 実行系の読取先を `wp_configs` 基準へ統一
3. 本番 DB の外部キー整理計画を作成
4. 段階的に `wordpress_configs` を廃止
