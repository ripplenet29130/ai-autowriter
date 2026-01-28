import { useState, useCallback } from 'react';
import {
    Article,
    ArticleOutline,
    TrendAnalysisResult,
    GenerationStep,
    StepResult,
    MultiStepGenerationState,
    OutlineSection,
    KeywordPreference
} from '../types';
import { multiStepGenerationService } from '../services/multiStepGenerationService';
import toast from 'react-hot-toast';

/**
 * マルチステップ記事生成のカスタムフック
 */
export function useMultiStepGeneration() {
    const [state, setState] = useState<MultiStepGenerationState>({
        mode: 'interactive',
        currentStep: 1,
        stepResults: [],
        isGenerating: false,
        keywordPreferences: {}
    });

    /**
     * キーワードの優先度をトグルする（default -> ng -> essential -> default）
     */
    const toggleKeywordPreference = useCallback((keyword: string) => {
        setState(prev => {
            const current = prev.keywordPreferences[keyword] || 'default';
            let next: KeywordPreference;

            if (current === 'default') next = 'ng';
            else if (current === 'ng') next = 'essential';
            else next = 'default';

            return {
                ...prev,
                keywordPreferences: {
                    ...prev.keywordPreferences,
                    [keyword]: next
                }
            };
        });
    }, []);

    /**
     * 手動でキーワードを追加して優先度を設定する
     */
    const addKeywordPreference = useCallback((keyword: string, preference: KeywordPreference) => {
        setState(prev => ({
            ...prev,
            keywordPreferences: {
                ...prev.keywordPreferences,
                [keyword]: preference
            }
        }));
    }, []);

    /**
     * Step 1: トレンド分析を実行
     */
    const executeStep1 = useCallback(async (keywords: string[]): Promise<TrendAnalysisResult | null> => {
        try {
            setState(prev => ({ ...prev, isGenerating: true, currentStep: 1 }));

            toast.loading('トレンド分析中...', { id: 'trend-analysis' });

            const trendData = await multiStepGenerationService.analyzeTrends(keywords);

            const stepResult: StepResult = {
                step: 1,
                status: 'completed',
                data: trendData,
                timestamp: new Date()
            };

            setState(prev => ({
                ...prev,
                trendData,
                stepResults: [...prev.stepResults, stepResult],
                isGenerating: false,
                currentStep: 1
            }));

            toast.success('トレンド分析が完了しました', { id: 'trend-analysis' });
            return trendData;
        } catch (error) {
            console.error('Step 1 エラー:', error);
            const errorMessage = error instanceof Error ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR): /, '') : 'トレンド分析に失敗しました';
            toast.error(errorMessage, { id: 'trend-analysis' });

            setState(prev => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error.message : '不明なエラー'
            }));

            return null;
        }
    }, []);

    /**
     * Step 2: タイトル案を生成
     */
    const executeStep2 = useCallback(async (trendData: TrendAnalysisResult): Promise<import('../types').TitleSuggestion[] | null> => {
        try {
            setState(prev => ({ ...prev, isGenerating: true, currentStep: 2 }));

            toast.loading('タイトル案を生成中...', { id: 'title-generation' });

            const titles = await multiStepGenerationService.generateTitles(trendData, state.keywordPreferences);

            const stepResult: StepResult = {
                step: 2,
                status: 'completed',
                data: titles,
                timestamp: new Date()
            };

            setState(prev => {
                // 同じステップの結果があれば上書き、なければ追加
                const filteredResults = prev.stepResults.filter(r => r.step !== 2);
                return {
                    ...prev,
                    titles,
                    stepResults: [...filteredResults, stepResult],
                    isGenerating: false
                };
            });

            toast.success('タイトル案が生成されました', { id: 'title-generation' });
            return titles;
        } catch (error) {
            console.error('Step 2 エラー:', error);
            const errorMessage = error instanceof Error ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR): /, '') : 'タイトル生成に失敗しました';
            toast.error(errorMessage, { id: 'title-generation' });

            setState(prev => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error.message : '不明なエラー'
            }));

            return null;
        }
    }, [state.keywordPreferences]);

    /**
     * Step 3: アウトライン生成を実行
     */
    const executeStep3 = useCallback(async (
        keywords: string[],
        trendData: TrendAnalysisResult,
        options?: {
            targetLength?: 'short' | 'medium' | 'long';
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            focusTopics?: string[];
            selectedTitle?: string;
            keywordPreferences?: Record<string, KeywordPreference>;
            customInstructions?: string;
        }
    ): Promise<ArticleOutline | null> => {
        try {
            setState(prev => ({ ...prev, isGenerating: true, currentStep: 3 }));

            toast.loading('アウトライン生成中...', { id: 'outline-generation' });

            const outline = await multiStepGenerationService.generateOutline(
                keywords,
                trendData,
                {
                    ...options,
                    keywordPreferences: options?.keywordPreferences || state.keywordPreferences,
                    customInstructions: options?.customInstructions
                }
            );

            const stepResult: StepResult = {
                step: 3,
                status: 'completed',
                data: outline,
                timestamp: new Date()
            };

            setState(prev => ({
                ...prev,
                outline,
                stepResults: [...prev.stepResults, stepResult],
                isGenerating: false
            }));

            toast.success('アウトラインが生成されました', { id: 'outline-generation' });
            return outline;
        } catch (error) {
            console.error('Step 3 エラー:', error);
            const errorMessage = error instanceof Error ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR): /, '') : 'アウトライン生成に失敗しました';
            toast.error(errorMessage, { id: 'outline-generation' });

            setState(prev => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error.message : '不明なエラー'
            }));

            return null;
        }
    }, [state.keywordPreferences]);

    /**
     * Step 4: 本文生成を実行
     */
    const executeStep4 = useCallback(async (
        outline: ArticleOutline,
        options?: {
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
            onProgress?: (section: OutlineSection, progress: number) => void;
            customInstructions?: string;
        }
    ): Promise<Article | null> => {
        try {
            setState(prev => ({ ...prev, isGenerating: true, currentStep: 4 }));

            toast.loading('記事を生成中...', { id: 'content-generation' });

            // プログレスを反映するための内部ハンドラ
            const internalOnProgress = (section: OutlineSection, progress: number) => {
                // 外部への通知
                if (options?.onProgress) options.onProgress(section, progress);

                // ローカルの構成状態を更新してUIに反映
                setState(prev => {
                    if (!prev.outline) return prev;

                    const updatedSections = prev.outline.sections.map(s =>
                        s.id === section.id ? { ...s, isGenerated: section.isGenerated, content: section.content } : s
                    );

                    return {
                        ...prev,
                        outline: {
                            ...prev.outline,
                            sections: updatedSections
                        }
                    };
                });
            };

            const sectionContents = await multiStepGenerationService.generateSections(
                outline,
                { ...options, onProgress: internalOnProgress }
            );

            const article = await multiStepGenerationService.assembleArticle(
                outline,
                sectionContents
            );

            const stepResult: StepResult = {
                step: 4,
                status: 'completed',
                data: article,
                timestamp: new Date()
            };

            setState(prev => ({
                ...prev,
                article,
                stepResults: [...prev.stepResults, stepResult],
                isGenerating: false
            }));

            toast.success('記事の生成が完了しました', { id: 'content-generation' });
            return article;
        } catch (error) {
            console.error('Step 4 エラー:', error);
            const errorMessage = error instanceof Error ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR): /, '') : '記事生成に失敗しました';
            toast.error(errorMessage, { id: 'content-generation' });

            setState(prev => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error.message : '不明なエラー'
            }));

            return null;
        }
    }, []);

    /**
     * 自動モードで全ステップを実行
     */
    const executeAutoMode = useCallback(async (
        keywords: string[],
        options?: {
            targetLength?: 'short' | 'medium' | 'long';
            tone?: 'professional' | 'casual' | 'technical' | 'friendly';
        }
    ): Promise<Article | null> => {
        try {
            setState(prev => ({ ...prev, mode: 'auto', isGenerating: true, currentStep: 1 }));

            toast.loading('自動生成を開始します...', { id: 'auto-generation' });

            const article = await multiStepGenerationService.generateArticleAuto(
                keywords,
                {
                    ...options,
                    onStepComplete: (step, data) => {
                        const stepResult: StepResult = {
                            step: step as GenerationStep,
                            status: 'completed',
                            data,
                            timestamp: new Date()
                        };

                        setState(prev => ({
                            ...prev,
                            currentStep: (step + 1) as GenerationStep,
                            stepResults: [...prev.stepResults, stepResult],
                            ...(step === 1 && { trendData: data }),
                            ...(step === 2 && { outline: data })
                        }));

                        toast.success(`ステップ ${step}/3 完了`, { id: 'auto-generation' });
                    }
                }
            );

            setState(prev => ({
                ...prev,
                article,
                isGenerating: false
            }));

            toast.success('記事の自動生成が完了しました', { id: 'auto-generation' });
            return article;
        } catch (error) {
            console.error('自動生成エラー:', error);
            const errorMessage = error instanceof Error ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR): /, '') : '自動生成に失敗しました';
            toast.error(errorMessage, { id: 'auto-generation' });

            setState(prev => ({
                ...prev,
                isGenerating: false,
                error: error instanceof Error ? error.message : '不明なエラー'
            }));

            return null;
        }
    }, []);

    const updateOutline = useCallback((outline: ArticleOutline) => {
        setState(prev => ({ ...prev, outline }));
    }, []);

    const updateSection = useCallback((sectionId: string, updates: Partial<OutlineSection>) => {
        setState(prev => {
            if (!prev.outline) return prev;

            const updatedSections = prev.outline.sections.map(section =>
                section.id === sectionId ? { ...section, ...updates } : section
            );

            return {
                ...prev,
                outline: {
                    ...prev.outline,
                    sections: updatedSections
                }
            };
        });
    }, []);

    const addSection = useCallback((section: OutlineSection) => {
        setState(prev => {
            if (!prev.outline) return prev;

            return {
                ...prev,
                outline: {
                    ...prev.outline,
                    sections: [...prev.outline.sections, section]
                }
            };
        });
    }, []);

    const removeSection = useCallback((sectionId: string) => {
        setState(prev => {
            if (!prev.outline) return prev;

            return {
                ...prev,
                outline: {
                    ...prev.outline,
                    sections: prev.outline.sections.filter(s => s.id !== sectionId)
                }
            };
        });
    }, []);

    const reorderSections = useCallback((sectionIds: string[]) => {
        setState(prev => {
            if (!prev.outline) return prev;

            const reorderedSections = sectionIds.map((id, index) => {
                const section = prev.outline!.sections.find(s => s.id === id);
                if (!section) return null;
                return { ...section, order: index };
            }).filter((s): s is OutlineSection => s !== null);

            return {
                ...prev,
                outline: {
                    ...prev.outline,
                    sections: reorderedSections
                }
            };
        });
    }, []);

    const reset = useCallback(() => {
        setState({
            mode: 'interactive',
            currentStep: 1,
            stepResults: [],
            isGenerating: false,
            keywordPreferences: {}
        });
    }, []);

    const nextStep = useCallback(() => {
        setState(prev => ({
            ...prev,
            currentStep: Math.min(4, prev.currentStep + 1) as GenerationStep
        }));
    }, []);

    const previousStep = useCallback(() => {
        setState(prev => ({
            ...prev,
            currentStep: Math.max(1, prev.currentStep - 1) as GenerationStep
        }));
    }, []);

    const updateArticle = useCallback((updatedArticle: Article) => {
        setState(prev => ({
            ...prev,
            article: updatedArticle
        }));
    }, []);

    return {
        ...state,
        executeStep1,
        executeStep2,
        executeStep3,
        executeStep4,
        executeAutoMode,
        updateOutline,
        updateSection,
        updateArticle,
        addSection,
        removeSection,
        reorderSections,
        nextStep,
        previousStep,
        reset,
        toggleKeywordPreference,
        addKeywordPreference
    };
}
