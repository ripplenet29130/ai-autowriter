# AutomaticWriter 外販化ドキュメント一式

このフォルダは、AutomaticWriter をクライアント向けに外販する際に必要な計画書、確認資料、テスト資料、提出補助資料をまとめたものです。

## 収録ドキュメント

### 計画・方針

- [01_AutomaticWriter_Renovation_Plan.md](./01_AutomaticWriter_Renovation_Plan.md)
  - 改修方針、優先順位、実装対象の整理

### 外販前確認

- [02_AutomaticWriter_Externalization_Checklist.md](./02_AutomaticWriter_Externalization_Checklist.md)
  - 外販前の全体チェックリスト

### テスト資料

- [03_AutomaticWriter_Test_Procedures.md](./03_AutomaticWriter_Test_Procedures.md)
  - 各機能ごとの詳細テスト手順
- [04_Manual_Test_Checksheet.md](./04_Manual_Test_Checksheet.md)
  - 実施記録用の手動テストチェックシート
- [05_UAT_Checklist.md](./05_UAT_Checklist.md)
  - クライアント受け入れ確認用の項目書

### 運用・障害対応

- [06_Bug_Report_Template.md](./06_Bug_Report_Template.md)
  - 不具合報告テンプレート
- [08_Monorepo_Implementation_Plan.md](./08_Monorepo_Implementation_Plan.md)
  - 親子構造・monorepo 化の実装計画
- [09_Monorepo_Migration_Detailed_Design.md](./09_Monorepo_Migration_Detailed_Design.md)
  - 現行コードからの移行詳細設計
- [10_Externalization_Startup_TODO.md](./10_Externalization_Startup_TODO.md)
  - どこから着手するかの実行順 TODO
- [11_Client_Specific_Configuration_Matrix.md](./11_Client_Specific_Configuration_Matrix.md)
  - クライアント固有値の棚卸し表

### 補助金・提案資料

- [07_AutomaticWriter_Subsidy_Specification.md](./07_AutomaticWriter_Subsidy_Specification.md)
  - 補助金申請・説明用の整理版仕様書

## 推奨利用順

1. `01` を読んで改修方針を確認
2. `02` で外販前に必要な全体項目を確認
3. `03` と `04` を使って内部テストを実施
4. `05` を使ってクライアント受け入れ確認を実施
5. 問題があれば `06` で起票
6. 親子構造化は `08` を参照して進める
7. 実際の切り出し順は `09` を参照して進める
8. 着手順管理は `10` を使う
9. 差分設計は `11` を先に埋める
10. 提案・説明・申請時は `07` を利用

## 備考

- 元の `docs/` 直下にあるドキュメントは残しています。
- このフォルダは、外販化関連だけをまとめて参照しやすくする目的の整理版です。
