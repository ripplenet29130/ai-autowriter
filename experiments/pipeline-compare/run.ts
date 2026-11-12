// 今の流れと新しい流れを同じキーワードで実行し、同じ基準（ChatGPT）で採点して比較ページを作る
// 使い方は README.md を参照
import { getDefaultAiModel } from '../../src/shared/aiModelCatalog.ts';
import { env, errorMessage } from './lib/env.ts';
import { OpenAiClient } from './lib/openai.ts';
import { verifyWithChatGpt, type VerifyOutcome } from './lib/verify.ts';
import { comparePair, scoreQuality, type PairwiseResult, type QualityScore } from './lib/judge.ts';
import type { FlowName, FlowResult } from './lib/types.ts';
import { runCurrentFlow } from './flows/current.ts';
import { runV2Flow } from './flows/v2.ts';
import { runPipelineFlow } from './flows/pipeline.ts';
import { buildReportHtml } from './report.ts';

export interface JudgeResult {
  verifier: string;
  verify: Partial<Record<FlowName, VerifyOutcome | { error: string }>>;
  quality: Partial<Record<FlowName, QualityScore | { error: string }>>;
  pairwise: PairwiseResult | { error: string } | null;
  // 並び順を入れ替えて複数回比べた場合の、それぞれの結果
  pairwiseRounds?: PairwiseResult[];
  usage: OpenAiClient['usage'] | null;
}

export interface KeywordComparison {
  keyword: string;
  flows: Partial<Record<FlowName, FlowResult | { error: string }>>;
  judge: JudgeResult | null;
  // 表示名（--baseline のとき「以前」「改善後」にする）
  labels?: Partial<Record<FlowName, string>>;
}

function parseArgs(args: string[]) {
  const keywords: string[] = [];
  let words: number | undefined;
  let only: FlowName | null = null;
  let judge = true;
  let articleOnly = false;
  let baseline: string | null = null;
  // 外から持ち込んだ記事（Gemini アプリなどで作ったもの）。「キーワード=ファイル」か、キーワードが 1 つならファイルだけ
  const externals: string[] = [];
  let externalLabel = '持ち込んだ記事';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--external') { externals.push(String(args[++i] || '').trim()); continue; }
    if (a === '--external-label') { externalLabel = String(args[++i] || '').trim() || externalLabel; continue; }
    if (a === '--words') words = Number(args[++i]) || undefined;
    else if (a === '--only') only = args[++i] === 'v2' ? 'v2' : 'current';
    else if (a === '--no-judge') judge = false;
    // 記事だけ作る（採点しない・比較ページを作らない・今の流れの枠だけ動かす）
    else if (a === '--article-only') { articleOnly = true; judge = false; only = 'current'; }
    else if (a === '--baseline') baseline = String(args[++i] || '').trim() || null;
    // 手動生成と同じく時間制限なしで動かす（見直し・検証を省略させない）。本番の 140 秒の条件ではなくなる
    else if (a === '--no-time-limit') Deno.env.set('SCHEDULER_TIME_BUDGET_SECONDS', '1200');
    // 新方式の検証用: single なら今の流れの本文を記事全体で 1 回に書く
    // 新方式の検証用: gemini なら SerpAPI／SearchApi を使わず Gemini の Google 検索で競合調査をする
    else if (a === '--research') Deno.env.set('PIPELINE_RESEARCH_MODE', String(args[++i] || '').trim() === 'gemini' ? 'gemini' : 'serpapi');
    // 新方式（article-pipeline）の工程そのものを、この PC の上で順番に動かす
    else if (a === '--flow') Deno.env.set('PIPELINE_COMPARE_FLOW', String(args[++i] || '').trim() === 'pipeline' ? 'pipeline' : 'current');
    // 新方式の書き方: oneshot（広い調査＋1 回で書き切る。標準）か steps（工程を分けて批評・書き直し）
    else if (a === '--style') Deno.env.set('PIPELINE_WRITING_STYLE', String(args[++i] || '').trim() === 'steps' ? 'steps' : 'oneshot');
    // 役割ごとの AI（例: --ai factcheck=openai:gpt-5.4 --ai writer=auto）。役割は aiRoleSettings.ts の AI_ROLES。
    // 指定しない役割は標準（ファクトチェック・修正は ChatGPT）
    else if (a === '--ai') {
      const [role, value] = String(args[++i] || '').split('=');
      if (role && value) Deno.env.set(`PIPELINE_AI_${role.trim().toUpperCase()}`, value.trim());
    }
    else if (a === '--writer') Deno.env.set('PIPELINE_AI_WRITER', String(args[++i] || '').trim());
    else if (a === '--checker') Deno.env.set('PIPELINE_AI_FACTCHECK', String(args[++i] || '').trim());
    else if (a === '--writing') Deno.env.set('PIPELINE_WRITING_MODE', String(args[++i] || '').trim() === 'single' ? 'single' : 'sections');
    else if (a.trim()) keywords.push(a.trim());
  }
  return { keywords, words, only, judge, baseline, externals, externalLabel, articleOnly };
}

