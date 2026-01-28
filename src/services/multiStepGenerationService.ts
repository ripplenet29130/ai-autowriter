import { v4 as uuidv4 } from 'uuid';
import {
    Article,
    ArticleOutline,
    OutlineSection,
    TrendAnalysisResult,
    SectionGenerationRequest,
    OutlineGenerationRequest
} from '../types';
import { realTrendAnalysisService } from './realTrendAnalysisService';
import { outlineGenerationService } from './outlineGenerationService';
import { titleGenerationService } from './titleGenerationService';
import { aiService } from './aiService';

/**
 * マルチステップ記事生成サービス
 * トレンド分析 → アウトライン生成 → セクション別本文生成 → 記事組み立て
 */
export class MultiStepGenerationService {
    /**
     * Step 1: トレンド分析
     */
    async analyzeTrends(keywords: string[]): Promise<TrendAnalysisResult> {
        try {
            console.log('Step 1: トレンド分析開始', keywords);
            const keyword = keywords[0];

            try {
                const trendData = await realTrendAnalysisService.analyzeTrends(keyword, {
                    region: 'JP',
                    timeframe: 'today 12-m'
                });
                console.log('Step 1: トレンド分析完了（実データ）', trendData);
                return trendData;
            } catch (apiError) {
                console.warn('実APIでのトレンド分析に失敗。モックデータを使用します:', apiError);
                const { trendAnalysisService } = await import('./trendAnalysisService');
                const mockTrendData = await trendAnalysisService.analyzeTrends(keyword);
                return mockTrendData;
            }
        } catch (error) {
            console.error('トレンド分析エラー:', error);
            throw new Error('トレンド分析に失敗しました');
        }
    }

    /**
     * Step 2: タイトル案を生成
     */
    async generateTitles(
        trendData: TrendAnalysisResult,
        keywordPreferences?: Record<string, import('../types').KeywordPreference>
    ): Promise<import('../types').TitleSuggestion[]> {
        try {
            console.log('Step 2: タイトル案生成開始');
            return await titleGenerationService.generateTitleSuggestions(trendData, 5, keywordPreferences);
        } catch (error) {
            console.error('タイトル生成エラー:', error);
            throw new Error('タイトル生成に失敗しました');
        }
    }

    /**
     * Step 3: AIによるアウトライン生成
     */
    async generateOutline(
        keywords: string[],
        trendData: TrendAnalysisResult,
        options?: {
            targetLength?: 'short' | 'medium' | 'long';
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            focusTopics?: string[];
            selectedTitle?: string;
            keywordPreferences?: Record<string, import('../types').KeywordPreference>;
            customInstructions?: string;
        }
    ): Promise<ArticleOutline> {
        try {
            console.log('Step 3: アウトライン生成開始');

            const request: OutlineGenerationRequest = {
                keywords,
                trendData,
                targetLength: options?.targetLength || 'medium',
                tone: options?.tone || 'professional',
                focusTopics: options?.focusTopics,
                selectedTitle: options?.selectedTitle, // これを追加
                keywordPreferences: options?.keywordPreferences,
                customInstructions: options?.customInstructions
            };

            const outline = await outlineGenerationService.generateOutline(request);

            if (options?.selectedTitle) {
                outline.title = options.selectedTitle;
            }

            // キーワード設定を保存しておく
            outline.keywordPreferences = options?.keywordPreferences;

            console.log('Step 3: アウトライン生成完了', outline);
            return outline;
        } catch (error) {
            console.error('アウトライン生成エラー:', error);
            throw new Error('アウトライン生成に失敗しました');
        }
    }

    /**
     * Step 4: セクション別に本文を生成
     */
    async generateSections(
        outline: ArticleOutline,
        options?: {
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            customInstructions?: string;
            onProgress?: (section: OutlineSection, progress: number) => void;
        }
    ): Promise<Map<string, string>> {
        try {
            console.log('Step 4: セクション別本文生成開始');

            const sectionContents = new Map<string, string>();
            const totalSections = outline.sections.length;

            // 全体構成をテキスト化してAIに渡せるようにする
            const totalOutlineStr = outline.sections
                .map(s => `${s.level === 1 ? 'H1: ' : s.level === 2 ? 'H2: ' : 'H3: '}${s.title}`)
                .join('\n');

            let accumulatedContent = '';

            for (let i = 0; i < outline.sections.length; i++) {
                const section = outline.sections[i];

                // 開始を通知
                if (options?.onProgress) {
                    const progress = (i / totalSections) * 100;
                    options.onProgress(section, progress);
                }

                const content = await this.generateSection({
                    section,
                    outline,
                    previousSections: outline.sections.slice(0, i),
                    tone: options?.tone || 'professional',
                    // ハイブリッド・コンテキスト用の追加情報
                    totalOutline: totalOutlineStr,
                    previousContent: accumulatedContent,
                    customInstructions: options?.customInstructions
                } as any); // 型定義を拡張するかキャスト

                sectionContents.set(section.id, content);
                section.content = content;
                section.isGenerated = true;

                // 文脈維持用に今回の内容を蓄積（長すぎるとプロンプトを圧迫するので直近分のみに絞るなどの調整も可）
                accumulatedContent += `\n\n${content}`;

                // 完了を通知
                if (options?.onProgress) {
                    const progress = ((i + 1) / totalSections) * 100;
                    options.onProgress(section, progress);
                }

                console.log(`セクション ${i + 1}/${totalSections} 生成完了:`, section.title);
            }

            return sectionContents;
        } catch (error) {
            console.error('セクション生成エラー:', error);
            throw new Error('セクション生成に失敗しました');
        }
    }

