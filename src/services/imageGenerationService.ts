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
     * Gemini Imageで画像を生成
     */
    async generateImage(options: ImageGenerationOptions): Promise<GeneratedImage> {
        try {
            if (!supabase) {
                throw new Error('Supabase client is not initialized');
            }

            // Gemini API設定を取得
            let apiKey = '';

            const { data: aiConfig, error } = await supabase
                .from('ai_configs')
                .select('*')
                .eq('provider', 'gemini')
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

            if (aiConfig?.api_key) {
                apiKey = aiConfig.api_key;
            } else {
                // DBに設定がない場合は環境変数を確認
                apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
            }

            if (!apiKey) {
                throw new Error('Gemini APIキーが見つかりません。設定画面でGeminiを有効にするか、環境変数VITE_GEMINI_API_KEYを設定してください。');
            }

            const model = options.model || 'gemini-2.0-flash'; // 画像生成は2.0 Flash以降を推奨

            // Gemini APIを呼び出し
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                parts: [
                                    {
                                        text: options.prompt
                                    }
                                ]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.4,
                            topK: 32,
                            topP: 1,
                            maxOutputTokens: 8192,
                        }
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();

            // レスポンスから画像データを抽出
            const candidate = data.candidates?.[0];
            if (!candidate) {
                throw new Error('画像生成に失敗しました: レスポンスが空です');
            }

            const imagePart = candidate.content?.parts?.find((part: any) => part.inlineData);
            if (!imagePart?.inlineData) {
                throw new Error('画像生成に失敗しました: 画像データが見つかりません');
            }

            return {
                base64Data: imagePart.inlineData.data,
                mimeType: imagePart.inlineData.mimeType || 'image/png'
            };
        } catch (error: any) {
            console.error('画像生成エラー:', error);
            throw new Error(`画像生成に失敗しました: ${error.message}`);
        }
    },

    /**
     * 記事の見出しから画像生成プロンプトを作成
     */
    createImagePrompt(heading: string, keywords: string[] = []): string {
        const keywordContext = keywords.length > 0 ? `、${keywords.join('、')}に関連する` : '';
        return `「${heading}」${keywordContext}内容を表現する高品質なイラスト。モダンでプロフェッショナルなスタイル、明るく鮮やかな色使い、16:9の横長構図。`;
    }
};
