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
import { generateArticleFromOutlineWithSharedCore } from '../shared/articleGenerationCore';

/**
 * 繝槭Ν繝√せ繝・ャ繝苓ｨ倅ｺ狗函謌舌し繝ｼ繝薙せ
 * 繝医Ξ繝ｳ繝牙・譫・竊・繧｢繧ｦ繝医Λ繧､繝ｳ逕滓・ 竊・繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ蛻･譛ｬ譁・函謌・竊・險倅ｺ狗ｵ・∩遶九※
 */
export class MultiStepGenerationService {
    private formatReadableParagraphs(content: string): string {
        const text = (content || '').trim();
        if (!text) return '';

        const blocks = text.split(/\n{2,}/);
        const formattedBlocks = blocks
            .map((block) => {
                const trimmed = block.trim();
                if (!trimmed) return '';
                if (/^(```|#{1,6}\s|[-*]\s|\d+\.\s|>\s|\|)/m.test(trimmed)) {
                    return trimmed;
                }

                return trimmed
                    .replace(/。(?=\S)/g, '。\n')
                    .replace(/！(?=\S)/g, '！\n')
                    .replace(/？(?=\S)/g, '？\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            })
            .filter(Boolean);

        return formattedBlocks.join('\n\n').trim();
    }

    private isSummaryTitle(title: string): boolean {
        const normalized = (title || '').trim().toLowerCase();
        return (
            normalized.includes('まとめ') ||
            normalized.includes('結論') ||
            normalized.includes('おわりに') ||
            normalized.includes('総括') ||
            normalized.includes('最後に') ||
            normalized.includes('summary') ||
            normalized.includes('conclusion')
        );
    }

    private ensureFinalSummarySection(outline: ArticleOutline): ArticleOutline {
        const sections = [...outline.sections];
        const existingIndex = sections.findIndex((s) => this.isSummaryTitle(s.title));

        const totalWords = Math.max(
            0,
            sections.reduce((sum, section) => sum + (section.estimatedWordCount || 0), 0)
        );
        const summaryWords = Math.max(200, Math.round(totalWords * 0.12));

        let summarySection: OutlineSection;
        if (existingIndex >= 0) {
            summarySection = { ...sections[existingIndex] };
            sections.splice(existingIndex, 1);
            summarySection.title = 'まとめ';
            summarySection.level = 2;
            summarySection.description = summarySection.description || '記事全体の要点を整理し、次の行動を示します。';
            summarySection.estimatedWordCount = Math.max(summarySection.estimatedWordCount || 0, summaryWords);
        } else {
            summarySection = {
                id: uuidv4(),
                title: 'まとめ',
                level: 2,
                description: '記事全体の要点を整理し、次の行動を示します。',
                estimatedWordCount: summaryWords,
                order: sections.length,
                isGenerated: false
            };
        }

        sections.push(summarySection);
        const normalizedSections = sections.map((section, index) => ({ ...section, order: index }));

        return {
            ...outline,
            sections: normalizedSections
        };
    }

    /**
     * Step 1: 繝医Ξ繝ｳ繝牙・譫・
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
                console.log('Step 1: トレンド分析結果', trendData);
                return trendData;
            } catch (apiError) {
                console.warn('Trend API failed. Falling back to mock trend data.', apiError);
                const { trendAnalysisService } = await import('./trendAnalysisService');
                const mockTrendData = await trendAnalysisService.analyzeTrends(keyword);
                return mockTrendData;
            }
        } catch (error) {
            console.error('Trend analysis failed:', error);
            throw new Error('トレンド分析に失敗しました');
        }
    }

    /**
     * Step 2: 繧ｿ繧､繝医Ν譯医ｒ逕滓・
     */
    async generateTitles(
        trendData: TrendAnalysisResult,
        keywordPreferences?: Record<string, import('../types').KeywordPreference>
    ): Promise<import('../types').TitleSuggestion[]> {
        try {
            console.log('Step 2: タイトル生成開始');
            return await titleGenerationService.generateTitleSuggestions(trendData, 5, keywordPreferences);
        } catch (error) {
            console.error('Title generation failed:', error);
            throw new Error('タイトル生成に失敗しました');
        }
    }

    /**
     * Step 3: AI縺ｫ繧医ｋ繧｢繧ｦ繝医Λ繧､繝ｳ逕滓・
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
            targetWordCount?: number; // 霑ｽ蜉
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
                selectedTitle: options?.selectedTitle, // 縺薙ｌ繧定ｿｽ蜉
                keywordPreferences: options?.keywordPreferences,
                customInstructions: options?.customInstructions,
                targetWordCount: options?.targetWordCount // 霑ｽ蜉
            };

            let outline = await outlineGenerationService.generateOutline(request);

            if (options?.selectedTitle) {
                outline.title = options.selectedTitle;
            }

            // 繧ｭ繝ｼ繝ｯ繝ｼ繝芽ｨｭ螳壹ｒ菫晏ｭ倥＠縺ｦ縺翫￥
            outline.keywordPreferences = options?.keywordPreferences;
            outline = this.ensureFinalSummarySection(outline);

            console.log('Step 3: アウトライン生成完了', outline);
            return outline;
        } catch (error) {
            console.error('Outline generation failed:', error);
            throw new Error('アウトライン生成に失敗しました');
        }
    }

    /**
     * Step 4: 繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ蛻･縺ｫ譛ｬ譁・ｒ逕滓・
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
            console.log('Step 4: セクション本文生成開始');

            const sectionContents = new Map<string, string>();
            const totalSections = outline.sections.length;

            // 蜈ｨ菴捺ｧ区・繧偵ユ繧ｭ繧ｹ繝亥喧縺励※AI縺ｫ貂｡縺帙ｋ繧医≧縺ｫ縺吶ｋ
            const totalOutlineStr = outline.sections
                .map(s => `${s.level === 1 ? 'H1: ' : s.level === 2 ? 'H2: ' : 'H3: '}${s.title}`)
                .join('\n');

            let accumulatedContent = '';

            for (let i = 0; i < outline.sections.length; i++) {
                const section = outline.sections[i];

                // 髢句ｧ九ｒ騾夂衍
                if (options?.onProgress) {
                    const progress = (i / totalSections) * 100;
                    options.onProgress(section, progress);
                }

                const content = await this.generateSection({
                    section,
                    outline,
                    previousSections: outline.sections.slice(0, i),
                    tone: options?.tone || 'professional',
                    // 繝上う繝悶Μ繝・ラ繝ｻ繧ｳ繝ｳ繝・く繧ｹ繝育畑縺ｮ霑ｽ蜉諠・ｱ
                    totalOutline: totalOutlineStr,
                    previousContent: accumulatedContent,
                    customInstructions: options?.customInstructions
                } as any); // 蝙句ｮ夂ｾｩ繧呈僑蠑ｵ縺吶ｋ縺九く繝｣繧ｹ繝・

                sectionContents.set(section.id, content);
                section.content = content;
                section.isGenerated = true;

                // 譁・ц邯ｭ謖∫畑縺ｫ莉雁屓縺ｮ蜀・ｮｹ繧定塘遨搾ｼ磯聞縺吶℃繧九→繝励Ο繝ｳ繝励ヨ繧貞悸霑ｫ縺吶ｋ縺ｮ縺ｧ逶ｴ霑大・縺ｮ縺ｿ縺ｫ邨槭ｋ縺ｪ縺ｩ縺ｮ隱ｿ謨ｴ繧ょ庄・・
                accumulatedContent += `\n\n${content}`;

                // 螳御ｺ・ｒ騾夂衍
                if (options?.onProgress) {
                    const progress = ((i + 1) / totalSections) * 100;
                    options.onProgress(section, progress);
                }

                console.log(`Section ${i + 1}/${totalSections} generated`, section.title);
            }

            return sectionContents;
        } catch (error) {
            console.error('Section generation failed:', error);
            throw new Error('セクション生成に失敗しました');
        }
    }

    /**
     * 蛟句挨繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ縺ｮ譛ｬ譁・ｒ逕滓・
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
                targetWordCount: section.estimatedWordCount, // 謗ｨ螳壽枚蟄玲焚繧偵ち繝ｼ繧ｲ繝・ヨ縺ｫ縺吶ｋ
                totalOutline: totalOutline,
                previousContent: previousContent,
                includeIntroduction: false,
                includeConclusion: false,
                includeSources: false,
                keywordPreferences: outline.keywordPreferences,
                length: 'medium', // 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ逕ｨ
                isLead: section.isLead, // 繝ｪ繝ｼ繝画枚繝輔Λ繧ｰ繧呈ｸ｡縺・
                customInstructions: customInstructions
            });

            // 隕句・縺励Ξ繝吶Ν縺ｫ蠢懊§縺溘・繝ｬ繝輔ぅ繝・け繧ｹ・磯壼ｸｸ縺ｯH2・・
            const prefix = '## ';

            // 譛ｬ譁・°繧牙・鬆ｭ縺ｮ驥崎､・＠縺溯ｦ句・縺励ユ繧ｭ繧ｹ繝医↑縺ｩ繧帝勁蜴ｻ・亥ｿｵ縺ｮ縺溘ａ・・
            let cleanContent = result.content.trim();
            // 繧ゅ＠AI縺後・# 隕句・縺励阪・蠖｢蠑上〒蜃ｺ蜉帙＠縺ｦ縺励∪縺｣縺溘ｉ髯､蜴ｻ
            if (cleanContent.startsWith('#')) {
                cleanContent = cleanContent.replace(/^#+\s*.*?\n/, '').trim();
            }
            cleanContent = this.formatReadableParagraphs(cleanContent);

            // 繝ｪ繝ｼ繝画枚縺ｮ蝣ｴ蜷医・隕句・縺励ｒ莉倅ｸ弱＠縺ｪ縺・
            if (section.isLead) {
                return cleanContent;
            }

            return `${prefix}${section.title}\n\n${cleanContent}`;
        } catch (error) {
            console.error('Section generation failed:', error);
            return this.generateFallbackContent(section);
        }
    }

    /**
     * 螳悟・縺ｪ險倅ｺ九ｒ邨・∩遶九※
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
                seoScore: 0, // 莉･蜑阪・險育ｮ励＠縺ｦ縺・◆縺後∽ｸ崎ｦ√↓縺ｪ縺｣縺溘◆繧∝崋螳壼､縺ｾ縺溘・蜑企勁讀懆ｨ趣ｼ亥梛螳夂ｾｩ縺ｫ蜷医ｏ縺帙※菫晄戟・・
                readingTime: 0, // 蜷御ｸ・
                trendData: outline.trendData
            };

            return article;
        } catch (error) {
            console.error('Article assembly failed:', error);
            throw new Error('記事の組み立てに失敗しました');
        }
    }

    /**
     * 閾ｪ蜍輔Δ繝ｼ繝臥畑
     */
    async generateArticleAuto(
        keywords: string[],
        options?: {
            targetLength?: 'short' | 'medium' | 'long';
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            selectedTitle?: string;
            targetWordCount?: number;
            customInstructions?: string;
            imagesPerArticle?: number; // 逕ｻ蜒乗椢謨ｰ繧定ｿｽ蜉
            onStepComplete?: (step: number, data: any) => void;
        }
    ): Promise<Article> {
        // Step 1: トレンド分析
        const trendData = await this.analyzeTrends(keywords);
        options?.onStepComplete?.(1, trendData);

        // Step 2: タイトル生成（選択済みならスキップ）
        let selectedTitle: string;
        if (options?.selectedTitle) {
            selectedTitle = options.selectedTitle;
            options?.onStepComplete?.(2, [{ title: selectedTitle }]);
        } else {
            const titles = await this.generateTitles(trendData);
            selectedTitle = titles[0]?.title || `${keywords[0]}について`;
            options?.onStepComplete?.(2, titles);
        }

        // Step 3: アウトライン生成（対話モードと同じ経路）
        const targetWordCount = options?.targetWordCount
            || (options?.targetLength === 'short'
                ? 1200
                : options?.targetLength === 'long'
                    ? 3000
                    : 2000);

        const outline = await this.generateOutline(
            keywords,
            trendData,
            {
                targetLength: options?.targetLength,
                tone: options?.tone,
                selectedTitle,
                targetWordCount,
                customInstructions: options?.customInstructions,
            }
        );
        options?.onStepComplete?.(3, outline);

        // Step 4: 本文生成（対話モードと同じ経路）
        const article = await this.generateArticleFromPreparedOutline(outline, {
            tone: options?.tone || 'professional',
            targetWordCount,
            customInstructions: options?.customInstructions,
            onProgress: undefined,
        });
        options?.onStepComplete?.(4, article);

        article.tone = options?.tone || 'professional';
        article.length = options?.targetLength || 'medium';
        article.targetWordCount = targetWordCount;

        // 逕ｻ蜒冗函謌仙・逅・ｒ霑ｽ蜉
        if (options?.imagesPerArticle && options.imagesPerArticle > 0) {
            try {
                const updatedContent = await aiService.insertGeneratedImages(
                    article.content,
                    article.title, // 縺ｾ縺溘・ keywords[0]
                    keywords,
                    options.imagesPerArticle
                );
                article.content = updatedContent;
            } catch (imageError) {
                console.error('Image insertion failed, continuing without images:', imageError);
            }
        }

        return article;
    }

    private estimateLengthCategory(wordCount: number): 'short' | 'medium' | 'long' {
        if (wordCount < 400) return 'short';
        if (wordCount < 800) return 'medium';
        return 'long';
    }

    private generateFallbackContent(section: OutlineSection): string {
        return `## ${section.title}\n\n${section.description || '詳細を執筆中です。'}`;
    }

    async generateArticleFromPreparedOutline(
        outline: ArticleOutline,
        options?: {
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            targetWordCount?: number;
            customInstructions?: string;
            onProgress?: (section: OutlineSection, progress: number) => void;
        }
    ): Promise<Article> {
        await aiService.loadActiveConfig();
        const activeAIConfig = aiService.getActiveConfig();
        if (!activeAIConfig) {
            throw new Error('AI configuration is not loaded');
        }

        const keywords = Array.from(new Set([
            outline.keyword,
            ...(outline.trendData?.relatedKeywords || []),
        ])).filter(Boolean).slice(0, 3);

        const targetWordCount = options?.targetWordCount || outline.estimatedWordCount || 2000;

        const sharedResult = await generateArticleFromOutlineWithSharedCore({
            outline: {
                title: outline.title,
                sections: outline.sections.map((section) => ({
                    title: section.title,
                    level: 2,
                    description: section.description || '',
                    isLead: !!section.isLead,
                    estimatedWordCount: section.estimatedWordCount || 250,
                })),
            },
            keywords,
            tone: options?.tone || 'professional',
            targetWordCount,
            customInstructions: options?.customInstructions,
            defaultMaxTokens: activeAIConfig.maxTokens || 2000,
            qualityRetryCount: 3,
            callAI: (prompt, maxTokens) => aiService.generateRawText(prompt, maxTokens),
            onSectionComplete: ({ index, total, section: completed }) => {
                const target = outline.sections[index];
                if (!target) return;
                target.content = completed.content;
                target.isGenerated = true;
                if (options?.onProgress) {
                    const progress = ((index + 1) / Math.max(1, total)) * 100;
                    options.onProgress(target, progress);
                }
            }
        });

        const sectionContents = new Map<string, string>();
        outline.sections.forEach((section, index) => {
            const generated = sharedResult.sectionsWithContent[index];
            if (!generated) return;

            const formatted = generated.isLead
                ? generated.content
                : `## ${generated.title}\n\n${generated.content}`;

            sectionContents.set(section.id, formatted);
            section.content = generated.content;
            section.isGenerated = true;
            if (options?.onProgress) {
                const progress = ((index + 1) / Math.max(1, outline.sections.length)) * 100;
                options.onProgress(section, progress);
            }
        });

        const article = await this.assembleArticle(outline, sectionContents);
        // Shared core側で実施した最終整形（文字数調整・まとめ補完）を採用する
        article.content = sharedResult.fullContent;
        article.wordCount = sharedResult.wordCount;
        article.excerpt = this.generateExcerpt(sharedResult.fullContent);
        article.tone = options?.tone || 'professional';
        article.targetWordCount = targetWordCount;
        article.length = this.estimateLengthCategory(targetWordCount);
        return article;
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


