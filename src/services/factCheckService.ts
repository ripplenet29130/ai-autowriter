import { supabase } from './supabaseClient';
import { FactCheckItem, FactCheckResult } from '../types/factCheck';

export const factCheckService = {
    /**
     * 記事から事実情報を抽出
     */
    extractFacts(content: string, userMarkedText?: string): FactCheckItem[] {
        const items: FactCheckItem[] = [];

        // ユーザーマーク箇所 [[]]
        if (userMarkedText) {
            const regex = /\[\[(.+?)\]\]/g;
            let match;
            while ((match = regex.exec(userMarkedText)) !== null) {
                const start = Math.max(0, match.index - 50);
                const end = Math.min(userMarkedText.length, match.index + match[0].length + 50);

                items.push({
                    claim: match[1],
                    context: userMarkedText.substring(start, end),
                    priority: 'high'
                });
            }
        }

        // 数値
        const numberRegex = /(\d+(?:,\d{3})*(?:\.\d+)?[%円万億兆ドル年月日人件個])/g;
        let match;
        while ((match = numberRegex.exec(content)) !== null) {
            const start = Math.max(0, match.index - 30);
            const end = Math.min(content.length, match.index + match[0].length + 30);

            items.push({
                claim: match[0],
                context: content.substring(start, end),
                priority: 'normal'
            });
        }

        // 日付
        const dateRegex = /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年)/g;
        while ((match = dateRegex.exec(content)) !== null) {
            const start = Math.max(0, match.index - 30);
            const end = Math.min(content.length, match.index + match[0].length + 30);

            items.push({
                claim: match[0],
                context: content.substring(start, end),
                priority: 'normal'
            });
        }

        // 固有名詞らしきもの（簡易抽出）
        // 1. 「」や『』で囲まれたテキスト（作品名、書名など）
        const quoteRegex = /[「『](.+?)[」』]/g;
        while ((match = quoteRegex.exec(content)) !== null) {
            // 短すぎず長すぎないもの（2文字以上20文字以下）
            if (match[1].length >= 2 && match[1].length <= 20) {
                const start = Math.max(0, match.index - 30);
                const end = Math.min(content.length, match.index + match[0].length + 30);
                items.push({
                    claim: match[1],
                    context: content.substring(start, end),
                    priority: 'normal'
                });
            }
        }

        // 2. カタカナ語（3文字以上）
        const katakanaRegex = /[ァ-ンー]{3,}/g;
        while ((match = katakanaRegex.exec(content)) !== null) {
            const start = Math.max(0, match.index - 30);
            const end = Math.min(content.length, match.index + match[0].length + 30);
            items.push({
                claim: match[0],
                context: content.substring(start, end),
                priority: 'normal'
            });
        }

        // 重複除去
        const uniqueItems = Array.from(new Map(items.map(item => [item.claim, item])).values());

        return uniqueItems.sort((a, b) => a.priority === 'high' ? -1 : 1);
    },

    /**
     * Perplexity APIで検証
     */
    async verifyFacts(items: FactCheckItem[], keyword: string, modelName?: string): Promise<FactCheckResult[]> {
        if (items.length === 0) return [];

        // 設定を取得
        const { data: settings } = await supabase
            .from('fact_check_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (!settings?.perplexity_api_key) {
            console.warn('Fact check settings not found or API key missing');
            return [];
        }

        const results: FactCheckResult[] = [];
        const batchSize = 5;
        const itemsToCheck = items.slice(0, settings.max_items_to_check || 10);

        // モデル名の決定: 引数 > 設定 > デフォルト
        const selectedModel = modelName || settings.model_name || 'sonar';

        for (let i = 0; i < itemsToCheck.length; i += batchSize) {
            const batch = itemsToCheck.slice(i, i + batchSize);
            const claimsList = batch.map((item, idx) =>
                `${idx + 1}. 【主張】${item.claim}\n   【文脈】${item.context}`
            ).join('\n\n');

            const prompt = `以下のリストにある各主張について、最新のWeb情報を元に一括でファクトチェックしてください。

【検証リスト】
${claimsList}

【関連キーワード】${keyword}

【回答形式】
JSON配列で以下の形式で返してください:
[
  {
    "claim_number": 1,
    "verdict": "correct | incorrect | partially_correct | unverified",
    "confidence": 0-100,
    "correct_info": "正しい情報(誤りの場合のみ)",
    "explanation": "説明",
    "source_url": "出典URL"
  }
]`;

            try {
                const response = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${settings.perplexity_api_key}`
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        messages: [
                            { role: 'system', content: 'あなたは事実確認の専門家です。提供された情報の真偽を検証し、信頼できる出典を示してください。' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1
                    })
                });

                if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

                const data = await response.json();
                const content = data.choices[0].message.content;

                let batchResults;
                try {
                    const jsonMatch = content.match(/\[[\s\S]*\]/);
                    batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content);
                } catch {
                    batchResults = batch.map((_, idx) => ({
                        claim_number: idx + 1,
                        verdict: 'unverified',
                        confidence: 0,
                        explanation: 'パース失敗',
                        source_url: ''
                    }));
                }

                batch.forEach((item, idx) => {
                    const result = batchResults.find((r: any) => r.claim_number === idx + 1) || batchResults[idx];
                    if (result) {
                        results.push({
                            claim: item.claim,
                            verdict: result.verdict,
                            confidence: result.confidence,
                            correctInfo: result.correct_info,
                            sourceUrl: result.source_url,
                            explanation: result.explanation
                        });
                    }
                });

                if (i + batchSize < itemsToCheck.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error('Batch verification error:', error);
            }
        }

        return results;
    }
};
