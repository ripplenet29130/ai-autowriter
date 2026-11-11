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
import { buildReportHtml } from './report.ts';

export interface JudgeResult {
  verifier: string;
  verify: Partial<Record<FlowName, VerifyOutcome | { error: string }>>;
  quality: Partial<Record<FlowName, QualityScore | { error: string }>>;
  pairwise: PairwiseResult | { error: string } | null;
  usage: OpenAiClient['usage'] | null;
}

export interface KeywordComparison {
  keyword: string;
  flows: Partial<Record<FlowName, FlowResult | { error: string }>>;
  judge: JudgeResult | null;
}

function parseArgs(args: string[]) {
  const keywords: string[] = [];
  let words: number | undefined;
  let only: FlowName | null = null;
  let judge = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--words') words = Number(args[++i]) || undefined;
    else if (a === '--only') only = args[++i] === 'v2' ? 'v2' : 'current';
    else if (a === '--no-judge') judge = false;
    else if (a.trim()) keywords.push(a.trim());
  }
  return { keywords, words, only, judge };
}

const isOk = <T>(v: T | { error: string } | undefined | null): v is T => Boolean(v) && !(v as any).error;

async function runJudge(client: OpenAiClient, keyword: string, flows: KeywordComparison['flows']): Promise<JudgeResult> {
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
  if (names.length === 2) {
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
  const { keywords, words, only, judge } = parseArgs(Deno.args);
  if (keywords.length === 0) {
    console.error('キーワードを指定してください。例: deno run ... run.ts "相続税 申告期限" "NISA 始め方"');
    Deno.exit(1);
  }

  const outDir = new URL(`./out/${stamp()}/`, import.meta.url);
  await Deno.mkdir(outDir, { recursive: true });
  const openAiKey = env('OPENAI_API_KEY');
  const comparisons: KeywordComparison[] = [];

  for (const keyword of keywords) {
    console.log(`\n=== ${keyword} ===`);
    const comparison: KeywordComparison = { keyword, flows: {}, judge: null };
    const runners: Array<[FlowName, typeof runCurrentFlow]> = [
      ['current', runCurrentFlow],
      ['v2', runV2Flow],
    ];
    // 回数制限の取り合いを避け、時間を正しく測るため、1 つずつ順番に実行する
    for (const [name, runner] of runners) {
      if (only && only !== name) continue;
      console.log(`\n[${name === 'current' ? '今の流れ' : '新しい流れ'}]`);
      try {
        const flow = await runner({ keyword, targetWordCount: words });
        comparison.flows[name] = flow;
        await Deno.writeTextFile(new URL(`${safeName(keyword)}-${name}.md`, outDir), `# ${flow.title}\n\n${flow.content}\n`);
        console.log(`  完了: ${(flow.totalMs / 1000).toFixed(0)}秒`);
      } catch (error) {
        console.error(`  失敗: ${errorMessage(error)}`);
        comparison.flows[name] = { error: errorMessage(error) };
      }
    }

    if (judge && openAiKey) {
      console.log('\n[採点]');
      comparison.judge = await runJudge(new OpenAiClient(openAiKey, env('OPENAI_MODEL', getDefaultAiModel('openai'))), keyword, comparison.flows);
    } else if (judge) {
      console.warn('OPENAI_API_KEY がないため採点を省略しました');
    }
    comparisons.push(comparison);

    // 途中で止まっても結果が残るよう、キーワードごとに書き出す
    await Deno.writeTextFile(new URL('result.json', outDir), JSON.stringify(comparisons, null, 2));
    await Deno.writeTextFile(new URL('report.html', outDir), buildReportHtml(comparisons));
  }

  const reportPath = decodeURIComponent(new URL('report.html', outDir).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  console.log(`\n比較ページ: ${reportPath}`);
}

function safeName(keyword: string): string {
  return keyword.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
}

if (import.meta.main) {
  await main();
}
