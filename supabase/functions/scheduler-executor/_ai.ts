// AI プロバイダ呼び出し・コスト見積もり・スタイル参照・タイトル生成
import { DOMParser } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts';
import { normalizeAiModel, supportsTemperature } from '../../../src/shared/aiModelCatalog.ts';
import { generateTitleSuggestionsWithSharedCore } from '../../../src/shared/titleGenerationCore.ts';
import {
  AI_REQUEST_TIMEOUT_MS,
  AiOutputTruncatedError,
  fetchWithTimeout,
  normalizeAiConfig,
  normalizeWhitespace,
  resolveWritingTone,
  type AIConfig,
  type Schedule,
  type WritingTone,
} from './_shared.ts';
import { extractCompetitorHeadings } from './_research.ts';
import { formatScheduleFailureReason } from './_execution-state.ts';

export function truncateForStyleReference(value: string, minLength = 500, maxLength = 800): string {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength);
  const boundary = Math.max(
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('！'),
    candidate.lastIndexOf('？'),
    candidate.lastIndexOf('. ')
  );

  if (boundary >= minLength) {
    return candidate.slice(0, boundary + 1).trim();
  }
  return candidate.trim();
}


export async function fetchStyleReferenceSample(styleReferenceUrl?: string): Promise<string> {
  const url = String(styleReferenceUrl || '').trim();
  if (!url) return '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AutomaticWriter/1.0; +https://example.com/bot)',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`style reference fetch failed: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return '';

    const removeTargets = doc.querySelectorAll('script, style, nav, footer, header, noscript, aside, form');
    removeTargets.forEach((node) => (node as any).remove());

    const mainNode =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.body;

    const paragraphNodes = mainNode?.querySelectorAll('p') || [];
    let text = Array.from(paragraphNodes)
      .map((node) => normalizeWhitespace(node.textContent))
      .filter((line) => line.length >= 20)
      .join(' ');

    if (!text) {
      text = normalizeWhitespace(mainNode?.textContent || '');
    }

    return truncateForStyleReference(text);
  } catch (error) {
    console.warn('Failed to fetch style reference sample:', error);
    return '';
  }
}


export function buildStyleReferenceInstructions(sample: string, styleReferenceUrl?: string): string {
  const normalizedSample = truncateForStyleReference(sample);
  if (!normalizedSample) return '';

  const sourceLine = styleReferenceUrl ? `Reference URL: ${styleReferenceUrl}` : '';
  return [
    'Use the following writing style sample only as a tone and structure reference. Do not copy facts or wording from it.',
    sourceLine,
    'Style sample:',
    normalizedSample,
  ].filter(Boolean).join('\n');
}


export type ModelRate = { input: number; output: number };


export function resolveAiModelRate(provider: string, model: string): ModelRate {
  const p = String(provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();

  // USD per 1M tokens. Values are rough estimation for budgeting.
  if (p === 'openai') {
    if (m.includes('gpt-5.5')) return { input: 5.00, output: 30.00 };
    if (m.includes('gpt-5.4-mini')) return { input: 0.75, output: 4.50 };
    if (m.includes('gpt-5.4')) return { input: 2.50, output: 15.00 };
    if (m.includes('gpt-5') && m.includes('mini')) return { input: 0.30, output: 2.50 };
    if (m.includes('gpt-5')) return { input: 1.25, output: 10.00 };
    if (m.includes('gpt-4o-mini')) return { input: 0.15, output: 0.60 };
    if (m.includes('gpt-4o')) return { input: 5.00, output: 15.00 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'gemini') {
    if (m.includes('3.5-flash')) return { input: 1.50, output: 9.00 };
    if (m.includes('3.1-pro')) return { input: 2.00, output: 12.00 };
    if (m.includes('3.1-flash-lite')) return { input: 0.25, output: 1.50 };
    if (m.includes('2.5-pro')) return { input: 1.25, output: 10.00 };
    if (m.includes('2.5-flash')) return { input: 0.30, output: 2.50 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'claude') {
    if (m.includes('opus-4-8')) return { input: 5.00, output: 25.00 };
    if (m.includes('haiku-4-5')) return { input: 1.00, output: 5.00 };
    if (m.includes('opus')) return { input: 15.00, output: 75.00 };
    if (m.includes('haiku')) return { input: 0.80, output: 4.00 };
    return { input: 3.00, output: 15.00 };
  }
  return { input: 1.00, output: 5.00 };
}


export function estimateExecutionCostBreakdown(params: {
  provider: string;
  model: string;
  generatedChars: number;
  competitorResearchUsed: boolean;
  factCheckItemsChecked: number;
  imagesGenerated: number;
  imageUnitCostUsd: number;
}) {
  const rate = resolveAiModelRate(params.provider, params.model);
  const generationMultiplier = 1;

  // Rough token estimate assumptions for JP content:
  // 1000 chars ~= input 300 tokens + output 700 tokens.
  const inputTokens = Math.ceil((params.generatedChars / 1000) * 300 * generationMultiplier);
  const outputTokens = Math.ceil((params.generatedChars / 1000) * 700 * generationMultiplier);
  const aiCostUsd =
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output;

  // SerpAPI pricing varies by plan; this is an estimate for budgeting.
  const researchCostUsd = params.competitorResearchUsed ? 0.005 : 0;

  // Fact-check vendor pricing varies significantly. Keep as unknown in totals.
  const factCheckCostUsd = null;
  const imageCostUsd = params.imagesGenerated > 0
    ? params.imagesGenerated * Math.max(0, params.imageUnitCostUsd)
    : 0;

  const totalEstimatedUsd = aiCostUsd + researchCostUsd + imageCostUsd;

  return {
    ai: {
      provider: params.provider,
      model: params.model,
      tokens: {
        input_estimated: inputTokens,
        output_estimated: outputTokens,
      },
      rate_usd_per_1m_tokens: rate,
      estimated_usd: Number(aiCostUsd.toFixed(6)),
    },
    research: {
      serpapi_used: params.competitorResearchUsed,
      estimated_usd: Number(researchCostUsd.toFixed(6)),
    },
    fact_check: {
      items_checked: params.factCheckItemsChecked,
      estimated_usd: factCheckCostUsd,
    },
    images: {
      generated_count_estimated: params.imagesGenerated,
      unit_cost_usd: Number(params.imageUnitCostUsd.toFixed(6)),
      estimated_usd: Number(imageCostUsd.toFixed(6)),
    },
    assumptions: {
      char_to_token: '1000 chars ~= input 300 + output 700 tokens',
      excludes_unknown_services: ['fact_check'],
      includes: ['ai_generation', 'serpapi', 'image_generation'],
      image_price_source: 'app_settings.image_cost_usd_per_image',
    },
    total_estimated_usd: Number(totalEstimatedUsd.toFixed(6)),
  };
}

// AI provider call helper used by shared generation core.

export async function callAI(
  prompt: string,
  aiConfig: AIConfig,
  maxTokens?: number
): Promise<string> {
  const resolvedAiConfig = normalizeAiConfig(aiConfig);
  const provider = String(resolvedAiConfig.provider || '').toLowerCase();
  const model = resolvedAiConfig.model;
  const apiKey = resolvedAiConfig.api_key;
  const temperature = resolvedAiConfig.temperature ?? 0.7;
  const resolvedMaxTokens = maxTokens ?? resolvedAiConfig.max_tokens ?? 2000;

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  if (provider === 'openai') {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: resolvedMaxTokens,
        ...(supportsTemperature('openai', model) ? { temperature } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('OpenAI response was cut off because max_tokens was reached');
    }
    const content = choice?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
    }
    throw new Error('OpenAI API returned empty content');
  }

  if (provider === 'claude') {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: resolvedMaxTokens,
        messages: [{ role: 'user', content: prompt }],
        ...(supportsTemperature('claude', model) ? { temperature } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (data?.stop_reason === 'max_tokens') {
      throw new Error('Claude response was cut off because max_tokens was reached');
    }
    const text = Array.isArray(data?.content)
      ? data.content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
      : '';
    if (!text) throw new Error('Claude API returned empty content');
    return text;
  }

  if (provider === 'gemini') {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: resolvedMaxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
      : '';
    if (candidate?.finishReason === 'MAX_TOKENS') {
      if (text) {
        throw new AiOutputTruncatedError('Geminiの出力がmaxOutputTokens上限で途中終了しました。', text);
      }
      throw new Error('Geminiの出力がmaxOutputTokens上限で途中終了しました。');
    }
    if (!text) throw new Error('Gemini API returned empty content');
    return text;
  }

  throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
}

// === 隰ｾ・ｹ闖ｫ・ｮ2: 鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晉判豁楢怎・ｺ郢晏･ﾎ晉ｹ昜ｻ｣繝ｻ ===

// 驕ｶ・ｶ陷ｷ蛹ｻ繝ｧ郢晢ｽｼ郢ｧ・ｿ邵ｺ荵晢ｽ蛾ｫ｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ

export async function generateTitleWithAI(
  keyword: string,
  relatedKeywords: string[],
  competitorTitles: string[],
  aiConfig: AIConfig,
  competitorData?: any
): Promise<string> {
  const TITLE_MIN_LENGTH = 16;
  const TITLE_MAX_LENGTH = 80;

  const normalizeTitle = (raw: string): string => {
    let cleaned = String(raw || '').trim()
      .replace(/^Title:\s*/i, '')
      .replace(/^["']|["']$/g, '');

    // Remove leading/trailing brackets ONLY if they wrap the entire string
    if ((cleaned.startsWith('[') && cleaned.endsWith(']')) || (cleaned.startsWith('(') && cleaned.endsWith(')'))) {
      cleaned = cleaned.slice(1, -1);
    }

    // Fix unbalanced brackets at start (common AI artifact: "2026邵ｲ繝ｻ -> "2026")
    cleaned = cleaned.replace(/^[\[\(]+/, '');

    return cleaned.replace(/\s+/g, ' ').trim();
  };

  const includesKeyword = (title: string, baseKeyword: string): boolean => {
    const compactTitle = title.replace(/\s+/g, '');
    const compactKeyword = baseKeyword.replace(/\s+/g, '');
    if (compactKeyword && compactTitle.includes(compactKeyword)) return true;

    const keywordTokens = baseKeyword
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    return keywordTokens.some((token) => compactTitle.includes(token));
  };

  const isValidSeoTitle = (title: string, baseKeyword: string): boolean => {
    if (!title) return false;
    if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) return false;
    if (!includesKeyword(title, baseKeyword)) return false;
    if (/^(タイトル|記事タイトル|SEOタイトル)[:：]/.test(title)) return false;
    return true;
  };

  const competitorInputs = Array.isArray(competitorData?.articles) && competitorData.articles.length > 0
    ? competitorData.articles
      .slice(0, 6)
      .map((article: any) => ({
        title: String(article?.title || '').trim(),
        headings: Array.isArray(article?.headings) ? article.headings.slice(0, 6) : [],
      }))
      .filter((item: any) => item.title.length > 0)
    : competitorTitles
      .slice(0, 6)
      .map((title: string) => ({ title: String(title || '').trim() }))
      .filter((item: any) => item.title.length > 0);

  try {
    const suggestions = await generateTitleSuggestionsWithSharedCore({
      keyword,
      relatedKeywords,
      competitors: competitorInputs,
      count: 1,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, Math.max(600, maxTokens)),
    });

    for (const candidate of suggestions) {
      const title = normalizeTitle(candidate.title);
      if (!title) continue;
      if (isValidSeoTitle(title, keyword)) {
        return title;
      }
      console.warn(`AI title rejected by validator: ${title}`);
    }
  } catch (err) {
    console.error('Shared title core failed:', err);
    const detail = formatScheduleFailureReason(err);
    throw new Error(`AI title generation failed: ${detail}`);
  }

  throw new Error('AI title generation did not return a valid title.');
}

// 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫ陞ｳ貅ｯ・｡魃会ｽｼ蛹ｻ繝ｻ郢晢ｽｫ郢昶・縺帷ｹ昴・繝｣郢晉､ｼ蜃ｽ隰悟鴻豐ｿ繝ｻ繝ｻ