// 外から持ち込んだ記事を、採点できる形にする（Markdown の最初の「# 」の行をタイトルにする）
async function loadExternalArticles(
  specs: string[],
  keywords: string[],
  label: string,
): Promise<{ label: string; byKeyword: Map<string, FlowResult> }> {
  const byKeyword = new Map<string, FlowResult>();
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    const keyword = eq > 0 ? spec.slice(0, eq).trim() : keywords[0];
    const path = eq > 0 ? spec.slice(eq + 1).trim() : spec;
    if (!keyword || !path) continue;
    const raw = (await Deno.readTextFile(path)).replace(/\r\n?/g, '\n').trim();
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : keyword;
    const content = titleMatch ? raw.replace(titleMatch[0], '').trim() : raw;
    byKeyword.set(keyword, {
      name: 'current',
      label,
      keyword,
      title,
      content,
      outline: null,
      research: null,
      relatedKeywords: [],
      competitorHeadings: [],
      factSheet: null,
      factSheetNote: '外から持ち込んだ記事',
      editorialReview: '—（外から持ち込んだ記事）',
      factCheck: { verifier: '—', executed: false, results: [], rounds: 0, autoFixApplied: false, note: '外から持ち込んだ記事' },
      writerModel: label,
      draftReasons: [],
      warnings: [],
      notes: [`ファイル: ${path}`],
      skippedSteps: [],
      referencesCount: 0,
      steps: [],
      totalMs: 0,
      usage: { gemini: null, openai: null, serpapiCalls: 0, customSearchCalls: 0 },
    });
  }
  return { label, byKeyword };
}

// 以前の比較結果（out/日時/result.json）から、同じキーワードの「今の流れ」の記事を読み込む
async function loadBaseline(baseline: string): Promise<{ label: string; byKeyword: Map<string, FlowResult> }> {
  const dirUrl = /[\\/]/.test(baseline) && !baseline.startsWith('out/')
    ? new URL(`file:///${baseline.replace(/\\/g, '/').replace(/^\/+/, '')}/`)
    : new URL(`./out/${baseline.replace(/^out\//, '')}/`, import.meta.url);
  const data = JSON.parse(await Deno.readTextFile(new URL('result.json', dirUrl))) as KeywordComparison[];
  const byKeyword = new Map<string, FlowResult>();
  for (const comparison of data) {
    // --baseline で作った結果では、v2 枠に「改善後（その回に作った記事）」が入っている
    const flow = comparison.labels ? comparison.flows?.v2 : comparison.flows?.current;
    if (isOk<FlowResult>(flow)) byKeyword.set(comparison.keyword, flow);
  }
  const name = baseline.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || baseline;
  return { label: `以前（${name}）`, byKeyword };
}

const isOk = <T>(v: T | { error: string } | undefined | null): v is T => Boolean(v) && !(v as any).error;

