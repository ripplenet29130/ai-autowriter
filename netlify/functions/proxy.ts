
import { Handler } from "@netlify/functions";

export const handler: Handler = async (event) => {
    // CORS handling
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        // provider または type で機能を識別
        // - AI生成: provider (openai, claude, gemini)
        // - 検索: provider (google-search, serpapi)
        // - その他: type (gemini-list)
        const { provider, type, apiKey, model, temperature, maxTokens, prompt, messages, ...otherParams } = body;

        console.log(`🤖 Unified Proxy Request: ${type || provider} (${model || 'no-model'})`);

        if (!apiKey) {
            // gemini-list の場合、params.key で来ることもあるが、統一的に apiKey で受ける想定
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "API key missing" })
            };
        }

        let responseData;

        // 機能分岐
        const actionType = type || provider;

        switch (actionType) {
            // --- AI Generation ---
            case 'openai':
                responseData = await callOpenAI(apiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'claude':
                responseData = await callClaude(apiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'gemini':
                responseData = await callGemini(apiKey, model, temperature, maxTokens, prompt);
                break;

            // --- Search & Utils ---
            case 'google-search':
                // google-search-proxy.ts logic
                responseData = await callGoogleSearch(body);
                break;
            case 'serpapi':
                // serpapi-proxy.ts logic
                responseData = await callSerpApi(body);
                break;
            case 'gemini-list':
                // gemini-list.ts logic
                responseData = await getGeminiModels(apiKey);
                break;

            default:
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: `Unsupported provider/type: ${actionType}` })
                };
        }

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(responseData)
        };

    } catch (error: any) {
        console.error("🔥 Proxy Error:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: error.message || "Internal Server Error", details: error })
        };
    }
};

// --- Helper Functions ---

async function callOpenAI(apiKey: string, model: string, temperature: number, max_tokens: number, messages: any[]) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: model || "gpt-3.5-turbo",
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 16384,
            messages: messages,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
}

async function callClaude(apiKey: string, model: string, temperature: number, max_tokens: number, messages: any[]) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: model || "claude-3-opus-20240229",
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 16384,
            messages: messages,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Claude API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
}

async function callGemini(apiKey: string, model: string, temperature: number, maxTokens: number, prompt: string) {
    const modelName = model || "gemini-pro";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: temperature ?? 0.7,
                maxOutputTokens: maxTokens ?? 16384,
            },
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
}

async function callGoogleSearch(params: any) {
    // google-search-proxy は body のパラメータをクエリパラメータとして転送していた
    // params には provider: 'google-search' などが含まれるが、URLSearchParams は余計なものを無視するか文字列化するだけなので注意
    // 必要なパラメータ: key, cx, q, dateRestrict, etc.
    const { provider, type, ...queryParams } = params;
    const qs = new URLSearchParams(queryParams).toString();
    console.log('Proxying request to Google Custom Search API...');

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${qs}`);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.message || response.statusText);
    }
    return data;
}

async function callSerpApi(params: any) {
    const { provider, type, ...queryParams } = params;
    const qs = new URLSearchParams(queryParams).toString();
    console.log('Proxying request to SerpAPI...');

    const response = await fetch(`https://serpapi.com/search.json?${qs}`);
    const data = await response.json();
    return data;
}

async function getGeminiModels(apiKey: string) {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta1/models?key=${apiKey}`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Failed to fetch models");
    return data;
}
