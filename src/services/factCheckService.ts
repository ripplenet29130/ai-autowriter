import { supabase } from './supabaseClient';
import { FactCheckItem, FactCheckResult } from '../types/factCheck';

type PerplexityBatchResult = {
  claim_number: number;
  verdict: FactCheckResult['verdict'];
  confidence: number;
  correct_info?: string;
  source_url?: string;
  explanation?: string;
};

type FactCheckSettingsRow = {
  enabled: boolean;
  perplexity_api_key?: string | null;
  max_items_to_check?: number | null;
  model_name?: string | null;
  auto_fix_enabled?: boolean | null;
};

type FactCheckProgress = {
  total: number;
  processed: number;
};

const LOCAL_STORAGE_KEY = 'fact_check_settings_local';



const parseBoolean = (value: string | null | undefined, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseNumber = (value: string | null | undefined, fallback: number): number => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};



const normalizeConfidence = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n <= 1) return Math.round(n * 100);
  return Math.round(Math.min(100, n));
};

const hasInvalidAmountPattern = (text: string): boolean => {
  const t = text.replace(/\s+/g, '');
  return (
    /いくらか[,，]?0{3,}(?:円|万円|千円)/.test(t) ||
    /(^|[^\d])[,，]?0{3,}(?:円|万円|千円)/.test(t) ||
    /(約|およそ)?[,，]0{3,}(?:円|万円|千円)/.test(t)
  );
};
const applyFallbackFixes = (originalContent: string, issues: FactCheckResult[]): string => {
  let next = originalContent;
  const correctionLines: string[] = [];

  issues.forEach((issue) => {
    if (!issue.correctInfo || issue.correctInfo.trim().length === 0) return;
    const claim = issue.claim.trim();
    const correct = issue.correctInfo.trim();
    if (!claim || !correct) return;

    // First try a direct replacement of the detected claim.
    if (next.includes(claim)) {
      next = next.replace(claim, `${claim}（修正: ${correct}）`);
    }

    correctionLines.push(`- ${claim} => ${correct}`);
  });

  if (correctionLines.length === 0) return next;

  const report = ['【AI修正サマリー】', ...correctionLines, '', ''].join('\n');
  if (!next.startsWith('【AI修正サマリー】')) {
    next = report + next;
  }

  return next;
};
const getLocalSettings = (): FactCheckSettingsRow | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      perplexityApiKey?: unknown;
      maxItemsToCheck?: unknown;
      autoFixEnabled?: unknown;
      modelName?: unknown;
    };
    const key = String(parsed.perplexityApiKey ?? '').trim();
    if (!key) return null;
    return {
      enabled: Boolean(parsed.enabled ?? true),
      perplexity_api_key: key,
      max_items_to_check: parseNumber(String(parsed.maxItemsToCheck ?? '10'), 10),
      model_name: String(parsed.modelName ?? 'sonar'),
      auto_fix_enabled: Boolean(parsed.autoFixEnabled ?? false),
    };
  } catch {
    return null;
  }
};

