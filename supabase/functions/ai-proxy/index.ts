
// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // CORS handling
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const { provider, type, apiKey, model, temperature, maxTokens, prompt, messages, ...otherParams } = body;

        console.log(`🤖 AI Proxy Request (Supabase): ${type || provider} (${model || 'no-model'})`);

        // API Key Handling
        // クライアントから送られてきた apiKey を優先するが、
        // まだ実装されていない場合は環境変数から取得（セキュリティ的には環境変数がベスト）
        // 今回はNetlifyからの移行なので、クライアントからキーが送られてくるロジックを維持しつつ、
        // サーバー側の環境変数も使えるようにフォールバックを入れる。

        let targetApiKey = apiKey;
        if (!targetApiKey) {
            if (provider === 'openai') targetApiKey = Deno.env.get('OPENAI_API_KEY');
            if (provider === 'claude') targetApiKey = Deno.env.get('ANTHROPIC_API_KEY');
            if (provider === 'gemini') targetApiKey = Deno.env.get('GEMINI_API_KEY');
            if (provider === 'serpapi') targetApiKey = Deno.env.get('SERPAPI_API_KEY');
            if (provider === 'google-search') targetApiKey = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
        }

        if (!targetApiKey && (type !== 'gemini-list')) {
            // google-search, serpapi などパラメータに key が含まれる場合もあるので厳密なチェックはプロバイダごとのロジックに任せる場合もあるが
            // ここでは簡易チェック
            // google-search は params.key で来る
        }

        let responseData;
        const actionType = type || provider;

        switch (actionType) {
            // --- AI Generation ---
            case 'openai':
                responseData = await callOpenAI(targetApiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'claude':
                responseData = await callClaude(targetApiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'gemini':
                responseData = await callGemini(targetApiKey, model, temperature, maxTokens, prompt);
                break;

            // --- Search & Utils ---
            case 'google-search':
                // google-search は body (otherParams) に key, cx が入っている想定だが
                // 環境変数からの注入もサポートする
                const searchParams = { ...otherParams };
                if (!searchParams.key) searchParams.key = Deno.env.get('GOOGLE_CUSTOM_SEARCH_API_KEY');
                if (!searchParams.cx) searchParams.cx = Deno.env.get('GOOGLE_CUSTOM_SEARCH_ENGINE_ID');
                responseData = await callGoogleSearch(searchParams);
                break;

            case 'serpapi':
                const serpParams = { ...otherParams };
                if (!serpParams.api_key) serpParams.api_key = Deno.env.get('SERPAPI_API_KEY');
                responseData = await callSerpApi(serpParams);
                break;

            case 'gemini-list':
                let listKey = apiKey || Deno.env.get('GEMINI_API_KEY');
                responseData = await getGeminiModels(listKey);
                break;

            default:
                throw new Error(`Unsupported provider/type: ${actionType}`);
        }

        return new Response(JSON.stringify(responseData), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error("🔥 Proxy Error:", error);
        return new Response(JSON.stringify({ error: error.message, details: error }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});

// --- Helper Functions ---

async function callOpenAI(apiKey: string, model: string, temperature: number, max_tokens: number, messages: any[]) {
    if (!apiKey) throw new Error("OpenAI API Key is missing");

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

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`OpenAI API error (${response.status}): ${JSON.stringify(data)}`);
    }
    return data;
}

async function callClaude(apiKey: string, model: string, temperature: number, max_tokens: number, messages: any[]) {
    if (!apiKey) throw new Error("Anthropic API Key is missing");

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

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Claude API error (${response.status}): ${JSON.stringify(data)}`);
    }
    return data;
}

async function callGemini(apiKey: string, model: string, temperature: number, maxTokens: number, prompt: string) {
    if (!apiKey) throw new Error("Gemini API Key is missing");

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

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(data)}`);
    }
    return data;
}

async function callGoogleSearch(params: any) {
    if (!params.key || !params.cx) throw new Error("Google Search API Key or CX missing");

    const qs = new URLSearchParams(params).toString();
    console.log('Proxying request to Google Custom Search API...');

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${qs}`);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.message || response.statusText);
    }
    return data;
}

async function callSerpApi(params: any) {
    if (!params.api_key) throw new Error("SerpAPI Key missing");

    const qs = new URLSearchParams(params).toString();
    console.log('Proxying request to SerpAPI...');

    const response = await fetch(`https://serpapi.com/search.json?${qs}`);
    const data = await response.json();
    return data;
}

async function getGeminiModels(apiKey: string) {
    if (!apiKey) throw new Error("Gemini API Key missing");
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta1/models?key=${apiKey}`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Failed to fetch models");
    return data;
}