    /**
     * 個別セクションの本文を生成
     */
    async generateSection(request: SectionGenerationRequest & { totalOutline?: string; previousContent?: string; customInstructions?: string }): Promise<string> {
        const { section, outline, previousSections, tone, totalOutline, previousContent, customInstructions } = request;

        try {
            const primaryKeyword = outline.keyword;
            const relatedKeywords = outline.trendData?.relatedKeywords?.slice(0, 5) || [];
            const effectiveKeywords = Array.from(new Set([primaryKeyword, ...relatedKeywords, ...(section.keywords || [])]));

            const result = await aiService.generateArticle({
                generationType: 'section',
                topic: section.title,
                sectionTitle: section.title,
                articleTitle: outline.title,
                selectedTitle: outline.title,
                keywords: effectiveKeywords,
                tone,
                targetWordCount: section.estimatedWordCount, // 推定文字数をターゲットにする
                totalOutline: totalOutline,
                previousContent: previousContent,
                includeIntroduction: false,
                includeConclusion: false,
                includeSources: false,
                keywordPreferences: outline.keywordPreferences,
                length: 'medium', // フォールバック用
                isLead: section.isLead, // リード文フラグを渡す
                customInstructions: customInstructions
            });

            // 見出しレベルに応じたプレフィックス（通常はH2）
            const prefix = section.level === 1 ? '## ' : section.level === 2 ? '## ' : section.level === 3 ? '### ' : '#### ';

            // 本文から冒頭の重複した見出しテキストなどを除去（念のため）
            let cleanContent = result.content.trim();
            // もしAIが「## 見出し」の形式で出力してしまったら除去
            if (cleanContent.startsWith('#')) {
                cleanContent = cleanContent.replace(/^#+\s*.*?\n/, '').trim();
            }

            // リード文の場合は見出しを付与しない
            if (section.isLead) {
                return cleanContent;
            }

            return `${prefix}${section.title}\n\n${cleanContent}`;
        } catch (error) {
            console.error('セクション生成エラー:', error);
            return this.generateFallbackContent(section);
        }
    }

    /**
     * 完全な記事を組み立て
     */
    async assembleArticle(
        outline: ArticleOutline,
        sectionContents: Map<string, string>
    ): Promise<Article> {
        try {
            const contentParts: string[] = [];
            outline.sections.forEach(section => {
                const content = sectionContents.get(section.id);
                if (content) {
                    contentParts.push(content);
                }
            });

            const fullContent = contentParts.join('\n\n');

            const allKeywords = [outline.keyword, ...(outline.trendData?.relatedKeywords.slice(0, 4) || [])];
            const filteredKeywords = allKeywords.filter(kw => {
                if (outline.keywordPreferences && outline.keywordPreferences[kw] === 'ng') {
                    return false;
                }
                return true;
            });

            const article: Article = {
                id: uuidv4(),
                title: outline.title,
                content: fullContent,
                excerpt: this.generateExcerpt(fullContent),
                keywords: filteredKeywords,
                category: '',
                status: 'draft',
                generatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                wordCount: fullContent.length,
                seoScore: 0, // 以前は計算していたが、不要になったため固定値または削除検討（型定義に合わせて保持）
                readingTime: 0, // 同上
                trendData: outline.trendData
            };

            return article;
        } catch (error) {
            console.error('記事組み立てエラー:', error);
            throw new Error('記事の組み立てに失敗しました');
        }
    }

    /**
     * 自動モード用
     */
    async generateArticleAuto(
        keywords: string[],
        options?: {
            targetLength?: 'short' | 'medium' | 'long';
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            onStepComplete?: (step: number, data: any) => void;
        }
    ): Promise<Article> {
        // Step 1: 分析
        const trendData = await this.analyzeTrends(keywords);
        options?.onStepComplete?.(1, trendData);

        // Step 2: タイトル
        const titles = await this.generateTitles(trendData);
        const selectedTitle = titles[0]?.title || `${keywords[0]}について`;
        options?.onStepComplete?.(2, titles);

        // Step 3: アウトライン
        const outline = await this.generateOutline(keywords, trendData, {
            targetLength: options?.targetLength,
            tone: options?.tone,
            selectedTitle
        });
        options?.onStepComplete?.(3, outline);

        // Step 4: 本文
        const sectionContents = await this.generateSections(outline, {
            tone: options?.tone
        });

        const article = await this.assembleArticle(outline, sectionContents);
        return article;
    }

    private estimateLengthCategory(wordCount: number): 'short' | 'medium' | 'long' {
        if (wordCount < 400) return 'short';
        if (wordCount < 800) return 'medium';
        return 'long';
    }

    private generateFallbackContent(section: OutlineSection): string {
        return `## ${section.title}\n\n${section.description || '執筆中です。'}`;
    }

    private generateExcerpt(content: string): string {
        const clean = content.replace(/^#+\s+/gm, '').trim();
        const first = clean.split('\n\n')[0];
        return first.length > 150 ? first.substring(0, 150) + '...' : first;
    }

    private calculateSEOScore(title: string, content: string, keyword: string): number {
        let score = 50;
        if (title.includes(keyword)) score += 20;
        if (content.length > 2000) score += 30;
        return Math.min(100, score);
    }
}

export const multiStepGenerationService = new MultiStepGenerationService();
