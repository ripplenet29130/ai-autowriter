import React, { useState } from 'react';
import { Bot, Sparkles, ArrowLeft, Zap, ListTree } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useArticleGeneration } from '../../hooks/useArticleGeneration';
import { aiService } from '../../services/aiService';
import { useWordPressPublish } from '../../hooks/useWordPressPublish';
import { KeywordManager } from './KeywordManager';
import { PromptSetManager } from './PromptSetManager';
import { ArticleEditor } from './ArticleEditor';
import { PublishControl } from './PublishControl';
import { MultiStepGenerator } from '../MultiStepGenerator';
import { useMultiStepGeneration } from '../../hooks/useMultiStepGeneration';
import { FactCheckResultsDisplay } from '../FactCheckResultsDisplay';
import { factCheckService } from '../../services/factCheckService';
import { titleKeywordInferenceService } from '../../services/titleKeywordInferenceService';
import { getSharedToneDescription, sharedToneOptions, type SharedTone } from '../../shared/toneOptions';
import type { TitleKeywordInference } from '../../services/titleKeywordInferenceService';
import type { FactCheckResult } from '../../types';
import type { FactCheckItem } from '../../types/factCheck';
import type { Article, ArticleStructureType } from '../../types';
import toast from 'react-hot-toast';

/**
 * AI記事生成メインコンポーネント
 */
