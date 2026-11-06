#!/usr/bin/env node
// 読み取り専用: 登録されている全WordPressサイトについて、全ユーザーのアプリケーションパスワードを一覧にする。
// WordPress側・DB側とも何も変更しない。パスワードの値は表示しない（WordPressも一覧では返さない）。
//
//   node scripts/audit-wp-app-passwords.mjs [--stale-days=90] [--report=パス]
//
// アプリが使っているユーザーが管理者権限を持つサイトでは全ユーザー分、
// 持たないサイトでは自分のユーザー分だけを表示する。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const opts = { staleDays: 90, report: null, timeout: 20000 };
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.split('=');
  const value = rest.join('=');
  if (key === '--stale-days') opts.staleDays = Number(value) || opts.staleDays;
  else if (key === '--report') opts.report = value;
  else if (key === '--timeout') opts.timeout = Number(value) || opts.timeout;
  else { console.error(`不明なオプション: ${arg}`); process.exit(2); }
}

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY（サービスロールキー）を環境変数で指定してください。');
  process.exit(2);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });

const normalizeBaseUrl = (url) => String(url ?? '').trim().replace(/\/+$/, '');

async function wpGet(base, path, { username, password }) {
  let res;
  try {
    res = await fetch(`${normalizeBaseUrl(base)}/wp-json${path}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`,
        Accept: 'application/json',
        'User-Agent': 'AutomaticWriter-AppPassword-Audit/1.0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'TimeoutError' ? 'タイムアウトしました' : `接続できませんでした (${error?.message ?? error})` };
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* JSON以外 */ }
  if (!res.ok || body === null) {
    const message = body?.message || (body === null ? 'JSONではない応答（セキュリティプラグインやWAFの可能性）' : `HTTP ${res.status}`);
    return { ok: false, status: res.status, code: body?.code, error: `${message}${body?.code ? ` [${body.code}]` : ''}` };
  }
  return { ok: true, status: res.status, body, totalPages: Number(res.headers.get('x-wp-totalpages') || 1) };
}

function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`); // WPはGMTをタイムゾーンなしで返す
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

function formatDate(iso) {
  return iso ? iso.slice(0, 10) : '未使用';
}

async function auditSite(base, configs) {
  // そのサイトに登録されている設定（ユーザー）を順に試し、管理者権限のあるものを優先する
  const appUsers = [];
  let adminCreds = null;
  let lastError = null;
  for (const cfg of configs) {
    const creds = { username: cfg.username, password: cfg.password };
    const me = await wpGet(base, '/wp/v2/users/me?context=edit', creds);
    if (!me.ok) { lastError = me.error; continue; }
    appUsers.push({ id: me.body.id, username: cfg.username, creds });
    if (!adminCreds && me.body.capabilities?.list_users && me.body.capabilities?.edit_users) adminCreds = creds;
  }
  if (!appUsers.length) return { error: lastError ?? 'ログインできませんでした' };

  const appUserIds = new Set(appUsers.map((u) => u.id));
  let users;
  let scope;
  if (adminCreds) {
    users = [];
    for (let page = 1; ; page += 1) {
      const res = await wpGet(base, `/wp/v2/users?context=edit&per_page=100&page=${page}`, adminCreds);
      if (!res.ok) { users = null; break; }
      users.push(...res.body);
      if (page >= res.totalPages) break;
    }
    scope = 'all';
  }
  if (!users) {
    users = [];
    for (const u of appUsers) {
      const res = await wpGet(base, '/wp/v2/users/me?context=edit', u.creds);
      if (res.ok) users.push(res.body);
    }
    scope = 'self';
  }

  const result = [];
  for (const user of users) {
    const creds = appUserIds.has(user.id)
      ? appUsers.find((u) => u.id === user.id).creds
      : adminCreds;
    const path = appUserIds.has(user.id) ? '/wp/v2/users/me/application-passwords' : `/wp/v2/users/${user.id}/application-passwords`;
    const res = await wpGet(base, path, creds);
    result.push({
      id: user.id,
      username: user.username ?? user.slug,
      name: user.name,
      roles: user.roles ?? [],
      is_app_user: appUserIds.has(user.id),
      app_passwords: res.ok
        ? res.body.map((p) => ({ uuid: p.uuid, name: p.name, created: p.created ?? null, last_used: p.last_used ?? null, last_ip: p.last_ip ?? null }))
        : null,
      error: res.ok ? undefined : res.error,
    });
  }
  return { scope, users: result };
}

// ---------- 本体 ----------

const { data: rows, error } = await supabase
  .from('wordpress_configs')
  .select('id,name,url,username,password')
  .order('created_at', { ascending: true });
if (error) { console.error(`wordpress_configs の取得に失敗しました: ${error.message}`); process.exit(1); }

const sites = new Map();
for (const row of rows) {
  if (!row.url || !row.username || !row.password) continue;
  const base = normalizeBaseUrl(row.url).toLowerCase();
  if (!sites.has(base)) sites.set(base, { base: normalizeBaseUrl(row.url), names: [], configs: [] });
  const site = sites.get(base);
  site.names.push(row.name);
  if (!site.configs.some((c) => c.username === row.username && c.password === row.password)) site.configs.push(row);
}

console.log(`== アプリケーションパスワード棚卸し（読み取りのみ） ==\nサイト ${sites.size} 件 / ${opts.staleDays}日以上使われていないものを「要確認」と表示します\n`);

const report = [];
const candidates = [];
let index = 0;
for (const site of sites.values()) {
  index += 1;
  const label = `[${index}/${sites.size}] ${[...new Set(site.names)].join(' / ')} (${site.base})`;
  const audit = await auditSite(site.base, site.configs);
  report.push({ site: site.base, names: [...new Set(site.names)], ...audit });

  if (audit.error) {
    console.log(`✗ ${label}\n    確認できませんでした: ${audit.error}`);
    continue;
  }
  console.log(`■ ${label}${audit.scope === 'self' ? '\n    ※管理者権限がないため、アプリのユーザー分だけ表示' : ''}`);
  const withPasswords = audit.users.filter((u) => u.error || (u.app_passwords && u.app_passwords.length));
  if (!withPasswords.length) console.log('    アプリケーションパスワードなし');
  for (const user of withPasswords) {
    const tag = user.is_app_user ? '（アプリが使用中のユーザー）' : '';
    console.log(`    ユーザー ${user.username} [${user.roles.join(',')}]${tag}`);
    if (user.error) { console.log(`      一覧を取得できませんでした: ${user.error}`); continue; }
    for (const p of user.app_passwords) {
      // 未使用のものは作成日から数える（作ったばかりのものを候補にしない）
      const days = ageDays(p.last_used ?? p.created);
      const stale = days === null || days >= opts.staleDays;
      const mark = stale ? '要確認' : '使用中';
      console.log(`      ${stale ? '⚠' : '・'} 「${p.name}」 作成 ${formatDate(p.created)} / 最終使用 ${formatDate(p.last_used)}${p.last_ip ? ` (${p.last_ip})` : ''} … ${mark}`);
      if (stale) candidates.push({ site: site.base, user: user.username, name: p.name, last_used: p.last_used, is_app_user: user.is_app_user });
    }
  }
}

const reportPath = opts.report || `.diagnostics/wp-app-password-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const dir = reportPath.includes('/') ? reportPath.slice(0, reportPath.lastIndexOf('/')) : '';
if (dir) mkdirSync(dir, { recursive: true });
writeFileSync(reportPath, JSON.stringify({ executed_at: new Date().toISOString(), stale_days: opts.staleDays, sites: report, candidates }, null, 2));

console.log(`\n== ${opts.staleDays}日以上使われていない（削除候補） ${candidates.length} 件 ==`);
for (const c of candidates) console.log(`  ${c.site}  ${c.user}  「${c.name}」  最終使用 ${formatDate(c.last_used)}`);
console.log(`\nレポート: ${reportPath}`);
console.log('（このスクリプトは何も削除しません。不要なものはWP管理画面のユーザー → プロフィールから取り消してください）');
