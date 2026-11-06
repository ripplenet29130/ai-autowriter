#!/usr/bin/env node
// WordPress アプリケーションパスワード一括ローテーション
//
// 使い方は docs/wp-app-password-rotation.md を参照。
//   node scripts/rotate-wp-app-passwords.mjs            … 確認のみ（何も変更しない）
//   node scripts/rotate-wp-app-passwords.mjs --apply    … 入れ替えを実行
//
// 流れ（同じユーザー名+パスワードを使う設定はまとめて1回で処理）:
//   1. 今のパスワードで introspect し、古いパスワードの UUID を特定
//   2. 新しいパスワードを発行し、登録されている全URLで認証できるか確認
//   3. wordpress_configs.password を新しい値に更新（古い値と一致する行だけ）
//   4. 全サイトの更新が終わってから古いパスワードを削除し、使えなくなったことを確認
// パスワードの値は画面にもレポートにも出さない。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const HELP = `
WordPress アプリケーションパスワード一括ローテーション

  node scripts/rotate-wp-app-passwords.mjs [オプション]

オプション:
  --apply            実際に入れ替える（指定しない場合は確認だけ）
  --only=ID,ID       対象を wordpress_configs.id で絞る
  --keep-old         古いパスワードを削除しない（後でWP管理画面から手動で削除）
  --label=名前       WordPress側に表示される新パスワードの名前
                     （既定: ai-autowriter YYYY-MM-DD）
  --timeout=ミリ秒   WordPressへのリクエストのタイムアウト（既定: 20000）
  --report=パス      レポートの保存先（既定: .diagnostics/wp-password-rotation-<日時>.json）
  --help             このヘルプ

環境変数（.env があれば自動で読み込み）:
  SUPABASE_URL または VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY または VITE_SUPABASE_SERVICE_KEY
`;

// ---------- 引数・環境変数 ----------

function parseArgs(argv) {
  const opts = { apply: false, only: null, keepOld: false, label: null, timeout: 20000, report: null };
  for (const arg of argv) {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    switch (key) {
      case '--apply': opts.apply = true; break;
      case '--keep-old': opts.keepOld = true; break;
      case '--only': opts.only = value.split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--label': opts.label = value.trim(); break;
      case '--timeout': opts.timeout = Number(value) || opts.timeout; break;
      case '--report': opts.report = value; break;
      case '--help': case '-h': console.log(HELP); process.exit(0); break;
      default:
        console.error(`不明なオプション: ${arg}\n${HELP}`);
        process.exit(2);
    }
  }
  return opts;
}

function loadEnv() {
  if (existsSync('.env') && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile('.env');
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY（サービスロールキー）を環境変数で指定してください。');
    process.exit(2);
  }
  return { url, key };
}

// ---------- WordPress REST API ----------

function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

class WpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function wpRequest(baseUrl, path, { username, password, method = 'GET', body, timeout }) {
  const url = `${normalizeBaseUrl(baseUrl)}/wp-json${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuth(username, password),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'AutomaticWriter-AppPassword-Rotation/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new WpError(isTimeout ? 'タイムアウトしました' : `接続できませんでした (${error?.message ?? error})`, 0, isTimeout ? 'timeout' : 'network_error');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* HTML などが返った場合 */ }
  if (!res.ok) {
    const code = data?.code || `http_${res.status}`;
    const message = data?.message || (data === null ? 'JSONではない応答が返りました（セキュリティプラグインやWAFの可能性）' : `HTTP ${res.status}`);
    throw new WpError(`${message} [${code}]`, res.status, code);
  }
  if (data === null) {
    throw new WpError('JSONではない応答が返りました（セキュリティプラグインやWAFの可能性）', res.status, 'invalid_json');
  }
  return data;
}

const wp = {
  me: (base, creds, timeout) => wpRequest(base, '/wp/v2/users/me?context=edit', { ...creds, timeout }),
  introspect: (base, creds, timeout) => wpRequest(base, '/wp/v2/users/me/application-passwords/introspect', { ...creds, timeout }),
  list: (base, creds, timeout) => wpRequest(base, '/wp/v2/users/me/application-passwords', { ...creds, timeout }),
  create: (base, creds, name, timeout) => wpRequest(base, '/wp/v2/users/me/application-passwords', { ...creds, method: 'POST', body: { name }, timeout }),
  remove: (base, creds, uuid, timeout) => wpRequest(base, `/wp/v2/users/me/application-passwords/${encodeURIComponent(uuid)}`, { ...creds, method: 'DELETE', timeout }),
};