export const AIGenerator: React.FC = () => {
    const { addArticle, updateArticle, wordPressConfigs, promptSets, titleSets, keywordSets, aiConfigs, aiConfig } = useAppStore();
    const { isGenerating, generatedArticle, generateArticle, clearArticle, setGeneratedArticle } = useArticleGeneration();
    const { executeAutoMode, isGenerating: isAutoGenerating } = useMultiStepGeneration();
    const { isPublishing, publishToWordPress } = useWordPressPublish();

    const [inputValue, setInputValue] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [tone, setTone] = useState<SharedTone>('professional');
    const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
    const articleStructureType: ArticleStructureType = 'standard';
    const [generationMode, setGenerationMode] = useState<'auto' | 'interactive'>('interactive');
    const [showMultiStep, setShowMultiStep] = useState(false);
    const [useDefaultAIConfig, setUseDefaultAIConfig] = useState(true);
    const [selectedAIProvider, setSelectedAIProvider] = useState<'' | 'openai' | 'claude' | 'gemini'>('');
    const [selectedAIConfigId, setSelectedAIConfigId] = useState<string>('');
    const [selectedAIModel, setSelectedAIModel] = useState<string>('');
    const [factCheckModel, setFactCheckModel] = useState<'sonar' | 'sonar-reasoning'>('sonar');

    // Fact Check State
    const [factCheckResults, setFactCheckResults] = useState<FactCheckResult[]>([]);
    const [isFactChecking, setIsFactChecking] = useState(false);
    const [isFactCheckFixing, setIsFactCheckFixing] = useState(false);
    const [autoFixEnabled, setAutoFixEnabled] = useState(false);
    const [factCheckProgress, setFactCheckProgress] = useState<{ total: number; processed: number } | null>(null);
    const [factCheckFixDiff, setFactCheckFixDiff] = useState<{ before: string; after: string } | null>(null);
    const [showFactCheckCandidateConfirm, setShowFactCheckCandidateConfirm] = useState(false);
    const [factCheckDraftKeyword, setFactCheckDraftKeyword] = useState('');
    const [factCheckDraftItems, setFactCheckDraftItems] = useState<Array<FactCheckItem & { id: string; enabled: boolean }>>([]);
    const [manualCandidateClaim, setManualCandidateClaim] = useState('');

    // Publish Status State
    const [publishStatus, setPublishStatus] = useState<'publish' | 'draft' | 'future'>('publish');
    const [scheduledDate, setScheduledDate] = useState<string>('');

    // Prompt Set State
    const [selectedPromptSetId, setSelectedPromptSetId] = useState<string>('');
    const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

    // Title Set State
    const [selectedTitleSetId, setSelectedTitleSetId] = useState<string>('');
    const [selectedTitle, setSelectedTitle] = useState<string>('');
    const [titleContextInstructions, setTitleContextInstructions] = useState<string>('');

    // Keyword Set State
    const [selectedKeywordSetId, setSelectedKeywordSetId] = useState<string>('');
    const [contentSourceMode, setContentSourceMode] = useState<'keyword' | 'title' | 'both'>('keyword');

    // Target Word Count State
    const [targetWordCount, setTargetWordCount] = useState<number>(2000);
    const usesTitleSource = contentSourceMode === 'title' || contentSourceMode === 'both';
    const activeSelectedTitle = usesTitleSource ? selectedTitle.trim() : '';
    const activeSelectedTitleSetId = usesTitleSource ? selectedTitleSetId : '';

    React.useEffect(() => {
        const loadFactCheckSettings = async () => {
            try {
                const settings = await factCheckService.getSettings();
                setAutoFixEnabled(Boolean(settings?.auto_fix_enabled));
            } catch {
                setAutoFixEnabled(false);
            }
        };
        void loadFactCheckSettings();
    }, []);

    React.useEffect(() => {
        if (aiConfigs.length === 0) {
            setSelectedAIProvider('');
            setSelectedAIConfigId('');
            return;
        }

        const current = selectedAIConfigId
            ? aiConfigs.find(c => c.id === selectedAIConfigId)
            : null;

        if (current) {
            if (selectedAIProvider !== current.provider) {
                setSelectedAIProvider(current.provider);
            }
            return;
        }

        const fallback = (aiConfig?.id && aiConfigs.find(c => c.id === aiConfig.id))
            || aiConfigs.find(c => c.isActive)
            || aiConfigs[0];

        if (fallback?.provider && selectedAIProvider !== fallback.provider) {
            setSelectedAIProvider(fallback.provider);
        }
        if (fallback?.id && selectedAIConfigId !== fallback.id) {
            setSelectedAIConfigId(fallback.id);
        }
    }, [aiConfig?.id, aiConfigs, selectedAIConfigId, selectedAIProvider]);

    const availableProviders = Array.from(new Set(aiConfigs.map(c => c.provider)));
    const providerConfigs = selectedAIProvider
        ? aiConfigs.filter(c => c.provider === selectedAIProvider)
        : [];

    const getProviderModelOptions = (provider: '' | 'openai' | 'claude' | 'gemini'): string[] => {
        if (provider === 'openai') {
            return ['gpt-5.2', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o-mini'];
        }
        if (provider === 'claude') {
            return ['claude-4-5-sonnet-20250929', 'claude-4-5-opus-20251124', 'claude-4-5-haiku-20251015', 'claude-3-5-sonnet-latest'];
        }
        if (provider === 'gemini') {
            return ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];
        }
        return [];
    };

    const getModelTierLabel = (model: string): string => {
        if (['gemini-2.5-pro', 'claude-4-5-opus-20251124', 'gpt-5.2', 'gpt-5'].includes(model)) {
            return '高品質・高単価';
        }
        if (['gemini-2.5-flash', 'claude-4-5-sonnet-20250929', 'claude-3-5-sonnet-latest', 'gpt-4.1', 'gpt-4o'].includes(model)) {
            return 'バランス';
        }
        return '低価格・高速';
    };

    const providerModelOptions = getProviderModelOptions(selectedAIProvider);

    React.useEffect(() => {
        if (!selectedAIProvider) {
            setSelectedAIModel('');
            return;
        }

        const options = getProviderModelOptions(selectedAIProvider);
        const currentConfig = providerConfigs.find(c => c.id === selectedAIConfigId) || providerConfigs[0];

        if (options.length === 0) {
            setSelectedAIModel('');
            return;
        }

        // ユーザーが既に有効なモデルを選択している場合は維持する
        if (selectedAIModel && options.includes(selectedAIModel)) {
            return;
        }

        if (currentConfig?.model && options.includes(currentConfig.model)) {
            setSelectedAIModel(currentConfig.model);
            return;
        }

        setSelectedAIModel(options[0]);
    }, [selectedAIProvider, selectedAIConfigId, providerConfigs, selectedAIModel]);

    const applySelectedAIConfig = async () => {
        if (useDefaultAIConfig) {
            await aiService.loadActiveConfig();
            return;
        }
        if (selectedAIConfigId) {
            const selected = aiConfigs.find(c => c.id === selectedAIConfigId);
            if (!selected) {
                throw new Error('選択したAI設定が見つかりません');
            }
            aiService.useConfig({
                ...selected,
                model: selectedAIModel || selected.model,
            });
            return;
        }
        await aiService.loadActiveConfig();
    };


    const getChangedLines = (beforeText: string, afterText: string, maxLines = 60) => {
        const beforeLines = beforeText.split('\n');
        const afterLines = afterText.split('\n');
        const len = Math.max(beforeLines.length, afterLines.length);
        const changed: Array<{ line: number; before: string; after: string }> = [];
        for (let i = 0; i < len; i++) {
            const b = beforeLines[i] ?? '';
            const a = afterLines[i] ?? '';
            if (b !== a) {
                changed.push({ line: i + 1, before: b, after: a });
            }
            if (changed.length >= maxLines) break;
        }
        return changed;
    };
    const handleAddKeyword = (keyword: string) => {
        const trimmed = keyword.trim();
        if (trimmed && !keywords.includes(trimmed)) {
            setKeywords([...keywords, trimmed]);
            setInputValue('');
        }
    };

    const handleRemoveKeyword = (keyword: string) => {
        setKeywords(keywords.filter(k => k !== keyword));
    };

    const buildEffectiveCustomInstructions = (base?: string) => {
        const parts = [base?.trim(), titleContextInstructions.trim()]
            .filter((value): value is string => Boolean(value && value.trim()));
        return parts.join('\n\n');
    };

    const buildTitleContextInstructions = (analysis?: TitleKeywordInference | null) => {
        if (!analysis) return '';

        return [
            '【タイトル解析】',
            `主キーワード: ${analysis.mainKeyword}`,
            analysis.subKeywords.length > 0 ? `補助キーワード: ${analysis.subKeywords.join('、')}` : '',
            `検索意図: ${analysis.searchIntent}`,
            `想定読者: ${analysis.targetAudience}`,
            `記事タイプ: ${analysis.articleType}`,
            '固定タイトルと検索意図を優先し、見出しと本文がタイトルから逸れないようにしてください。'
        ].filter(Boolean).join('\n');
    };

    const mergeKeywords = (primary: string, secondary: string[] = []) => {
        const merged: string[] = [];
        [primary, ...secondary].forEach((keyword) => {
            const trimmed = keyword.trim();
            if (trimmed && !merged.includes(trimmed)) merged.push(trimmed);
        });
        return merged;
    };

    const handleGenerate = async (finalKeywords: string[]) => {
        if (finalKeywords.length === 0) {
            return;
        }

        const selectedPromptSet = promptSets.find(ps => ps.id === selectedPromptSetId);
        const article = await generateArticle({
            keywords: finalKeywords,
            tone,
            length,
            articleStructureType,
            customInstructions: buildEffectiveCustomInstructions(selectedPromptSet?.customInstructions),
            targetWordCount,
            imagesPerArticle: 0
        });
        if (article) {
            addArticle(article);
        }
    };

    const handleStartGeneration = async () => {
        let finalKeywords = [...keywords];
        let titleAnalysis: TitleKeywordInference | null = null;

        // 入力フィールドに値がある場合はそれも追加
        if ((contentSourceMode === 'keyword' || contentSourceMode === 'both') && inputValue.trim()) {
            const trimmed = inputValue.trim();
            if (!finalKeywords.includes(trimmed)) {
                finalKeywords.push(trimmed);
                setKeywords(finalKeywords);
                setInputValue('');
            }
        }

        if (usesTitleSource && activeSelectedTitleSetId && activeSelectedTitle) {
            await applySelectedAIConfig();
            toast.loading('タイトルからキーワードと検索意図を解析中...', { id: 'title-inference' });
            titleAnalysis = await titleKeywordInferenceService.inferFromTitle(activeSelectedTitle);
            toast.success('タイトル解析が完了しました', { id: 'title-inference' });

            const titleKeywords = mergeKeywords(titleAnalysis.mainKeyword, titleAnalysis.subKeywords);
            finalKeywords = contentSourceMode === 'title'
                ? titleKeywords
                : mergeKeywords(titleAnalysis.mainKeyword, [...finalKeywords, ...titleAnalysis.subKeywords]);
            setTitleContextInstructions(buildTitleContextInstructions(titleAnalysis));
        } else {
            setTitleContextInstructions('');
        }

        // 自動モード実行 (最優先)
        if (generationMode === 'auto') {
            if (usesTitleSource) {
                if (!activeSelectedTitleSetId || !activeSelectedTitle) {
                    toast.error('タイトルセットと使用するタイトルを選択してください');
                    return;
                }
            }

            if (finalKeywords.length === 0) {
                toast.error((contentSourceMode === 'title' || contentSourceMode === 'both')
                    ? 'タイトルからキーワード推定に失敗しました。別のタイトルを選択してください'
                    : 'キーワードを入力してください');
                return;
            }

            setShowMultiStep(false);

            // プロンプトセットの取得
            const selectedPromptSet = promptSets.find(ps => ps.id === selectedPromptSetId);
            if (!titleAnalysis) {
                await applySelectedAIConfig();
            }

            const article = await executeAutoMode(finalKeywords, {
                tone,
                targetLength: length,
                selectedTitle: activeSelectedTitle || undefined,
                targetWordCount,
                articleStructureType,
                customInstructions: [
                    selectedPromptSet?.customInstructions?.trim(),
                    buildTitleContextInstructions(titleAnalysis)
                ].filter(Boolean).join('\n\n'),
                imagesPerArticle: 0
            });

            if (article) {
                const articleWithStructure = { ...article, articleStructureType };
                setGeneratedArticle(articleWithStructure);
                addArticle(articleWithStructure);
            }
            return;
        }

        // --- これ以降は対話モード (Interactive Mode) ---
        // 対話モードは必ずキーワード検索から開始する
        if (finalKeywords.length === 0) {
            toast.error((contentSourceMode === 'title' || contentSourceMode === 'both')
                ? '対話モードでは、タイトルから推定したキーワードが必要です。タイトルを選び直してください'
                : '対話モードでは最初にキーワードを入力してください');
            return;
        }
        if (!titleAnalysis) {
            await applySelectedAIConfig();
        }

        setKeywords(finalKeywords);
        setShowMultiStep(true);
    };

    const handleUpdateArticle = (updates: Partial<typeof generatedArticle>) => {
        if (generatedArticle) {
            const updated = { ...generatedArticle, ...updates };
            setGeneratedArticle(updated as typeof generatedArticle);
            updateArticle(generatedArticle.id, updates as any);
        }
    };

    const handlePublish = async (configId: string, category?: string, status?: 'publish' | 'draft' | 'future', date?: Date) => {
        if (generatedArticle) {
            const result = await publishToWordPress(generatedArticle, configId, category, status, date);
            // 投稿成功時に、URLに置換された新しいコンテンツでローカル状態を更新
            if (typeof result === 'object' && result !== null) {
                setGeneratedArticle(result);
            }
        }
    };

    const hasFixableIssues = (results: FactCheckResult[]): boolean => {
        return results.some((result) => {
            if (result.verdict === 'incorrect') return true;
            if (result.verdict === 'partially_correct') return true;
            if (result.verdict === 'unverified') return true;
            return false;
        });
    };

    const runFactCheck = async (items: FactCheckItem[], keyword: string) => {
        if (!generatedArticle) return;

        setIsFactChecking(true);
        setFactCheckProgress(null);
        try {
            if (items.length === 0) {
                toast('検証する事実情報が見つかりませんでした', { icon: 'ℹ️' });
                setIsFactChecking(false);
                return;
            }

            toast.loading('ファクトチェックを実行中...', { duration: 2000 });
            const effectiveKeyword = keyword.trim() || generatedArticle.keywords?.[0] || generatedArticle.title;
            const results = await factCheckService.verifyFacts(items, effectiveKeyword, factCheckModel, (progress) => {
                setFactCheckProgress(progress);
            });
            setFactCheckResults(results);

            const updatedArticle = {
                ...generatedArticle,
                content: generatedArticle.content.replace(/\[\[(.+?)\]\]/g, '$1'),
                factCheckResults: results
            };

            setGeneratedArticle(updatedArticle as any);
            updateArticle(generatedArticle.id, updatedArticle as any);

            if (results.length === 0) {
                toast.error('ファクトチェック結果が0件です。Perplexity APIキー設定を確認してください。', { duration: 5000 });
            } else {
                const criticalIssues = results.filter(r => r.verdict === 'incorrect' && r.confidence >= 70).length;
                if (criticalIssues > 0) {
                    toast.error(`重大な事実誤認が ${criticalIssues} 件見つかりました`, { duration: 5000 });
                } else {
                    toast.success('ファクトチェックが完了しました');
                }
            }

            const settings = await factCheckService.getSettings();
            setAutoFixEnabled(Boolean(settings?.auto_fix_enabled));
            if (settings?.auto_fix_enabled && hasFixableIssues(results)) {
                await handleApplyFactCheckFixes(results);
            }

        } catch (error) {
            console.error('Fact check error:', error);
            toast.error('ファクトチェックに失敗しました');
        } finally {
            setIsFactChecking(false);
        }
    };

    const handleManualFactCheck = () => {
        if (!generatedArticle) return;
        const extracted = factCheckService.extractFacts(generatedArticle.content);
        if (extracted.length === 0) {
            toast('検証する事実情報が見つかりませんでした', { icon: 'ℹ️' });
            return;
        }
        const initialKeyword = generatedArticle.keywords && generatedArticle.keywords.length > 0
            ? generatedArticle.keywords.slice(0, 5).join(', ')
            : generatedArticle.title;
        setFactCheckDraftKeyword(initialKeyword);
        setFactCheckDraftItems(
            extracted.map((item, idx) => ({
                ...item,
                id: `${idx}-${item.claim.slice(0, 20)}`,
                enabled: true,
            }))
        );
        setManualCandidateClaim('');
        setShowFactCheckCandidateConfirm(true);
    };

    const handleApplyFactCheckFixes = async (baseResults?: FactCheckResult[]) => {
        if (!generatedArticle) return;
        const results = baseResults ?? generatedArticle.factCheckResults ?? factCheckResults;
        if (!results || results.length === 0) {
            toast.error('先にファクトチェックを実行してください');
            return;
        }
        if (!hasFixableIssues(results)) {
            toast('修正対象の指摘は見つかりませんでした', { icon: 'ℹ️' });
            return;
        }

        setIsFactCheckFixing(true);
        try {
            toast.loading('AIで修正中...', { duration: 2000 });
            const keyword = generatedArticle.keywords?.[0] || generatedArticle.title;
            const beforeContent = generatedArticle.content;
            const fixedContent = await factCheckService.applyFactCheckFixes(
                beforeContent,
                results,
                keyword,
                factCheckModel
            );

            if (!fixedContent || fixedContent.trim().length === 0) {
                toast.error('修正に失敗しました');
                return;
            }

            const updatedArticle = {
                ...generatedArticle,
                content: fixedContent,
            };

            setGeneratedArticle(updatedArticle as any);
            updateArticle(generatedArticle.id, updatedArticle as any);
            setFactCheckFixDiff({ before: beforeContent, after: fixedContent });
            toast.success('ファクトチェック指摘を反映して本文を修正しました');
        } catch (error) {
            console.error('Fact check auto-fix error:', error);
            toast.error('AI修正に失敗しました');
        } finally {
            setIsFactCheckFixing(false);
        }
    };


    const handleBackToForm = () => {
        clearArticle();
        setShowMultiStep(false);
        setShowFactCheckCandidateConfirm(false);
        setManualCandidateClaim('');
        setFactCheckDraftItems([]);
        setFactCheckDraftKeyword('');
    };

    const canApplyFactCheckFix = hasFixableIssues((generatedArticle?.factCheckResults || factCheckResults || []));

    const handleRegenerateArticle = async (options: import('./RegenerateModal').RegenerateOptions) => {
        if (!generatedArticle) return;

        try {
            toast.loading('記事を再生成中...', { duration: 3000 });

            const adjustmentMap = {
                'none': '',
                'detailed': 'より詳しく、具体例や詳細な説明を追加してください。',
                'concise': 'より簡潔に、要点を絞って書き直してください。',
                'technical': 'より専門的に、技術用語や専門知識を含めて書き直してください。',
                'simple': 'より分かりやすく、初心者向けに平易な表現で書き直してください。'
            };

            let customInstructions = `以下の記事を基に、${options.targetWordCount}文字程度で再生成してください。\n\n`;

            if (options.adjustmentType !== 'none') {
                customInstructions += adjustmentMap[options.adjustmentType] + '\n';
            }

            if (options.customPrompt) {
                customInstructions += options.customPrompt + '\n';
            }

            customInstructions += `\n【元の記事】\nタイトル: ${generatedArticle.title}\n\n${generatedArticle.content}`;

            const regenerated = await generateArticle({
                keywords: generatedArticle.keywords || [],
                tone: generatedArticle.tone,
                length: generatedArticle.length,
                customInstructions: buildEffectiveCustomInstructions(customInstructions)
            });

            if (regenerated) {
                toast.success('記事を再生成しました');
            }
        } catch (error) {
            console.error('Regeneration error:', error);
            toast.error('再生成に失敗しました');
        }
    };

    const handleMultiStepComplete = (article: Article) => {
        setGeneratedArticle({ ...article, articleStructureType } as any);
        setShowMultiStep(false);
    };

    if (showMultiStep && generationMode === 'interactive') {
        return (
            <MultiStepGenerator
                keywords={keywords}
                tone={tone}
                length={length}
                articleStructureType={articleStructureType}
                customInstructions={buildEffectiveCustomInstructions(promptSets.find(ps => ps.id === selectedPromptSetId)?.customInstructions)}
                selectedTitleSetId={activeSelectedTitleSetId}
                selectedTitle={activeSelectedTitle}
                targetWordCount={targetWordCount}
                onComplete={handleMultiStepComplete}
                onBack={() => setShowMultiStep(false)}
            />
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center space-x-3">
                <Bot className="w-8 h-8 text-purple-600" />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">AI記事生成</h2>
                    <p className="text-gray-600">AIを使って高品質な記事を自動生成します</p>
                </div>
            </div>

            {!generatedArticle ? (
                /* Generation Form */
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">記事生成設定</h3>

                        {/* Mode Selector */}
                        <div className="flex space-x-3 mb-6 p-2 bg-gray-100 rounded-lg">
                            <button
                                onClick={() => setGenerationMode('interactive')}
                                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-md font-medium transition-all ${generationMode === 'interactive'
                                    ? 'bg-white text-purple-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                <ListTree className="w-4 h-4" />
                                <span className="font-medium">対話モード</span>
                            </button>
                            <button
                                onClick={() => setGenerationMode('auto')}
                                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-md font-medium transition-all ${generationMode === 'auto'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                <span className="font-medium">自動モード</span>
                            </button>
                        </div>

                        {generationMode === 'auto' ? (
                            <p className="text-sm text-gray-600 mb-4">
                                すべての工程を自動で実行し、記事を生成します
                            </p>
                        ) : (
                            <p className="text-sm text-gray-600 mb-4">
                                タイトル選択 → アウトライン編集 → 本文生成の順に進めます
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={useDefaultAIConfig}
                                    onChange={(e) => setUseDefaultAIConfig(e.target.checked)}
                                    disabled={isGenerating || isAutoGenerating}
                                />
                                デフォルト（AI設定のアクティブ構成）を使用
                            </label>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                生成に使用するAI
                            </label>
                            <select
                                value={selectedAIProvider}
                                onChange={(e) => {
                                    const provider = e.target.value as '' | 'openai' | 'claude' | 'gemini';
                                    setSelectedAIProvider(provider);
                                    const nextConfigs = aiConfigs.filter(c => c.provider === provider);
                                    const preferred = nextConfigs.find(c => c.isActive) || nextConfigs[0];
                                    setSelectedAIConfigId(preferred?.id || '');
                                }}
                                disabled={isGenerating || isAutoGenerating || useDefaultAIConfig}
                                className="input-field"
                            >
                                {aiConfigs.length === 0 && <option value="">AI設定がありません</option>}
                                {availableProviders.map((provider) => (
                                    <option key={provider} value={provider}>
                                        {provider}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                生成に使用するモデル
                            </label>
                            <select
                                value={selectedAIModel}
                                onChange={(e) => setSelectedAIModel(e.target.value)}
                                disabled={isGenerating || isAutoGenerating || !selectedAIProvider || useDefaultAIConfig}
                                className="input-field"
                            >
                                {providerModelOptions.length === 0 && <option value="">モデルがありません</option>}
                                {providerModelOptions.map((model) => (
                                    <option key={model} value={model}>
                                        {`${model}（${getModelTierLabel(model)}）`}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <p className="text-xs text-gray-500 md:col-span-2">
                            {useDefaultAIConfig
                                ? 'AI設定でアクティブなAI/モデルをそのまま使います'
                                : 'この画面の生成実行時のみ、AIとモデルを上書きして使います'}
                        </p>
                    </div>


                    {/* Prompt Set Selector */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                                プロンプトセット（カスタム指示）
                            </label>
                            <button
                                onClick={() => setIsPromptManagerOpen(true)}
                                className="text-xs text-purple-600 font-bold hover:text-purple-800 flex items-center gap-1"
                            >
                                <Zap className="w-3 h-3" />
                                管理・作成
                            </button>
                        </div>
                        <select
                            value={selectedPromptSetId}
                            onChange={(e) => setSelectedPromptSetId(e.target.value)}
                            disabled={isGenerating || isAutoGenerating}
                            className="input-field"
                        >
                            <option value="">（指定なし）</option>
                            {(promptSets || []).map(ps => (
                                <option key={ps.id} value={ps.id}>
                                    {ps.name}
                                </option>
                            ))}
                        </select>
                        {selectedPromptSetId && (
                            <p className="text-xs text-gray-500 mt-1 ml-1 truncate">
                                {promptSets.find(ps => ps.id === selectedPromptSetId)?.customInstructions}
                            </p>
                        )}
                    </div>

                    {/* Content Source Mode */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            生成モード
                        </label>
                        <div className="flex gap-3">
                            <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                                <input
                                    type="radio"
                                    name="content_source_mode"
                                    value="keyword"
                                    checked={contentSourceMode === 'keyword'}
                                    onChange={() => setContentSourceMode('keyword')}
                                    className="mr-2"
                                    disabled={isGenerating || isAutoGenerating}
                                />
                                <span className="text-sm font-medium">キーワードから生成</span>
                            </label>
                            <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                                <input
                                    type="radio"
                                    name="content_source_mode"
                                    value="title"
                                    checked={contentSourceMode === 'title'}
                                    onChange={() => setContentSourceMode('title')}
                                    className="mr-2"
                                    disabled={isGenerating || isAutoGenerating}
                                />
                                <span className="text-sm font-medium">タイトルから生成</span>
                            </label>
                            <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-green-500 has-[:checked]:bg-green-50">
                                <input
                                    type="radio"
                                    name="content_source_mode"
                                    value="both"
                                    checked={contentSourceMode === 'both'}
                                    onChange={() => setContentSourceMode('both')}
                                    className="mr-2"
                                    disabled={isGenerating || isAutoGenerating}
                                />
                                <span className="text-sm font-medium">両方から生成</span>
                            </label>
                        </div>
                    </div>

                    {(contentSourceMode === 'title' || contentSourceMode === 'both') && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                タイトルセット（登録済みタイトルから選ぶ）
                            </label>
                            <select
                                value={selectedTitleSetId}
                                onChange={(e) => {
                                    setSelectedTitleSetId(e.target.value);
                                    setSelectedTitle('');
                                }}
                                disabled={isGenerating || isAutoGenerating}
                                className="input-field"
                            >
                                <option value="">セットを選択してください...</option>
                                {(titleSets || []).map(ts => (
                                    <option key={ts.id} value={ts.id}>
                                        {ts.name} ({ts.titles.length}個)
                                    </option>
                                ))}
                            </select>

                            {selectedTitleSetId && (() => {
                                const selectedSet = titleSets.find(s => s.id === selectedTitleSetId);
                                return selectedSet && selectedSet.titles.length > 0 && (
                                    <div className="mt-3">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            使用するタイトルを選択
                                        </label>
                                        <select
                                            value={selectedTitle}
                                            onChange={(e) => setSelectedTitle(e.target.value)}
                                            disabled={isGenerating || isAutoGenerating}
                                            className="input-field"
                                        >
                                            <option value="">タイトルを選択してください...</option>
                                            {(selectedSet.titles || []).map((title, index) => (
                                                <option key={index} value={title}>
                                                    {title}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {(contentSourceMode === 'keyword' || contentSourceMode === 'both') && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                キーワードセット(登録済みキーワードから選ぶ)
                            </label>
                            <select
                                value={selectedKeywordSetId}
                                onChange={(e) => {
                                    const setId = e.target.value;
                                    setSelectedKeywordSetId(setId);
                                    if (setId) {
                                        setKeywords([]);
                                        setInputValue('');
                                    }
                                }}
                                disabled={isGenerating || isAutoGenerating}
                                className="input-field"
                            >
                                <option value="">(指定なし)</option>
                                {(keywordSets || []).map(ks => (
                                    <option key={ks.id} value={ks.id}>
                                        {ks.name} ({ks.keywords.length}個)
                                    </option>
                                ))}
                            </select>
                            {selectedKeywordSetId && (() => {
                                const selectedSet = keywordSets.find(s => s.id === selectedKeywordSetId);
                                return selectedSet && selectedSet.keywords.length > 0 && (
                                    <div className="mt-3">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            使用するキーワードを選択
                                        </label>
                                        <div className="space-y-2 max-h-48 overflow-y-auto p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            {(selectedSet.keywords || []).map((keyword, index) => (
                                                <label key={index} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={keywords.includes(keyword)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setKeywords([...keywords, keyword]);
                                                            } else {
                                                                setKeywords(keywords.filter(k => k !== keyword));
                                                            }
                                                        }}
                                                        disabled={isGenerating || isAutoGenerating}
                                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                                    />
                                                    <span className="text-sm text-gray-700">{keyword}</span>
                                                </label>
                                            ))}
                                        </div>
                                        {keywords.length > 0 && (
                                            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                                <p className="text-xs font-medium text-blue-900 mb-1">選択中: {keywords.length}個</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {keywords.map((kw, i) => (
                                                        <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                                                            {kw}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* Keywords - キーワードモードかつキーワードセット未選択時のみ表示 */}
                    {(contentSourceMode === 'keyword' || contentSourceMode === 'both') && !selectedKeywordSetId && (
                        <KeywordManager
                            keywords={keywords}
                            inputValue={inputValue}
                            onInputChange={setInputValue}
                            onAdd={handleAddKeyword}
                            onRemove={handleRemoveKeyword}
                            disabled={isGenerating || isAutoGenerating}
                        />
                    )}

                    {/* Tone */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            トーン
                        </label>
                        <select
                            value={tone}
                            onChange={(e) => setTone(e.target.value as SharedTone)}
                            disabled={isGenerating || isAutoGenerating}
                            className="input-field"
                        >
                            {sharedToneOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs leading-relaxed text-gray-500">
                            {getSharedToneDescription(tone)}
                        </p>
                    </div>

                    {/* Target Word Count */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            目標文字数
                        </label>
                        <div className="flex gap-2 mb-2">
                            <button
                                type="button"
                                onClick={() => setTargetWordCount(1000)}
                                className={`px-3 py-2 text-sm rounded-md border transition-colors ${targetWordCount === 1000
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                                    }`}
                                disabled={isGenerating || isAutoGenerating}
                            >
                                1,000字
                            </button>
                            <button
                                type="button"
                                onClick={() => setTargetWordCount(2000)}
                                className={`px-3 py-2 text-sm rounded-md border transition-colors ${targetWordCount === 2000
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                                    }`}
                                disabled={isGenerating || isAutoGenerating}
                            >
                                2,000字
                            </button>
                            <button
                                type="button"
                                onClick={() => setTargetWordCount(3000)}
                                className={`px-3 py-2 text-sm rounded-md border transition-colors ${targetWordCount === 3000
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                                    }`}
                                disabled={isGenerating}
                            >
                                3,000字
                            </button>
                        </div>
                        <input
                            type="number"
                            value={targetWordCount}
                            onChange={(e) => setTargetWordCount(parseInt(e.target.value) || 2000)}
                            min="500"
                            max="3000"
                            step="100"
                            disabled={isGenerating || isAutoGenerating}
                            className="input-field"
                            placeholder="カスタム文字数を入力"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            プリセットを選択するか、カスタム文字数を入力してください
                        </p>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleStartGeneration}
                        disabled={
                            isGenerating ||
                            isAutoGenerating ||
                            (
                                contentSourceMode === 'title'
                                    ? (!selectedTitleSetId || !selectedTitle)
                                    : contentSourceMode === 'both'
                                        ? (!selectedTitleSetId || !selectedTitle || (keywords.length === 0 && !inputValue.trim()))
                                    : (keywords.length === 0 && !inputValue.trim())
                            )
                        }
                        className="w-full btn-primary flex items-center justify-center space-x-2"
                    >
                        {isGenerating || isAutoGenerating ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>生成中...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-5 h-5" />
                                <span>記事を生成</span>
                            </>
                        )}
                    </button>

                    {contentSourceMode === 'keyword' && keywords.length === 0 && (
                        <p className="text-sm text-gray-500 text-center">
                            キーワードを追加してください
                        </p>
                    )}
                    {contentSourceMode === 'title' && (!selectedTitleSetId || !selectedTitle) && (
                        <p className="text-sm text-gray-500 text-center">
                            タイトルセットとタイトルを選択してください
                        </p>
                    )}
                    {contentSourceMode === 'both' && (!selectedTitleSetId || !selectedTitle || (keywords.length === 0 && !inputValue.trim())) && (
                        <p className="text-sm text-gray-500 text-center">
                            タイトルセット/タイトルの選択とキーワード入力の両方が必要です
                        </p>
                    )}
                </div>
            ) : (
                /* Article Editor View */
                <div className="space-y-6">
                    {/* Back Button */}
                    <button
                        onClick={handleBackToForm}
                        className="btn-secondary flex items-center space-x-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>新しい記事を生成</span>
                    </button>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            {showFactCheckCandidateConfirm && (
                                <div className="mb-5 p-4 border border-blue-200 bg-blue-50 rounded-xl space-y-3">
                                    <h4 className="text-sm font-semibold text-blue-900">ファクトチェック実行前の確認</h4>
                                    <p className="text-xs text-blue-800">「高優先」は数値・日付など重要度が高い候補です。「通常優先」は補助候補です。</p>
                                    <div>
                                        <label className="block text-xs font-medium text-blue-900 mb-1">関連キーワード（編集可）</label>
                                        <input
                                            value={factCheckDraftKeyword}
                                            onChange={(e) => setFactCheckDraftKeyword(e.target.value)}
                                            className="w-full px-3 py-2 border border-blue-200 rounded-md text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-blue-900 mb-1">候補文を手動追加</label>
                                        <div className="flex gap-2">
                                            <input
                                                value={manualCandidateClaim}
                                                onChange={(e) => setManualCandidateClaim(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-blue-200 rounded-md text-sm"
                                                placeholder="追加したい主張文を入力"
                                                disabled={isFactChecking}
                                            />
                                            <button
                                                type="button"
                                                className="px-3 py-2 text-sm border border-blue-300 rounded bg-white disabled:opacity-50"
                                                disabled={!manualCandidateClaim.trim() || isFactChecking}
                                                onClick={() => {
                                                    const claim = manualCandidateClaim.trim();
                                                    if (!claim) return;
                                                    setFactCheckDraftItems((prev) => [
                                                        ...prev,
                                                        {
                                                            id: `manual-${Date.now()}`,
                                                            claim,
                                                            context: generatedArticle.content || '',
                                                            priority: 'normal',
                                                            enabled: true,
                                                        },
                                                    ]);
                                                    setManualCandidateClaim('');
                                                }}
                                            >
                                                追加
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-blue-800">候補文（チェック/編集可）</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setFactCheckDraftItems((prev) => prev.map((i) => ({ ...i, enabled: true })))}
                                                disabled={isFactChecking}
                                                className="px-2 py-1 text-xs border border-blue-300 rounded bg-white disabled:opacity-50"
                                            >
                                                全選択
                                            </button>
                                            <button
                                                onClick={() => setFactCheckDraftItems((prev) => prev.map((i) => ({ ...i, enabled: false })))}
                                                disabled={isFactChecking}
                                                className="px-2 py-1 text-xs border border-blue-300 rounded bg-white disabled:opacity-50"
                                            >
                                                全解除
                                            </button>
                                        </div>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto space-y-2">
                                        {factCheckDraftItems.map((item) => (
                                            <div key={item.id} className="bg-white border border-blue-100 rounded-md p-2">
                                                <label className="flex items-center gap-2 text-xs mb-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={item.enabled}
                                                        disabled={isFactChecking}
                                                        onChange={(e) =>
                                                            setFactCheckDraftItems((prev) =>
                                                                prev.map((it) => (it.id === item.id ? { ...it, enabled: e.target.checked } : it))
                                                            )
                                                        }
                                                    />
                                                    <span className={item.priority === 'high' ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                                                        {item.priority === 'high' ? '高優先（重要）' : '通常優先（補助）'}
                                                    </span>
                                                </label>
                                                <label className="block text-[11px] text-gray-500 mb-1">主張（何を検証するか）</label>
                                                <textarea
                                                    value={item.claim}
                                                    rows={2}
                                                    onChange={(e) =>
                                                        setFactCheckDraftItems((prev) =>
                                                            prev.map((it) => (it.id === item.id ? { ...it, claim: e.target.value } : it))
                                                        )
                                                    }
                                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setShowFactCheckCandidateConfirm(false)}
                                            disabled={isFactChecking}
                                            className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white disabled:opacity-50"
                                        >
                                            キャンセル
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const selected = factCheckDraftItems
                                                    .filter((item) => item.enabled)
                                                    .map((item) => ({
                                                        claim: item.claim.trim(),
                                                        context: item.context,
                                                        priority: item.priority,
                                                    }))
                                                    .filter((item) => item.claim.length > 0);
                                                setShowFactCheckCandidateConfirm(false);
                                                setManualCandidateClaim('');
                                                await runFactCheck(selected, factCheckDraftKeyword.trim());
                                            }}
                                            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            disabled={factCheckDraftItems.filter((item) => item.enabled).length === 0 || isFactChecking}
                                        >
                                            {isFactChecking ? "実行中..." : "この内容で実行"}
                                        </button>
                                    </div>
                                </div>
                            )}
                            {isFactChecking && factCheckProgress && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                    <div className="text-sm text-blue-900 font-medium">ファクトチェック実行中...</div>
                                    <div className="text-xs text-blue-700 mt-1">
                                        {factCheckProgress.processed} / {factCheckProgress.total} 件を処理
                                    </div>
                                </div>
                            )}
                            {generatedArticle.factCheckResults && (
                                <FactCheckResultsDisplay results={generatedArticle.factCheckResults} />
                            )}
                            {factCheckFixDiff && (() => {
                                const changedLines = getChangedLines(factCheckFixDiff.before, factCheckFixDiff.after);
                                return (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-sm font-semibold text-amber-900">AI修正レポート（ここ）</h4>
                                            <span className="text-xs text-amber-800">修正箇所: {changedLines.length}行</span>
                                        </div>
                                        {changedLines.length === 0 ? (
                                            <p className="text-xs text-amber-800">修正差分は検出できませんでした。</p>
                                        ) : (
                                            <div className="max-h-56 overflow-y-auto space-y-2">
                                                {changedLines.map((row) => (
                                                    <div key={row.line} className="bg-white border border-amber-100 rounded-md p-2 text-xs">
                                                        <div className="font-semibold text-gray-700 mb-1">行 {row.line}</div>
                                                        <div className="rounded border border-red-100 bg-red-50 px-2 py-1 text-red-900">
                                                            <span className="font-semibold">修正前:</span> {row.before || '(空行)'}
                                                        </div>
                                                        <div className="rounded border border-green-100 bg-green-50 px-2 py-1 text-green-900 mt-1">
                                                            <span className="font-semibold">修正後:</span> {row.after || '(空行)'}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-gray-900">記事編集</h3>
                                    {autoFixEnabled && (
                                        <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            自動修正ON
                                        </span>
                                    )}
                                </div>
                                <ArticleEditor
                                    article={generatedArticle}
                                    onUpdate={handleUpdateArticle}
                                    onRegenerate={handleRegenerateArticle}
                                    onFactCheck={handleManualFactCheck}
                                    isFactChecking={isFactChecking}
                                    onFactCheckFix={() => void handleApplyFactCheckFixes()}
                                    isFactCheckFixing={isFactCheckFixing}
                                    canFactCheckFix={canApplyFactCheckFix}
                                />
                            </div>
                        </div>

                        {/* Publish Control */}
                        <div className="lg:col-span-1">
                            <PublishControl
                                article={generatedArticle}
                                wordPressConfigs={wordPressConfigs}
                                isPublishing={isPublishing}
                                publishStatus={publishStatus}
                                onPublishStatusChange={setPublishStatus}
                                scheduledDate={scheduledDate}
                                onScheduledDateChange={setScheduledDate}
                                onPublish={handlePublish}
                            />
                        </div>
                    </div>
                </div>
            )
            }

            <PromptSetManager
                isOpen={isPromptManagerOpen}
                onClose={() => setIsPromptManagerOpen(false)}
                onSelect={(ps) => setSelectedPromptSetId(ps.id)}
            />
        </div >
    );
};

export default AIGenerator;








