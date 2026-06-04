import { supabase } from './supabaseClient';
import { getCurrentAccountId } from './accountScope';

export interface ImageGenerationOptions {
    prompt: string;
    model?: string;
    aspectRatio?: '1:1' | '16:9' | '9:16';
}

export interface GeneratedImage {
    base64Data: string;
    mimeType: string;
}

/**
 * nanobanana (Gemini Image) and DALL-E 3 image generation service
 */
export const imageGenerationService = {
    GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',

    async generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
        try {
            if (!supabase) {
                throw new Error('Supabase client is not initialized');
            }

            const accountId = getCurrentAccountId();
            let query = supabase
                .from('ai_configs')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1);

            if (accountId) {
                query = query.eq('account_id', accountId);
            }

            const { data: activeConfig, error: configError } = await query.maybeSingle();

            if (configError) throw configError;

            const provider = activeConfig?.image_provider || 'nanobanana';

            if (provider === 'dalle3') {
                return await this.generateWithDalle(options, activeConfig?.api_key || '');
            }

            return await this.generateWithGemini(options, activeConfig?.api_key || '');
        } catch (error: any) {
            console.error('Image generation error:', error);
            throw new Error(`画像生成に失敗しました: ${error.message}`);
        }
    },

    async generateWithGemini(options: ImageGenerationOptions, configApiKey: string): Promise<GeneratedImage> {
        const apiKey = configApiKey || import.meta.env.VITE_GEMINI_API_KEY || '';

        if (!apiKey) {
            throw new Error('Gemini APIキーが見つかりません。');
        }

        const model = options.model || this.GEMINI_IMAGE_MODEL;
        const aspectRatioInstruction =
            options.aspectRatio === '16:9'
                ? '16:9の横長画像で生成してください。'
                : options.aspectRatio === '9:16'
                    ? '9:16の縦長画像で生成してください。'
                    : '1:1の正方形画像で生成してください。';

        const promptWithAspectRatio = `${options.prompt}\n\n${aspectRatioInstruction}`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptWithAspectRatio }] }],
                    generationConfig: {
                        temperature: 0.4,
                        topK: 32,
                        topP: 1,
                        maxOutputTokens: 256,
                    },
                    responseModalities: ['TEXT', 'IMAGE'],
                }),
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData?.error?.message || response.statusText || 'Unknown error';
            const isQuotaError =
                response.status === 429 ||
                /RESOURCE_EXHAUSTED/i.test(message) ||
                /quota exceeded/i.test(message);

            if (isQuotaError) {
                const retryMatch = String(message).match(/Please retry in\s+([\d.]+)s/i);
                const retrySeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null;
                const retryHint = retrySeconds
                    ? `約${retrySeconds}秒後に再試行してください。`
                    : 'しばらく待ってから再試行してください。';
                throw new Error(`Gemini無料枠の上限に達しました。${retryHint}`);
            }

            throw new Error(`Gemini API error: ${message}`);
        }

        const data = await response.json();
        const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData || part.inline_data);
        const inlineData = imagePart?.inlineData || imagePart?.inline_data;

        if (!inlineData?.data) {
            throw new Error('画像データを取得できませんでした。');
        }

        return {
            base64Data: inlineData.data,
            mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
        };
    },

    async generateWithDalle(options: ImageGenerationOptions, configApiKey: string): Promise<GeneratedImage> {
        const apiKey = configApiKey || import.meta.env.VITE_OPENAI_API_KEY || '';

        if (!apiKey) {
            throw new Error('OpenAI APIキーが見つかりません。');
        }

        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: options.prompt,
                n: 1,
                size: options.aspectRatio === '16:9' ? '1792x1024' : options.aspectRatio === '9:16' ? '1024x1792' : '1024x1024',
                response_format: 'b64_json',
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const b64Data = data.data?.[0]?.b64_json;

        if (!b64Data) {
            throw new Error('画像データが返されませんでした。');
        }

        return {
            base64Data: b64Data,
            mimeType: 'image/png',
        };
    },

    createImagePrompt(heading: string, keywords: string[] = []): string {
        const keywordContext = keywords.length > 0 ? `${keywords.join('、')}に関連する` : '';
        return `${heading} ${keywordContext}内容を表現するリアルな画像。モダンでプロフェッショナルなスタイル、明るく鮮やかな色使い。16:9の横長構図。`;
    },
};
