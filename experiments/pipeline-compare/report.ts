// 比較ページ（1 つの HTML ファイル）を作る
import { USD_TO_JPY } from '../../src/shared/aiUsage.ts';
import type { FactCheckResult } from '../../src/shared/factCheckCore.ts';
import { estimateOpenAiUsd, type OpenAiUsage } from './lib/openai.ts';
import { QUALITY_CRITERIA, type QualityScore } from './lib/judge.ts';
import type { VerifyOutcome } from './lib/verify.ts';
import type { FlowName, FlowResult } from './lib/types.ts';
import type { KeywordComparison } from './run.ts';

const FLOWS: FlowName[] = ['current', 'v2'];
const FLOW_LABEL: Record<FlowName, string> = { current: '今の流れ', v2: '新しい流れ' };
const VERDICT_LABEL: Record<string, string> = {
  correct: '正しい',
  partially_correct: '一部誤り',
  incorrect: '誤り',
  unverified: '確認できず',
};
const RATING_LABEL: Record<string, string> = { ok: '問題なし', needs_review: '要確認', reject: '公開不可' };

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isOk = <T>(v: T | { error: string } | undefined | null): v is T => Boolean(v) && !(v as any).error;

function countVerdicts(results: FactCheckResult[]) {
  const c = { correct: 0, partially_correct: 0, incorrect: 0, unverified: 0 };
  for (const r of results) c[r.verdict] = (c[r.verdict] || 0) + 1;
  return c;
}

function flowCostJpy(flow: FlowResult): { jpy: number; note: string } {
  const gemini = flow.usage.gemini?.total_estimated_jpy ?? 0;
  let note = '';
  let openaiJpy = 0;
  if (flow.usage.openai) {
    const usd = estimateOpenAiUsd(flow.usage.openai);
    if (usd === null) note = 'OpenAI 分は単価未設定のため含まない';
    else openaiJpy = Math.round(usd * USD_TO_JPY);
  }
  if (flow.usage.serpapiCalls > 0) note = [note, `検索 API ${flow.usage.serpapiCalls}回分は含まない`].filter(Boolean).join('・');
  return { jpy: gemini + openaiJpy, note };
}

function tokens(u: OpenAiUsage | null): string {
  if (!u) return '—';
  return `${u.calls}回・入力${u.inputTokens.toLocaleString()}・出力${u.outputTokens.toLocaleString()}・検索${u.webSearchCalls}回`;
}

function geminiTokens(flow: FlowResult): string {
  const g = flow.usage.gemini;
  if (!g) return '—';
  const calls = g.models.reduce((s, m) => s + m.calls, 0);
  const input = g.models.reduce((s, m) => s + m.input_tokens, 0);
  const output = g.models.reduce((s, m) => s + m.output_tokens + m.thoughts_tokens, 0);
  return `${calls}回・入力${input.toLocaleString()}・出力${output.toLocaleString()}・検索${g.grounded_requests}回`;
}

