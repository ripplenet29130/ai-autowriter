
// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
    normalizeAiModel,
    supportsTemperature,
} from "../../../src/shared/aiModelCatalog.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ログインユーザーのアクセストークンのみ許可する。
// anon key は verify_jwt を通過してしまうため、auth.getUser() で実ユーザーを確認する。
const authenticateRequest = async (req: Request): Promise<{ userId: string } | { errorResponse: Response }> => {
    const unauthorized = (message: string) => ({
        errorResponse: new Response(JSON.stringify({ error: message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401,
        }),
    });

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        return unauthorized('Missing Authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
        return {
            errorResponse: new Response(JSON.stringify({ error: 'Server auth configuration is missing' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }),
        };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return unauthorized('Invalid or expired session token');
    }

    return { userId: data.user.id };
};

// configId から API キーをサーバー側で解決する。
// キーをブラウザに往復させないための経路。所有者本人か admin のみ利用できる。
const resolveConfigApiKey = async (configId: string, userId: string): Promise<string> => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Server configuration is missing for API key resolution');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: config, error } = await admin
        .from('ai_configs')
        .select('user_id, api_key')
        .eq('id', configId)
        .maybeSingle();

    if (error || !config?.api_key) {
        throw new Error('AI config was not found or has no API key');
    }

    if (config.user_id !== userId) {
        const { data: profile } = await admin
            .from('profiles')
            .select('role')
            .eq('user_id', userId)
            .maybeSingle();

        if (profile?.role !== 'admin') {
            throw new Error('You do not have permission to use this AI config');
        }
    }

    return config.api_key;
};

// Perplexity キーをサーバー側で解決する。
// クライアントの従来の解決順（fact_check_settings → app_settings）を踏襲し、最後に環境変数を見る。
const resolvePerplexityApiKey = async (userId: string): Promise<string> => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Server configuration is missing for API key resolution');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: settings } = await admin
        .from('fact_check_settings')
        .select('perplexity_api_key')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (settings?.perplexity_api_key) return settings.perplexity_api_key;

    const { data: appSetting } = await admin
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'perplexity_api_key')
        .maybeSingle();
    if (appSetting?.value) return String(appSetting.value);

    const envKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (envKey) return envKey;

    throw new Error('Perplexity API key is not configured');
};

serve(async (req) => {
    // CORS handling
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authResult = await authenticateRequest(req);
    if ('errorResponse' in authResult) {
        return authResult.errorResponse;
    }

    try {
        const body = await req.json();
        const { provider, type, apiKey, configId, model, temperature, maxTokens, prompt, messages, ...otherParams } = body;

        console.log(`🤖 AI Proxy Request (Supabase): ${type || provider} (${model || 'no-model'})`);

        // API Key Handling
        // 推奨経路: configId を受け取り、DB からサーバー側で解決する（キーがブラウザを往復しない）。
        // 後方互換: 旧フロントの apiKey 直送も受け付ける。どちらも無ければ環境変数フォールバック。

        let targetApiKey = apiKey;
        if (configId) {
            targetApiKey = await resolveConfigApiKey(String(configId), authResult.userId);
        }
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

            case 'perplexity': {
                // apiKey 未指定時はログインユーザーの設定からサーバー側で解決する
                const perplexityKey = targetApiKey || await resolvePerplexityApiKey(authResult.userId);
                responseData = await callPerplexity(
                    perplexityKey,
                    model,
                    temperature,
                    messages || [{ role: "user", content: prompt }],
                    otherParams.response_format,
                );
                break;
            }

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
        const message = error instanceof Error ? error.message : 'Unexpected proxy error';
        return new Response(JSON.stringify({ error: message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});

// --- Helper Functions ---

async function callOpenAI(apiKey: string, model: string, temperature: number, max_tokens: number, messages: any[]) {
    if (!apiKey) throw new Error("OpenAI API Key is missing");
    const modelName = normalizeAiModel('openai', model);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: modelName,
            max_completion_tokens: max_tokens ?? 16384,
            messages: messages,
            ...(supportsTemperature('openai', modelName) ? { temperature: temperature ?? 0.7 } : {}),
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
    const modelName = normalizeAiModel('claude', model);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: modelName,
            max_tokens: max_tokens ?? 16384,
            messages: messages,
            ...(supportsTemperature('claude', modelName) ? { temperature: temperature ?? 0.7 } : {}),
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

    const modelName = normalizeAiModel('gemini', model);
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

async function callPerplexity(apiKey: string, model: string, temperature: number, messages: any[], responseFormat?: unknown) {
    if (!apiKey) throw new Error("Perplexity API Key is missing");

    const doCall = async (includeFormat: boolean) => {
        const response = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: temperature ?? 0.1,
                ...(includeFormat && responseFormat ? { response_format: responseFormat } : {}),
            }),
            signal: AbortSignal.timeout(90 * 1000),
        });
        const data = await response.json();
        return { response, data };
    };

    let { response, data } = await doCall(true);

    // structured output 未対応モデルの 400 は、構造化出力なしで一度だけ再試行する
    if (!response.ok && response.status === 400 && responseFormat) {
        console.warn('Perplexity rejected response_format; retrying without structured output');
        ({ response, data } = await doCall(false));
    }

    if (!response.ok) {
        throw new Error(`Perplexity API error (${response.status}): ${JSON.stringify(data)}`);
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
