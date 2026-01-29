
export const handler = async (event: any) => {
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
        const { provider, apiKey, model, temperature, maxTokens, prompt, messages } = body;

        console.log(`🤖 AI Proxy Request: ${provider} (${model})`);

        if (!apiKey) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "API key missing" })
            };
        }

        let responseData;

        switch (provider) {
            case 'openai':
                responseData = await callOpenAI(apiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'claude':
                responseData = await callClaude(apiKey, model, temperature, maxTokens, messages || [{ role: "user", content: prompt }]);
                break;
            case 'gemini':
                responseData = await callGemini(apiKey, model, temperature, maxTokens, prompt);
                break;
            default:
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: `Unsupported provider: ${provider}` })
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
        console.error("🔥 AI Proxy Error:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: error.message || "Internal Server Error" })
        };
    }
};

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
            max_tokens: max_tokens ?? 4000,
            messages: messages,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    // Standardize response extraction if needed here, but returning raw is fine if client handles it
    return data;
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
            max_tokens: max_tokens ?? 4000,
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
                maxOutputTokens: maxTokens ?? 4000,
            },
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    return await response.json();
}