async function runJudge(
  client: OpenAiClient,
  keyword: string,
  flows: KeywordComparison['flows'],
  options: { swapOrder?: boolean } = {},
): Promise<JudgeResult> {
  const result: JudgeResult = { verifier: `ChatGPT（${client.model}）`, verify: {}, quality: {}, pairwise: null, usage: null };
  const names = (Object.keys(flows) as FlowName[]).filter((n) => isOk<FlowResult>(flows[n]));
  for (const name of names) {
    const flow = flows[name] as FlowResult;
    console.log(`  ▶ 採点: ${flow.label}の事実確認（根拠メモは渡さず、同じ条件で確認）`);
    try {
      result.verify[name] = await verifyWithChatGpt(client, { content: flow.content, keyword });
    } catch (error) {
      result.verify[name] = { error: errorMessage(error) };
    }
    console.log(`  ▶ 採点: ${flow.label}の質`);
    try {
      result.quality[name] = await scoreQuality(client, { keyword, title: flow.title, content: flow.content });
    } catch (error) {
      result.quality[name] = { error: errorMessage(error) };
    }
  }
  if (names.length === 2 && options.swapOrder) {
    // 並び順の影響を避けるため、記事 1 / 2 を入れ替えて 2 回比べる（記事改善プラン 0-1）
    const rounds: PairwiseResult[] = [];
    for (const order of [['current', 'v2'], ['v2', 'current']] as PairwiseResult['order'][]) {
      console.log(`  ▶ 採点: 2 つの記事を並べて比較（${rounds.length + 1}回目）`);
      try {
        rounds.push(await comparePair(client, {
          keyword,
          current: flows.current as FlowResult,
          v2: flows.v2 as FlowResult,
          order,
        }));
      } catch (error) {
        console.error(`    失敗: ${errorMessage(error)}`);
      }
    }
    result.pairwiseRounds = rounds;
    if (rounds.length === 0) {
      result.pairwise = { error: '並べ比べに 2 回とも失敗しました' };
    } else {
      const agreed = rounds.every((r) => r.winner === rounds[0].winner);
      result.pairwise = {
        winner: agreed ? rounds[0].winner : 'tie',
        reason: [
          agreed ? '' : '並び順で結果が変わったため、引き分け扱いにしました。',
          ...rounds.map((r, i) => `【${i + 1}回目】${r.reason}`),
        ].filter(Boolean).join(' '),
        order: rounds[0].order,
      };
    }
  } else if (names.length === 2) {
    console.log('  ▶ 採点: 2 つの記事を並べて比較');
    try {
      result.pairwise = await comparePair(client, {
        keyword,
        current: flows.current as FlowResult,
        v2: flows.v2 as FlowResult,
      });
    } catch (error) {
      result.pairwise = { error: errorMessage(error) };
    }
  }
  result.usage = { ...client.usage };
  return result;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const { keywords, words, only, judge, baseline, externals, externalLabel, articleOnly } = parseArgs(Deno.args);
  if (keywords.length === 0) {
    console.error('キーワードを指定してください。例: deno run ... run.ts "相続税 申告期限" "NISA 始め方"');
    Deno.exit(1);
  }

  // --baseline: 今の流れだけを動かし、以前の結果の記事と同じ基準で比べる
  // --external（外から持ち込んだ記事）も、比べる相手として --baseline と同じ扱いにする
  const baselineData = externals.length > 0
    ? await loadExternalArticles(externals, keywords, externalLabel)
    : baseline ? await loadBaseline(baseline) : null;
  if (baselineData) {
    const missing = keywords.filter((k) => !baselineData.byKeyword.has(k));
    if (missing.length > 0) {
      console.error(`以前の結果に、次のキーワードの記事がありません: ${missing.join('、')}`);
      Deno.exit(1);
    }
    console.log(`以前の結果と比べます: ${baselineData.label}`);
  }

  const outDir = new URL(`./out/${stamp()}/`, import.meta.url);
  await Deno.mkdir(outDir, { recursive: true });
  const openAiKey = env('OPENAI_API_KEY');
  const comparisons: KeywordComparison[] = [];

  for (const keyword of keywords) {
    console.log(`\n=== ${keyword} ===`);
    const comparison: KeywordComparison = { keyword, flows: {}, judge: null };
    // --flow pipeline なら「今の流れ」の枠で、新方式（article-pipeline）の工程を順番に動かす
    const flowMode = Deno.env.get('PIPELINE_COMPARE_FLOW');
    const runners: Array<[FlowName, typeof runCurrentFlow]> = [
      ['current', flowMode === 'pipeline' ? runPipelineFlow : runCurrentFlow],
      ['v2', runV2Flow],
    ];
    // 回数制限の取り合いを避け、時間を正しく測るため、1 つずつ順番に実行する
    for (const [name, runner] of runners) {
      if (baselineData && name !== 'current') continue;
      if (!baselineData && only && only !== name) continue;
      console.log(`\n[${name === 'current' ? '今の流れ' : '新しい流れ'}]`);
      try {
        const flow = await runner({ keyword, targetWordCount: words });
        comparison.flows[name] = flow;
        await Deno.writeTextFile(new URL(`${safeName(keyword)}-${name}.md`, outDir), `# ${flow.title}\n\n${flow.content}\n`);
        console.log(`  完了: ${(flow.totalMs / 1000).toFixed(0)}秒・AI の費用 約${flow.usage.gemini?.total_estimated_jpy ?? 0}円（有料キー換算・ChatGPT や Claude を選んだ分も含む）`);
        for (const warning of flow.warnings) console.log(`  注意: ${warning}`);
      } catch (error) {
        console.error(`  失敗: ${errorMessage(error)}`);
        comparison.flows[name] = { error: errorMessage(error) };
      }
    }

    if (baselineData) {
      // 表の左（current 枠）に以前の記事、右（v2 枠）に今回の記事を置く
      const fresh = comparison.flows.current;
      const before = baselineData.byKeyword.get(keyword)!;
      comparison.flows = { current: before, v2: fresh };
      const noLimit = Number(Deno.env.get('SCHEDULER_TIME_BUDGET_SECONDS')) >= 1200;
      const single = Deno.env.get('PIPELINE_WRITING_MODE') === 'single';
      const geminiResearch = Deno.env.get('PIPELINE_RESEARCH_MODE') === 'gemini';
      const notes = [noLimit ? '時間制限なし' : '', single ? '一度に書く' : '', geminiResearch ? 'Gemini 調査' : ''].filter(Boolean).join('・');
      comparison.labels = {
        current: baselineData.label,
        v2: Deno.env.get('PIPELINE_COMPARE_FLOW') === 'pipeline' ? '新方式（工程ごと）' : `改善後（今回${notes ? `・${notes}` : ''}）`,
      };
      await Deno.writeTextFile(new URL(`${safeName(keyword)}-before.md`, outDir), `# ${before.title}\n\n${before.content}\n`);
    }

    if (judge && openAiKey) {
      console.log('\n[採点]');
      comparison.judge = await runJudge(
        new OpenAiClient(openAiKey, env('OPENAI_MODEL', getDefaultAiModel('openai'))),
        keyword,
        comparison.flows,
        { swapOrder: Boolean(baselineData) },
      );
    } else if (judge) {
      console.warn('OPENAI_API_KEY がないため採点を省略しました');
    }
    comparisons.push(comparison);

    // --article-only では記事（.md）だけを残し、比較ページと結果のファイルは作らない
    if (articleOnly) continue;
    // 途中で止まっても結果が残るよう、キーワードごとに書き出す
    await Deno.writeTextFile(new URL('result.json', outDir), JSON.stringify(comparisons, null, 2));
    await Deno.writeTextFile(new URL('report.html', outDir), buildReportHtml(comparisons));
  }

  const toPath = (name: string) => decodeURIComponent(new URL(name, outDir).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  if (articleOnly) {
    console.log(`\n記事: ${keywords.map((keyword) => toPath(`${safeName(keyword)}-current.md`)).join('\n      ')}`);
    return;
  }
  console.log(`\n比較ページ: ${toPath('report.html')}`);
}

function safeName(keyword: string): string {
  return keyword.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

if (import.meta.main) {
  await main();
}
