-- 以前のポリシーを削除（存在する場合）
DROP POLICY IF EXISTS "Allow authenticated access" ON app_settings;
DROP POLICY IF EXISTS "Allow anon access" ON app_settings;

-- 匿名ユーザー（ログインなし）も含めてフルアクセスを許可するポリシーを作成
-- ※ 注意: アプリケーションにログイン機能がないため、一時的にこの設定にします。
-- 公開環境で使用する場合は、Supabase Authを導入し、authenticatedのみに制限することを強く推奨します。
CREATE POLICY "Allow anon access" ON app_settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