// ---------- Supabase ----------

async function fetchConfigs(supabase, only) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from('wordpress_configs')
      .select('id,name,url,username,password,account_id')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (only) query = query.in('id', only);
    const { data, error } = await query;
    if (error) throw new Error(`wordpress_configs の取得に失敗しました: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// 同じユーザー名+パスワードを使う設定は、同じWordPressのアプリケーションパスワードを
// 共有しているので、まとめて1回だけ入れ替える。
function groupConfigs(rows) {
  const groups = new Map();
  const skipped = [];
  for (const row of rows) {
    if (!row.url || !row.username || !row.password) {
      skipped.push({ ...publicRow(row), reason: 'URL・ユーザー名・パスワードのいずれかが空です' });
      continue;
    }
    const key = `${row.username}\u0000${row.password}`;
    if (!groups.has(key)) groups.set(key, { username: row.username, password: row.password, rows: [] });
    groups.get(key).rows.push(row);
  }
  for (const group of groups.values()) {
    group.urls = [...new Set(group.rows.map((r) => normalizeBaseUrl(r.url)))];
  }
  return { groups: [...groups.values()], skipped };
}

function publicRow(row) {
  return { id: row.id, name: row.name, url: row.url, username: row.username, account_id: row.account_id };
}

function describeAppPassword(item, currentUuid, newUuid) {
  return {
    uuid: item.uuid,
    name: item.name,
    created: item.created ?? null,
    last_used: item.last_used ?? null,
    last_ip: item.last_ip ?? null,
    role: item.uuid === currentUuid ? 'current' : item.uuid === newUuid ? 'new' : 'other',
  };
}

// ---------- 本体 ----------

async function inspectGroup(group, timeout) {
  const creds = { username: group.username, password: group.password };
  const base = group.urls[0];
  const me = await wp.me(base, creds, timeout);

  let list = null;
  let listError = null;
  try {
    list = await wp.list(base, creds, timeout);
  } catch (error) {
    listError = error;
  }

  let current = null;
  let identifiedBy = 'introspect';
  try {
    current = await wp.introspect(base, creds, timeout);
  } catch (error) {
    // サイトによっては introspect が rest_application_password_not_found を返す
    // （認証自体はアプリケーションパスワードで通っている）。その場合、ユーザーの
    // アプリケーションパスワードが1件だけなら、それが今使っているものと確定できる。
    // 削除後に旧パスワードで認証できなくなることを確認するので、誤判定は検出できる。
    if (error.code === 'rest_application_password_not_found' && Array.isArray(list) && list.length === 1) {
      current = { uuid: list[0].uuid, name: list[0].name };
      identifiedBy = 'only_app_password';
    } else if (error.code === 'rest_application_password_not_found' && Array.isArray(list) && list.length > 1) {
      const names = list.map((p) => `「${p.name}」(最終使用 ${p.last_used ?? '未使用'})`).join(', ');
      throw new WpError(`今のパスワードを特定できませんでした。このユーザーにはアプリケーションパスワードが ${list.length} 件あり、どれを使っているか判別できません: ${names}`, error.status, 'introspect_ambiguous');
    } else {
      throw new WpError(`今のパスワードを特定できませんでした（WordPress 5.7未満、またはREST APIの制限）: ${error.message}`, error.status, 'introspect_failed');
    }
  }

  const appPasswords = Array.isArray(list)
    ? list.map((item) => describeAppPassword(item, current.uuid, null))
    : [{ error: `一覧を取得できませんでした: ${listError?.message ?? '不明'}` }];
  return { base, creds, userId: me.id, userName: me.name ?? me.slug ?? null, oldUuid: current.uuid, oldName: current.name, identifiedBy, appPasswords };
}

async function rotateGroup(supabase, group, info, label, timeout) {
  const { base, creds } = info;

  // 2. 新パスワードを発行
  const created = await wp.create(base, creds, label, timeout);
  if (!created?.password || !created?.uuid) {
    throw new WpError('新しいパスワードの発行結果に password/uuid が含まれていません', 0, 'create_invalid');
  }
  const newCreds = { username: group.username, password: created.password };
  const rollback = async (reason) => {
    try {
      await wp.remove(base, creds, created.uuid, timeout);
      return `${reason}（発行した新パスワードは削除済み、旧パスワードのまま）`;
    } catch (error) {
      return `${reason}。さらに新パスワードの削除にも失敗しました。WP管理画面で「${label}」を手動で削除してください: ${error.message}`;
    }
  };

  // 新パスワードで、このグループの全URLにログインできるか確認
  for (const url of group.urls) {
    try {
      const me = await wp.me(url, newCreds, timeout);
      if (me.id !== info.userId) {
        throw new Error(`${url} のユーザーIDが一致しません (${me.id} != ${info.userId})`);
      }
    } catch (error) {
      throw new Error(await rollback(`新パスワードで ${url} に認証できませんでした: ${error.message}`));
    }
  }

  // 3. DBを更新（古いパスワードのままの行だけ）
  const ids = group.rows.map((r) => r.id);
  const { data: updated, error } = await supabase
    .from('wordpress_configs')
    .update({ password: created.password })
    .in('id', ids)
    .eq('password', group.password)
    .select('id');
  if (error) {
    throw new Error(await rollback(`DBの更新に失敗しました: ${error.message}`));
  }
  const updatedIds = new Set((updated ?? []).map((r) => r.id));
  if (updatedIds.size === 0) {
    throw new Error(await rollback('DBの行が更新されませんでした（実行中に別の値へ変更された可能性）'));
  }
  const notUpdated = ids.filter((id) => !updatedIds.has(id));

  // 旧テーブル wp_configs にも同じ値のコピーが残っているので合わせる（失敗しても止めない）
  let legacySynced = true;
  const { error: legacyError } = await supabase
    .from('wp_configs')
    .update({ app_password: created.password })
    .in('id', [...updatedIds]);
  if (legacyError && !/does not exist|could not find|schema cache/i.test(legacyError.message)) {
    legacySynced = false;
  }

  return { newUuid: created.uuid, newCreds, updatedIds: [...updatedIds], notUpdated, legacySynced };
}

async function deleteOld(group, info, rotated, timeout) {
  const base = info.base;
  await wp.remove(base, rotated.newCreds, info.oldUuid, timeout);
  // 旧パスワードで認証できなくなったことを確認
  try {
    await wp.me(base, info.creds, timeout);
    return { deleted: true, verified: false, note: '削除APIは成功しましたが、旧パスワードでまだ認証できます。WP管理画面で確認してください。' };
  } catch (error) {
    if (error.status === 401 || error.status === 403) return { deleted: true, verified: true };
    return { deleted: true, verified: false, note: `旧パスワードの無効化を確認できませんでした: ${error.message}` };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const today = new Date().toISOString().slice(0, 10);
  const label = opts.label || `ai-autowriter ${today}`;
  const supabase = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log(opts.apply ? '== 実行モード: パスワードを入れ替えます ==' : '== 確認モード: 何も変更しません（実行するには --apply） ==');

  const rows = await fetchConfigs(supabase, opts.only);
  const { groups, skipped } = groupConfigs(rows);
  console.log(`WordPress設定 ${rows.length} 件 → 入れ替え対象 ${groups.length} 組（同じパスワードを共有する設定はまとめています）\n`);

  const results = [];
  const pendingDeletes = [];

  for (const [index, group] of groups.entries()) {
    const head = `[${index + 1}/${groups.length}] ${group.rows.map((r) => r.name).join(' / ')} (${group.urls.join(', ')}, ${group.username})`;
    const result = { configs: group.rows.map(publicRow), urls: group.urls, username: group.username, status: 'pending' };
    results.push(result);

    let info;
    try {
      info = await inspectGroup(group, opts.timeout);
      result.wp_user_id = info.userId;
      result.old_uuid = info.oldUuid;
      result.old_name = info.oldName;
      result.old_identified_by = info.identifiedBy;
      result.app_passwords = info.appPasswords;
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      console.log(`✗ ${head}\n    ${error.message}`);
      continue;
    }

    const otherCount = info.appPasswords.filter((p) => p.role === 'other').length;
    const otherNote = (otherCount ? `（このユーザーには他にも ${otherCount} 件のアプリケーションパスワードがあります）` : '')
      + (info.identifiedBy === 'only_app_password' ? '（登録が1件だけのため、それを今のパスワードと判断）' : '');

    if (!opts.apply) {
      result.status = 'ready';
      console.log(`✓ ${head}\n    入れ替え可能。今のパスワード: 「${info.oldName}」${otherNote}`);
      continue;
    }

    try {
      const rotated = await rotateGroup(supabase, group, info, label, opts.timeout);
      result.status = 'rotated';
      result.new_uuid = rotated.newUuid;
      result.updated_config_ids = rotated.updatedIds;
      if (!rotated.legacySynced) result.legacy_wp_configs_note = '旧テーブル wp_configs のコピーは更新できませんでした（認証には使われていません）';
      if (rotated.notUpdated.length) {
        result.not_updated_config_ids = rotated.notUpdated;
        result.warning = '実行中に別の値へ変更された設定があり、更新していません';
      }
      pendingDeletes.push({ group, info, rotated, result });
      console.log(`✓ ${head}\n    新パスワード「${label}」を発行し、DBの ${rotated.updatedIds.length} 件を更新しました${otherNote}`);
      if (rotated.notUpdated.length) console.log(`    ⚠ 未更新: ${rotated.notUpdated.join(', ')}（実行中に変更された可能性）`);
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      console.log(`✗ ${head}\n    ${error.message}`);
    }
  }

  // 4. 全部入れ替えてから古いパスワードを削除（実行中の予約投稿が旧パスワードで失敗しにくいように）
  if (opts.apply && pendingDeletes.length) {
    if (opts.keepOld) {
      console.log('\n--keep-old のため、古いパスワードは削除していません。WP管理画面から手動で削除してください。');
      for (const item of pendingDeletes) item.result.old_deleted = false;
    } else {
      console.log('\n古いパスワードを削除しています…');
      for (const { group, info, rotated, result } of pendingDeletes) {
        const name = group.rows.map((r) => r.name).join(' / ');
        // 同じDB行のうち未更新のものが残っていると、旧パスワードを消すとその行が使えなくなる
        if (rotated.notUpdated.length) {
          result.old_deleted = false;
          result.old_delete_note = '未更新の設定が旧パスワードを使っている可能性があるため、削除を見送りました';
          console.log(`⚠ ${name}: ${result.old_delete_note}`);
          continue;
        }
        try {
          const del = await deleteOld(group, info, rotated, opts.timeout);
          result.old_deleted = del.deleted;
          result.old_revocation_verified = del.verified;
          if (del.note) result.old_delete_note = del.note;
          console.log(`${del.verified ? '✓' : '⚠'} ${name}: 旧パスワード「${info.oldName}」を削除${del.verified ? 'し、使えないことを確認しました' : `しました。${del.note}`}`);
        } catch (error) {
          result.old_deleted = false;
          result.old_delete_note = `削除に失敗しました。WP管理画面で「${info.oldName}」を手動で削除してください: ${error.message}`;
          console.log(`✗ ${name}: ${result.old_delete_note}`);
        }
      }
    }
  }

  // レポート（パスワードの値は含めない）
  const reportPath = opts.report || `.diagnostics/wp-password-rotation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const dir = reportPath.includes('/') ? reportPath.slice(0, reportPath.lastIndexOf('/')) : '';
  if (dir) mkdirSync(dir, { recursive: true });
  const summary = {
    mode: opts.apply ? 'apply' : 'dry-run',
    executed_at: new Date().toISOString(),
    label: opts.apply ? label : null,
    total_configs: rows.length,
    groups: groups.length,
    ready: results.filter((r) => r.status === 'ready').length,
    rotated: results.filter((r) => r.status === 'rotated').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: skipped.length,
  };
  writeFileSync(reportPath, JSON.stringify({ summary, results, skipped }, null, 2));

  console.log('\n== 結果 ==');
  if (opts.apply) {
    console.log(`入れ替え成功: ${summary.rotated} 組 / 失敗: ${summary.failed} 組 / スキップ: ${summary.skipped} 件`);
  } else {
    console.log(`入れ替え可能: ${summary.ready} 組 / 自動では無理: ${summary.failed} 組 / スキップ: ${summary.skipped} 件`);
  }
  for (const s of skipped) console.log(`  スキップ: ${s.name} (${s.id}) — ${s.reason}`);
  console.log(`レポート: ${reportPath}`);
  console.log('（失敗した組は WP管理画面で発行 → アプリの設定画面で貼り替え の手作業で対応してください）');

  process.exitCode = summary.failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
});