export const factCheckService = {
  async resolveSettings(): Promise<FactCheckSettingsRow | null> {
    const localSettings = getLocalSettings();
    if (localSettings?.perplexity_api_key) return localSettings;

    if (!supabase) return null;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!authError && user) {
      const { data } = await supabase
        .from('fact_check_settings')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return (data as FactCheckSettingsRow) ?? null;
      }
    }

    // 暫定: ログインなしでも app_settings からグローバル設定を読み取る
    const { data: globalRows, error: globalError } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'perplexity_api_key',
        'fact_check_enabled',
        'fact_check_model_name',
        'fact_check_max_items',
        'fact_check_auto_fix_enabled',
      ]);

    if (globalError || !globalRows || globalRows.length === 0) {
      return null;
    }

    const map = new Map<string, string>();
    globalRows.forEach((row: any) => {
      map.set(String(row.key), String(row.value ?? ''));
    });

    const globalApiKey = map.get('perplexity_api_key');
    if (!globalApiKey) return null;

    return {
      enabled: parseBoolean(map.get('fact_check_enabled'), true),
      perplexity_api_key: globalApiKey,
      model_name: map.get('fact_check_model_name') || 'sonar',
      max_items_to_check: parseNumber(map.get('fact_check_max_items'), 10),
      auto_fix_enabled: parseBoolean(map.get('fact_check_auto_fix_enabled'), false),
    };
  },

  extractFacts(content: string, userMarkedText?: string): FactCheckItem[] {
    type Candidate = FactCheckItem & { score: number };
    const candidates: Candidate[] = [];

    const numberRegex = /\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:%|円|ドル|人|件|倍|km|kg|万|億)?/;
    const dateRegex = /\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年/;
    const quoteRegex = /「[^」]{2,80}」|『[^』]{2,80}』/;
    const compareRegex = /増加|減少|上昇|下落|最多|最少|最大|最小|上回|下回|高い|低い|急増|急減/;
    const sourceRegex = /によると|発表|公表|報告|調査|統計|データ|出典/;
    const katakanaRegex = /[ァ-ヶー]{3,}/;

    const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

    const scoreSentence = (sentence: string): number => {
      let score = 0;
      if (numberRegex.test(sentence)) score += 4;
      if (dateRegex.test(sentence)) score += 4;
      if (quoteRegex.test(sentence)) score += 3;
      if (compareRegex.test(sentence)) score += 2;
      if (sourceRegex.test(sentence)) score += 2;
      if (katakanaRegex.test(sentence)) score += 1;
      if (sentence.length >= 20 && sentence.length <= 220) score += 1;
      return score;
    };

    if (userMarkedText) {
      const markedRegex = /\[\[(.+?)\]\]/g;
      let mark: RegExpExecArray | null;
      while ((mark = markedRegex.exec(userMarkedText)) !== null) {
        const claim = normalize(mark[1]);
        if (!claim) continue;
        const start = Math.max(0, mark.index - 80);
        const end = Math.min(userMarkedText.length, mark.index + mark[0].length + 80);
        candidates.push({
          claim,
          context: userMarkedText.slice(start, end),
          priority: 'high',
          score: 100, // 明示指定は常に最優先
        });
      }
    }

    const paragraphs = content
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const paragraph of paragraphs) {
      const sentenceCandidates = paragraph
        .split(/(?<=[。！？!?])\s+|\n+/)
        .map((s) => normalize(s))
        .filter((s) => s.length >= 12);

      const ranked = sentenceCandidates
        .map((sentence) => {
          const score = scoreSentence(sentence);
          return {
            claim: sentence,
            context: paragraph,
            priority: score >= 7 ? ('high' as const) : ('normal' as const),
            score,
          };
        })
        .filter((c) => c.score >= 3)
        .sort((a, b) => b.score - a.score);

      const picked: Candidate[] = [];
      let highCount = 0;
      let normalCount = 0;
      for (const candidate of ranked) {
        if (candidate.priority === 'high' && highCount < 2) {
          picked.push(candidate);
          highCount += 1;
          continue;
        }
        if (candidate.priority === 'normal' && normalCount < 1) {
          picked.push(candidate);
          normalCount += 1;
        }
        if (picked.length >= 3) break;
      }
      candidates.push(...picked);
    }

    const deduped = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const key = normalize(candidate.claim);
      const existing = deduped.get(key);
      if (!existing || candidate.score > existing.score) {
        deduped.set(key, candidate);
      }
    }

    return Array.from(deduped.values())
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
        return b.score - a.score;
      })
      .map(({ claim, context, priority }) => ({ claim, context, priority }));
  },

  async verifyFacts(
    items: FactCheckItem[],
    keyword: string,
    modelName?: string,
    onProgress?: (progress: FactCheckProgress) => void
  ): Promise<FactCheckResult[]> {
    if (items.length === 0) return [];

    const settings = await this.resolveSettings();

    if (!settings?.enabled || !settings?.perplexity_api_key) {
      console.warn('Fact check settings not found or API key missing (user/global)');
      return [];
    }

    const results: FactCheckResult[] = [];
    const batchSize = 5;
    const itemsToCheck = items.slice(0, settings.max_items_to_check || 10);
    const selectedModel = modelName || settings.model_name || 'sonar';
    onProgress?.({ total: itemsToCheck.length, processed: 0 });

    for (let i = 0; i < itemsToCheck.length; i += batchSize) {
      const batch = itemsToCheck.slice(i, i + batchSize);

      const claimsList = batch
        .map((item, idx) => `${idx + 1}. 主張: ${item.claim}\n   文脈: ${item.context}`)
        .join('\n\n');

      const prompt = [
        '次の主張を最新の公開情報で検証してください。',
        '',
        '【チェック対象】',
        claimsList,
        '',
        `【関連キーワード】${keyword}`,
        '',
        '判定ルール: 金額や数値が欠落している表現（例: いくらか,000円 / ,000円）は incorrect を返してください。',
        '判定ルール: 主張の一部でも重大な数値誤り・相場誤りがあれば partially_correct ではなく incorrect を返してください。',
        '次のJSON配列のみを返してください。',
        '[',
        '  {',
        '    "claim_number": 1,',
        '    "verdict": "correct | incorrect | partially_correct | unverified",',
        '    "confidence": 0,',
        '    "correct_info": "補足情報",',
        '    "explanation": "理由",',
        '    "source_url": "https://..."',
        '  }',
        ']',
      ].join('\n');

      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.perplexity_api_key}`,
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: 'system', content: 'You are a precise fact-checking assistant. Return JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
          }),
        });

        if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

        const data = await response.json();
        const content: string = data?.choices?.[0]?.message?.content ?? '[]';

        let batchResults: PerplexityBatchResult[] = [];
        try {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content) as PerplexityBatchResult[];
        } catch {
          batchResults = batch.map((_, idx) => ({
            claim_number: idx + 1,
            verdict: 'unverified',
            confidence: 0,
            explanation: 'レスポンスの解析に失敗しました',
            source_url: '',
          }));
        }

        batch.forEach((item, idx) => {
          const result = batchResults.find((r) => r.claim_number === idx + 1) ?? batchResults[idx];
          if (!result) return;

          let verdict = result.verdict;
          let confidence = normalizeConfidence(result.confidence);
          let explanation = result.explanation ?? '';

          if (hasInvalidAmountPattern(item.claim) && verdict !== 'incorrect') {
            verdict = 'incorrect';
            confidence = Math.max(confidence, 85);
            explanation = explanation
              ? `金額表現が欠落しているため不正確として扱いました。 ${explanation}`
              : '金額表現が欠落しているため不正確として扱いました。';
          }

          results.push({
            claim: item.claim,
            verdict,
            confidence,
            correctInfo: result.correct_info,
            sourceUrl: result.source_url ?? '',
            explanation,
          });
        });

        if (i + batchSize < itemsToCheck.length) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      } catch (error) {
        console.error('Batch verification error:', error);
      }
      onProgress?.({ total: itemsToCheck.length, processed: Math.min(i + batchSize, itemsToCheck.length) });
    }

    return results;
  },

  hasFixableIssues(results: FactCheckResult[]): boolean {
    return results.some((result) => {
      if (result.verdict === 'incorrect') return true;
      if (result.verdict === 'partially_correct') return true;
      if (result.verdict === 'unverified') return true;
      return false;
    });
  },

  async getSettings(): Promise<FactCheckSettingsRow | null> {
    return this.resolveSettings();
  },

  async applyFactCheckFixes(
    originalContent: string,
    results: FactCheckResult[],
    keyword: string,
    modelName?: string
  ): Promise<string | null> {
    const settings = await this.getSettings();
    if (!settings?.enabled || !settings?.perplexity_api_key) return null;

    const issues = results.filter(
      (result) => result.verdict === 'incorrect' || result.verdict === 'partially_correct' || result.verdict === 'unverified'
    );
    if (issues.length === 0) return originalContent;

    const issuesText = issues
      .slice(0, 20)
      .map((result, idx) => {
        const evidence = result.correctInfo ? `\n- 修正情報: ${result.correctInfo}` : '';
        const source = result.sourceUrl ? `\n- 出典: ${result.sourceUrl}` : '';
        return `${idx + 1}. 主張: ${result.claim}\n- 判定: ${result.verdict} (${normalizeConfidence(result.confidence)}%)\n- 理由: ${
          result.explanation
        }${evidence}${source}`;
      })
      .join('\n\n');

    const prompt = [
      '以下の記事を、指摘された事実誤認のみ修正してください。',
      '文体・構成・見出し・段落順はできるだけ維持してください。',
      '不確かな表現は断定を避ける書き方に修正してください。',
      '回答は修正後の記事本文のみを返してください。',
      '',
      `【関連キーワード】${keyword}`,
      '',
      '【修正対象】',
      issuesText,
      '',
      '【元記事】',
      originalContent,
    ].join('\n');

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.perplexity_api_key}`,
        },
        body: JSON.stringify({
          model: modelName || settings.model_name || 'sonar',
          messages: [
            { role: 'system', content: 'You edit Japanese articles to fix factual mistakes while preserving style.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
      });

      if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

      const data = await response.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      const cleaned = content.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
      return cleaned || null;
    } catch (error) {
      console.error('Fact check auto-fix failed:', error);
      return null;
    }
  },
};












