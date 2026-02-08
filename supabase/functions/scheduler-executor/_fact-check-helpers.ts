import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface WordPressConfig {
    id: string;
    name: string;
    url: string;
    username: string;
    password: string; // This maps to 'applicationPassword' in the DB column 'password'
    category: string;
    post_type: string; // Custom post type slug (e.g., 'posts', 'sushirecipe', 'product')
    is_active: boolean;
}

interface Schedule {
    id: string;
    ai_config_id: string;
    wp_config_id: string;
    post_time: string;
    frequency: string;
    status: boolean;
    keyword: string;
    post_status: 'draft' | 'publish';
    start_date?: string;
    end_date?: string;
    chatwork_room_id?: string;
    chatwork_message_template?: string;
    prompt_set_id?: string;
    target_word_count?: number;
    writing_tone?: string;
    enable_fact_check?: boolean;
    fact_check_note?: string;
}

interface AIConfig {
    id: string;
    provider: string;
    api_key: string;
    model: string;
    temperature: number;
    max_tokens: number;
}

interface OutlineSection {
    title: string;
    level: number;
    description: string;
    isLead: boolean;
    estimatedWordCount: number;
}

interface ArticleOutline {
    title: string;
    sections: OutlineSection[];
}

interface FactCheckItem {
    claim: string;
    context: string;
    priority: 'high' | 'normal';
}

interface FactCheckResult {
    claim: string;
    verdict: 'correct' | 'incorrect' | 'partially_correct' | 'unverified';
    confidence: number;
    correctInfo?: string;
    sourceUrl: string;
    explanation: string;
}

// ... rest of the existing code remains the same until the end ...

/**
 * 記事からファクト情報を抽出（正規表現ベース）
 */
async function extractFactsFromContent(
    content: string,
    userMarkedText?: string
): Promise<FactCheckItem[]> {
    const items: FactCheckItem[] = [];

    // ユーザーマーク箇所を最優先で追加 [[]]
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

    // 数値の抽出（例: 「85%」「100万円」「2023年」）
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

    // 日付の抽出
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

    // 優先度でソート（high → normal）
    return items.sort((a, b) => a.priority === 'high' ? -1 : 1);
}

/**
 * Perplexity APIで複数の事実を一括検証（バッチ処理）
 */
async function verifyFactsBatch(
    items: FactCheckItem[],
    apiKey: string,
    keyword: string,
    batchSize: number = 5
): Promise<FactCheckResult[]> {
    const results: FactCheckResult[] = [];

    // バッチに分割
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        // バッチ用プロンプト作成
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
    "correct_info": "正しい情報（誤りの場合のみ）",
    "explanation": "説明",
    "source_url": "出典URL"
  }
]`;

        try {
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'sonar-pro',
                    messages: [
                        {
                            role: 'system',
                            content: 'あなたは事実確認の専門家です。提供された情報の真偽を検証し、信頼できる出典を示してください。'
                        },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3
                })
            });

            if (!response.ok) {
                throw new Error(`Perplexity API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;

            // JSONパース
            let batchResults;
            try {
                // JSON配列を抽出（マークダウンコードブロックを除去）
                const jsonMatch = content.match(/\[[\s\S]*\]/);
                batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content);
            } catch {
                console.error('Failed to parse batch results, treating as unverified');
                batchResults = batch.map((_, idx) => ({
                    claim_number: idx + 1,
                    verdict: 'unverified',
                    confidence: 0,
                    explanation: 'パース失敗',
                    source_url: ''
                }));
            }

            // 結果をマージ
            batch.forEach((item, idx) => {
                const result = batchResults.find((r: any) => r.claim_number === idx + 1) || batchResults[idx];
                results.push({
                    claim: item.claim,
                    verdict: result.verdict,
                    confidence: result.confidence,
                    correctInfo: result.correct_info,
                    sourceUrl: result.source_url,
                    explanation: result.explanation
                });
            });

            // Rate limiting対策: バッチ間で2秒待機
            if (i + batchSize < items.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

        } catch (error: any) {
            console.error(`Batch verification failed for items ${i}-${i + batchSize}:`, error);
            // エラー時は未検証として記録
            batch.forEach(item => {
                results.push({
                    claim: item.claim,
                    verdict: 'unverified',
                    confidence: 0,
                    explanation: `エラー: ${error.message}`,
                    sourceUrl: ''
                });
            });
        }
    }

    return results;
}