function headingCount(content: string) {
  return {
    h2: (content.match(/^##\s/gm) || []).length,
    h3: (content.match(/^###\s/gm) || []).length,
  };
}

function charCount(content: string): number {
  return content.replace(/^#+\s.*$/gm, '').replace(/\s+/g, '').length;
}

function renderSummary(c: KeywordComparison): string {
  const pair = c.judge?.pairwise;
  let headline = '採点なし';
  let tone = 'neutral';
  if (isOk(pair)) {
    headline = pair.winner === 'tie' ? '引き分け' : `${FLOW_LABEL[pair.winner]}の方が良い`;
    tone = pair.winner === 'v2' ? 'good' : pair.winner === 'current' ? 'warn' : 'neutral';
  } else if (pair) headline = `比較に失敗: ${esc((pair as any).error)}`;

  const cards = FLOWS.map((name) => {
    const flow = c.flows[name];
    if (!flow) return '';
    if (!isOk<FlowResult>(flow)) {
      return `<div class="card"><h3>${FLOW_LABEL[name]}</h3><p class="bad">失敗: ${esc((flow as any).error)}</p></div>`;
    }
    const v = c.judge?.verify[name];
    const q = c.judge?.quality[name];
    const counts = isOk<VerifyOutcome>(v) ? countVerdicts(v.results) : null;
    const cost = flowCostJpy(flow);
    return `<div class="card">
      <h3>${FLOW_LABEL[name]}</h3>
      <dl>
        <dt>第三者チェックでの誤り</dt><dd>${counts ? `<b class="${counts.incorrect ? 'bad' : ''}">誤り ${counts.incorrect}</b>・一部誤り ${counts.partially_correct}・確認できず ${counts.unverified}（${(v as VerifyOutcome).results.length}件中）` : '—'}</dd>
        <dt>第三者の総合評価</dt><dd>${isOk<VerifyOutcome>(v) ? esc(RATING_LABEL[v.overall.rating] || v.overall.rating) : '—'}</dd>
        <dt>質の採点（5点満点）</dt><dd>${isOk<QualityScore>(q) ? `<b>${q.average.toFixed(2)}</b>` : '—'}</dd>
        <dt>かかった時間</dt><dd>${(flow.totalMs / 1000).toFixed(0)}秒</dd>
        <dt>費用の目安</dt><dd>約${cost.jpy.toLocaleString()}円${cost.note ? `<br><small>${esc(cost.note)}</small>` : ''}</dd>
        <dt>本番なら</dt><dd>${flow.draftReasons.length ? `<span class="warnText">下書き</span><br><small>${flow.draftReasons.map(esc).join('<br>')}</small>` : '公開できる状態'}</dd>
      </dl>
    </div>`;
  }).join('');

  return `<div class="verdict ${tone}"><div class="verdict-label">ChatGPT による並べ比べ</div><div class="verdict-main">${esc(headline)}</div>${isOk(pair) ? `<p>${esc(pair.reason)}</p>` : ''}</div>
  <div class="cards">${cards}</div>`;
}

function renderComparisonTable(c: KeywordComparison): string {
  const flows = FLOWS.map((n) => c.flows[n]).map((f) => (isOk<FlowResult>(f) ? f : null));
  const row = (label: string, fn: (f: FlowResult) => string) =>
    `<tr><th>${label}</th>${flows.map((f) => `<td>${f ? fn(f) : '—'}</td>`).join('')}</tr>`;
  return `<table class="cmp"><thead><tr><th></th>${FLOWS.map((n) => `<th>${FLOW_LABEL[n]}</th>`).join('')}</tr></thead><tbody>
    ${row('タイトル', (f) => esc(f.title))}
    ${row('文字数・見出し', (f) => { const h = headingCount(f.content); return `${charCount(f.content).toLocaleString()}字・H2 ${h.h2}・H3 ${h.h3}`; })}
    ${row('調査の方法', (f) => f.name === 'current' ? (f.research ? `${esc(f.research.source || 'SerpAPI')}（上位${f.research.articles?.length ?? 0}件のページを取得）` : '競合調査なし') : `Gemini 検索（上位${f.research?.competitors?.length ?? 0}件を AI が読む）`)}
    ${row('競合の見出し数', (f) => String(f.competitorHeadings.length))}
    ${row('関連キーワード', (f) => esc(f.relatedKeywords.join('、')) || '—')}
    ${row('根拠メモ', (f) => f.factSheet ? `事実${f.factSheet.facts.length}件・出典${f.factSheet.sources.length}件` : `なし（${esc(f.factSheetNote)}）`)}
    ${row('参考資料', (f) => `${f.referencesCount}件`)}
    ${row('執筆モデル', (f) => esc(f.writerModel))}
    ${row('見直し', (f) => esc(f.editorialReview))}
    ${row('流れの中の検証', (f) => `${esc(f.factCheck.verifier)}<br><small>${f.factCheck.executed ? `${f.factCheck.results.length}件・${f.factCheck.rounds}回確認・自動修正${f.factCheck.autoFixApplied ? 'あり' : 'なし'}` : esc(f.factCheck.note || '未実行')}</small>`)}
    ${row('時間切れで省略した工程', (f) => esc(f.skippedSteps.join('、')) || 'なし')}
    ${row('Gemini の利用', (f) => geminiTokens(f))}
    ${row('OpenAI の利用', (f) => tokens(f.usage.openai))}
    ${row('注意', (f) => [...f.notes, ...f.warnings].map(esc).join('<br>') || '—')}
  </tbody></table>`;
}

function renderQuality(c: KeywordComparison): string {
  if (!c.judge) return '';
  const qs = FLOWS.map((n) => c.judge!.quality[n]);
  const rows = QUALITY_CRITERIA.map((crit) =>
    `<tr><th>${crit.label}</th>${qs.map((q) => `<td>${isOk<QualityScore>(q) ? bar(q.scores[crit.key]) : '—'}</td>`).join('')}</tr>`).join('');
  const notes = qs.map((q) => isOk<QualityScore>(q)
    ? `<td><b>良い点</b><ul>${q.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><b>改善点</b><ul>${q.weaknesses.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></td>`
    : `<td>${q ? `失敗: ${esc((q as any).error)}` : '—'}</td>`).join('');
  return `<table class="cmp"><thead><tr><th></th>${FLOWS.map((n) => `<th>${FLOW_LABEL[n]}</th>`).join('')}</tr></thead>
    <tbody>${rows}<tr><th>コメント</th>${notes}</tr></tbody></table>`;
}

function bar(score: number): string {
  return `<span class="bar"><span style="width:${score * 20}%"></span></span> ${score}`;
}

function renderFactResults(results: FactCheckResult[]): string {
  if (!results.length) return '<p class="muted">確認した主張はありません</p>';
  const order: Record<string, number> = { incorrect: 0, partially_correct: 1, unverified: 2, correct: 3 };
  return `<table class="facts"><thead><tr><th>判定</th><th>主張</th><th>説明</th></tr></thead><tbody>${[...results]
    .sort((a, b) => order[a.verdict] - order[b.verdict])
    .map((r) => `<tr><td><span class="pill ${r.verdict}">${VERDICT_LABEL[r.verdict]}</span><br><small>${r.confidence}%</small></td>
      <td>${esc(r.claim)}${r.correctInfo ? `<div class="correct">正: ${esc(r.correctInfo)}</div>` : ''}</td>
      <td>${esc(r.explanation)}${r.sourceUrl ? `<br><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">出典</a>` : ''}</td></tr>`)
    .join('')}</tbody></table>`;
}

function renderJudgeVerify(c: KeywordComparison): string {
  if (!c.judge) return '<p class="muted">採点は行っていません</p>';
  return `<div class="cols">${FLOWS.map((n) => {
    const v = c.judge!.verify[n];
    return `<div><h4>${FLOW_LABEL[n]}</h4>${isOk<VerifyOutcome>(v)
      ? `<p><b>${esc(RATING_LABEL[v.overall.rating])}</b>: ${esc(v.overall.summary)}</p>${renderFactResults(v.results)}`
      : v ? `<p class="bad">失敗: ${esc((v as any).error)}</p>` : '—'}</div>`;
  }).join('')}</div>`;
}

function renderArticles(c: KeywordComparison, idx: number): string {
  return `<div class="cols">${FLOWS.map((n) => {
    const f = c.flows[n];
    if (!isOk<FlowResult>(f)) return `<div><h4>${FLOW_LABEL[n]}</h4>—</div>`;
    return `<div><h4>${FLOW_LABEL[n]}</h4><article class="md" data-md="md-${idx}-${n}"><h1>${esc(f.title)}</h1></article>
      <textarea hidden id="md-${idx}-${n}">${esc(f.content)}</textarea></div>`;
  }).join('')}</div>`;
}

function renderSteps(c: KeywordComparison): string {
  return `<div class="cols">${FLOWS.map((n) => {
    const f = c.flows[n];
    if (!isOk<FlowResult>(f)) return '<div>—</div>';
    const max = Math.max(1, ...f.steps.map((s) => s.ms));
    return `<div><h4>${FLOW_LABEL[n]}（合計 ${(f.totalMs / 1000).toFixed(0)}秒）</h4><table class="steps">${f.steps.map((s) =>
      `<tr><td>${esc(s.name)}</td><td class="num">${(s.ms / 1000).toFixed(1)}秒</td><td><span class="bar"><span style="width:${(s.ms / max) * 100}%"></span></span></td></tr>${s.note ? `<tr><td colspan="3" class="note">${esc(s.note)}</td></tr>` : ''}`).join('')}</table></div>`;
  }).join('')}</div>`;
}

function renderResearch(c: KeywordComparison): string {
  return `<div class="cols">${FLOWS.map((n) => {
    const f = c.flows[n];
    if (!isOk<FlowResult>(f)) return '<div>—</div>';
    const r = f.research;
    let researchHtml = '<p class="muted">なし</p>';
    if (n === 'current' && r?.articles) {
      researchHtml = r.articles.map((a: any) => `<div class="comp"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><ul>${(a.headings || []).map((h: string) => `<li>${esc(h)}</li>`).join('')}</ul></div>`).join('');
    } else if (n === 'v2' && r) {
      researchHtml = `<p><b>検索意図:</b> ${esc(r.searchIntent)}</p>
        <p><b>読者の疑問:</b></p><ul>${(r.readerQuestions || []).map((q: string) => `<li>${esc(q)}</li>`).join('')}</ul>
        <p><b>上位記事に足りない点:</b></p><ul>${(r.gaps || []).map((q: string) => `<li>${esc(q)}</li>`).join('')}</ul>
        <p><b>AI が読んだ上位記事:</b></p>${(r.competitors || []).map((a: any) => `<div class="comp"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a><ul>${(a.headings || []).map((h: string) => `<li>${esc(h)}</li>`).join('')}</ul></div>`).join('')}
        <p><b>検索した語句:</b> ${esc((r.searchQueries || []).join('、'))}</p>`;
    }
    const sheet = f.factSheet;
    const factsHtml = sheet
      ? `<ol class="factlist">${sheet.facts.map((fact: any) => `<li>${esc(fact.statement)}${fact.asOf ? ` <small>（${esc(fact.asOf)}時点）</small>` : ''}</li>`).join('')}</ol>
         <p><b>出典</b></p><ul>${sheet.sources.map((s: any) => `<li><a href="${esc(s.url || s.redirectUrl)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul>`
      : `<p class="muted">なし（${esc(f.factSheetNote)}）</p>`;
    return `<div><h4>${FLOW_LABEL[n]}</h4>${researchHtml}<h5>根拠メモ</h5>${factsHtml}</div>`;
  }).join('')}</div>`;
}

function renderPipelineChecks(c: KeywordComparison): string {
  return `<div class="cols">${FLOWS.map((n) => {
    const f = c.flows[n];
    if (!isOk<FlowResult>(f)) return '<div>—</div>';
    return `<div><h4>${FLOW_LABEL[n]}: ${esc(f.factCheck.verifier)}</h4>${f.factCheck.overall ? `<p><b>${esc(RATING_LABEL[f.factCheck.overall.rating] || f.factCheck.overall.rating)}</b>: ${esc(f.factCheck.overall.summary)}</p>` : ''}${renderFactResults(f.factCheck.results)}</div>`;
  }).join('')}</div>`;
}

export function buildReportHtml(comparisons: KeywordComparison[]): string {
  const created = new Date().toLocaleString('ja-JP');
  const sections = comparisons.map((c, i) => `
  <section class="kw" id="kw-${i}">
    <h2>${esc(c.keyword)}</h2>
    ${renderSummary(c)}
    <h3>比べた項目</h3>
    ${renderComparisonTable(c)}
    <h3>質の採点（ChatGPT・項目別）</h3>
    ${renderQuality(c)}
    <details open><summary>第三者チェック：同じ ChatGPT で両方の記事を同じ条件で確認した結果</summary>${renderJudgeVerify(c)}</details>
    <details><summary>記事を並べて読む</summary>${renderArticles(c, i)}</details>
    <details><summary>工程ごとの時間</summary>${renderSteps(c)}</details>
    <details><summary>調査結果と根拠メモ</summary>${renderResearch(c)}</details>
    <details><summary>それぞれの流れの中で行った検証</summary>${renderPipelineChecks(c)}</details>
  </section>`).join('');

  const nav = comparisons.length > 1
    ? `<nav>${comparisons.map((c, i) => `<a href="#kw-${i}">${esc(c.keyword)}</a>`).join('')}</nav>`
    : '';

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>記事作成の比較</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--text:#1f2328;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--good:#15803d;--goodBg:#ecfdf3;--warn:#b45309;--warnBg:#fff7ed;--bad:#b91c1c;--badBg:#fef2f2;--neutralBg:#f1f5f9}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#111315;--panel:#1a1d21;--text:#e6e6e6;--muted:#9aa1a9;--line:#2c3036;--accent:#7aa2ff;--good:#4ade80;--goodBg:#13261b;--warn:#fbbf24;--warnBg:#2a2112;--bad:#f87171;--badBg:#2a1515;--neutralBg:#1f242a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:12px;border-top:2px solid var(--line)}h3{font-size:16px;margin:28px 0 8px}h4{margin:0 0 8px}
.muted,small{color:var(--muted)}a{color:var(--accent)}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}nav a{padding:4px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;background:var(--panel)}
.verdict{border-radius:10px;padding:16px;border:1px solid var(--line);background:var(--neutralBg)}.verdict.good{background:var(--goodBg)}.verdict.warn{background:var(--warnBg)}
.verdict-label{font-size:12px;color:var(--muted)}.verdict-main{font-size:20px;font-weight:700}.verdict p{margin:6px 0 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}.card h3{margin:0 0 8px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--muted);font-size:13px}dd{margin:0}
.bad{color:var(--bad)}.warnText{color:var(--warn);font-weight:600}
table{border-collapse:collapse;width:100%;background:var(--panel)}th,td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
.cmp th:first-child{width:180px;color:var(--muted);font-weight:500}
.table-wrap{overflow-x:auto}
.bar{display:inline-block;width:80px;height:8px;background:var(--line);border-radius:4px;vertical-align:middle}.bar span{display:block;height:100%;background:var(--accent);border-radius:4px}
details{margin-top:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px}summary{cursor:pointer;font-weight:600}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}@media (max-width:800px){.cols{grid-template-columns:1fr}}
.cols>div{min-width:0}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;white-space:nowrap}.pill.correct{background:var(--goodBg);color:var(--good)}.pill.partially_correct,.pill.unverified{background:var(--warnBg);color:var(--warn)}.pill.incorrect{background:var(--badBg);color:var(--bad)}
.facts td{font-size:13px}.correct{margin-top:4px;color:var(--good);font-size:12px}
.steps td{font-size:13px;border:none;border-bottom:1px solid var(--line)}.steps .num{white-space:nowrap;text-align:right}.steps .note{color:var(--muted);font-size:12px;padding-top:0}
.md{font-size:14px;max-height:80vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px}.md h1{font-size:18px}.md h2{font-size:16px;border:none;margin:20px 0 6px;padding:0}.md h3{font-size:15px}
.comp{margin-bottom:8px}.comp ul{margin:2px 0 0;font-size:13px}.factlist{font-size:13px}
</style></head><body><main>
<h1>記事作成の比較：今の流れ と 新しい流れ</h1>
<p class="muted">作成: ${esc(created)}・採点は ChatGPT が両方の記事を同じ条件で行ったもの（新しい流れは途中で ChatGPT の検証を受けて直しているため、第三者チェックでは新しい流れが有利になりやすい点に注意）</p>
${nav}
${sections}
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
document.querySelectorAll('article.md').forEach(function (el) {
  var src = document.getElementById(el.dataset.md);
  if (!src) return;
  var text = src.value;
  if (window.marked) { el.insertAdjacentHTML('beforeend', window.marked.parse(text)); }
  else { var pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.textContent = text; el.appendChild(pre); }
});
</script>
</body></html>`;
}
