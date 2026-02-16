import { supabase } from './supabaseClient';

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
 * nanobanana (Gemini Image) を使用した画像生成サービス
 */
export const imageGenerationService = {
    /**
     * 画像を生成 (Gemini Image または DALL-E 3)
     */
    async generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
        try {
            if (!supabase) {
                throw new Error('Supabase client is not initialized');
            }

            // アクティブなAI設定を取得してプロバイダーを確認
            const { data: activeConfig, error: configError } = await supabase
                .from('ai_configs')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (configError) throw configError;

            const provider = activeConfig?.image_provider || 'nanobanana';

            if (provider === 'dalle3') {
                return await this.generateWithDalle(options, activeConfig?.api_key || '');
            } else {
                return await this.generateWithGemini(options, activeConfig?.api_key || '');
            }
        } catch (error: any) {
            console.error('画像生成エラー:', error);
            throw new Error(`画像生成に失敗しました: ${error.message}`);
        }
    },

    /**
     * Gemini Image (nanobanana) で生成
     */
    async generateWithGemini(options: ImageGenerationOptions, configApiKey: string): Promise<GeneratedImage> {
        let apiKey = configApiKey || import.meta.env.VITE_GEMINI_API_KEY || '';

        if (!apiKey) {
            throw new Error('Gemini APIキーが見つかりません。');
        }

        const model = options.model || 'gemini-2.0-flash';
        const aspectRatioInstruction =
            options.aspectRatio === '16:9'
                ? '必ず16:9の横長構図で生成してください。縦長や正方形は禁止です。'
                : options.aspectRatio === '9:16'
                    ? '必ず9:16の縦長構図で生成してください。横長や正方形は禁止です。'
                    : '必ず1:1の正方形構図で生成してください。';

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
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            const message = errorData.error?.message || response.statusText;
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
        const imagePart = data.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);

        if (!imagePart?.inlineData) {
            throw new Error('画像データが見つかりません');
        }

        return {
            base64Data: imagePart.inlineData.data,
            mimeType: imagePart.inlineData.mimeType || 'image/png'
        };
    },

    /**
     * DALL-E 3 で生成
     */
    async generateWithDalle(options: ImageGenerationOptions, configApiKey: string): Promise<GeneratedImage> {
        let apiKey = configApiKey || import.meta.env.VITE_OPENAI_API_KEY || '';

        if (!apiKey) {
            throw new Error('OpenAI APIキーが見つかりません。');
        }

        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "dall-e-3",
                prompt: options.prompt,
                n: 1,
                // DALL-E 3: landscape=1792x1024, portrait=1024x1792
                size: options.aspectRatio === '16:9' ? "1792x1024" : options.aspectRatio === '9:16' ? "1024x1792" : "1024x1024",
                response_format: "b64_json"
            })
        });

        // ※ DALL-E 3の横長サイズは 1792x1024 (landscape) または 1024x1792 (portrait)
        // options.aspectRatio === '16:9' の場合は 1792x1024 にすべきだが、API仕様を確認して調整
        // 正しくは landscape: "1792x1024", portrait: "1024x1792"

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const b64Data = data.data?.[0]?.b64_json;

        if (!b64Data) {
            throw new Error('画像データが返されませんでした');
        }

        return {
            base64Data: b64Data,
            mimeType: 'image/png'
        };
    },

    /**
     * 記事の見出しから画像生成プロンプトを作成
     */
    createImagePrompt(heading: string, keywords: string[] = []): string {
        const keywordContext = keywords.length > 0 ? `、${keywords.join('、')}に関連する` : '';
        return `「${heading}」${keywordContext}内容を表現する高品質なイラスト。モダンでプロフェッショナルなスタイル、明るく鮮やかな色使い、16:9の横長構図。`;
    }
};
