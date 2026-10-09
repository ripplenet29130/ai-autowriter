import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const source = readFileSync(new URL('../src/services/articleSearch.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { buildArticleSearchFilter } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

assert.equal(buildArticleSearchFilter('　 \t '), undefined);
assert.equal(buildArticleSearchFilter('東京　旅行 東京'), 'and(or(title.ilike."%東京%",content.ilike."%東京%"),or(title.ilike."%旅行%",content.ilike."%旅行%"))');

// 実際のSDKを通し、投稿状態と検索条件の両方が送信されることを確認する。
let requestUrl;
const client = createClient('https://example.supabase.co', 'test-key', {
  auth: { persistSession: false },
  global: { fetch: async (url) => {
    requestUrl = new URL(url);
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  } },
});
await client.from('articles').select('*').or(buildArticleSearchFilter('東京 旅行', 'published'));
const condition = requestUrl.searchParams.get('or');
assert.ok(condition.includes('is_published.eq.true'));
assert.ok(condition.includes('title.ilike."%東京%"'));
assert.ok(condition.includes('content.ilike."%旅行%"'));
assert.ok(buildArticleSearchFilter('東京', 'unpublished').includes('or(is_published.is.null,is_published.eq.false)'));
assert.ok(buildArticleSearchFilter('リフォーム', 'unpublished').includes('or(wordpress_post_id.is.null,wordpress_post_id.eq."")'));
assert.ok(buildArticleSearchFilter('リフォーム', 'published').includes('and(wordpress_post_id.not.is.null,wordpress_post_id.neq."")'));
const reformFilter = buildArticleSearchFilter('リフォーム');
const reformPattern = JSON.parse(reformFilter.match(/title\.ilike\.("[^"\\]*")/)[1]);
const reformTitle = '全館空調の後付けリフォームで公開しない！デメリットの対策と相談先選び';
assert.ok(reformTitle.includes(reformPattern.slice(1, -1)));
await client.from('articles').select('*').eq('wordpress_config_id', 'company-site-id').or(reformFilter);
assert.equal(requestUrl.searchParams.get('wordpress_config_id'), 'eq.company-site-id');
assert.ok(requestUrl.searchParams.get('or').includes('title.ilike."%リフォーム%"'));
await client.from('articles').select('*').is('wordpress_config_id', null).or(reformFilter);
assert.equal(requestUrl.searchParams.get('wordpress_config_id'), 'is.null');

// カンマ・括弧・引用符を値として囲み、LIKEのワイルドカードをエスケープする。
const special = buildArticleSearchFilter('50%_割引,(限定)"');
const quotedPattern = special.match(/title\.ilike\.("(?:\\.|[^"\\])*")/)[1];
assert.equal(JSON.parse(quotedPattern), '%50\\%\\_割引,(限定)"%');
console.log('Article search checks passed');
