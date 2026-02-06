import React, { useState } from 'react';
import { Bot, Sparkles, ArrowLeft, Zap, ListTree } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useArticleGeneration } from '../../hooks/useArticleGeneration';
import { useWordPressPublish } from '../../hooks/useWordPressPublish';
import { KeywordManager } from './KeywordManager';
import { PromptSetManager } from './PromptSetManager';
import { ArticleEditor } from './ArticleEditor';
import { PublishControl } from './PublishControl';
import { MultiStepGenerator } from '../MultiStepGenerator';
import { FactCheckResultsDisplay } from '../FactCheckResultsDisplay';
import toast from 'react-hot-toast';

/**
 * AI記事生成メインコンポーネント
 */
export const AIGenerator: React.FC = () => {
    const { addArticle, updateArticle, wordPressConfigs, promptSets, titleSets, keywordSets } = useAppStore();
    const { isGenerating, generatedArticle, generateArticle, clearArticle, setGeneratedArticle } = useArticleGeneration();
    const { isPublishing, publishToWordPress } = useWordPressPublish();

    const [inputValue, setInputValue] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [tone, setTone] = useState<'professional' | 'casual' | 'technical' | 'friendly'>('professional');
    const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
    const [generationMode, setGenerationMode] = useState<'auto' | 'interactive'>('interactive');
    const [showMultiStep, setShowMultiStep] = useState(false);
    const [factCheckNote, setFactCheckNote] = useState('');
    const [factCheckModel, setFactCheckModel] = useState<'sonar' | 'sonar-reasoning'>('sonar');

    // Publish Status State
    const [publishStatus, setPublishStatus] = useState<'publish' | 'draft' | 'future'>('publish');
    const [scheduledDate, setScheduledDate] = useState<string>('');

    // Prompt Set State
    const [selectedPromptSetId, setSelectedPromptSetId] = useState<string>('');
    const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

    // Title Set State
    const [selectedTitleSetId, setSelectedTitleSetId] = useState<string>('');
    const [selectedTitle, setSelectedTitle] = useState<string>('');

    // Keyword Set State
    const [selectedKeywordSetId, setSelectedKeywordSetId] = useState<string>('');

    // Target Word Count State
    const [targetWordCount, setTargetWordCount] = useState<number>(2000);

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

    const handleGenerate = async (finalKeywords: string[]) => {
        if (finalKeywords.length === 0) {
            return;
        }

        const selectedPromptSet = promptSets.find(ps => ps.id === selectedPromptSetId);
        const article = await generateArticle({
            keywords: finalKeywords,
            tone,
            length,
            customInstructions: selectedPromptSet?.customInstructions,
            targetWordCount
        });
        if (article) {
            addArticle(article);
        }
    };

    const handleStartGeneration = () => {
        // タイトルセット選択時
        if (selectedTitleSetId) {
            setShowMultiStep(true);
            return;
        }

        let finalKeywords = [...keywords];

        // 入力フィールドに値がある場合はそれも追加
        if (inputValue.trim()) {
            const trimmed = inputValue.trim();
            if (!finalKeywords.includes(trimmed)) {
                finalKeywords.push(trimmed);
                setKeywords(finalKeywords);
                setInputValue('');
            }
        }

        if (finalKeywords.length === 0) return;

        if (generationMode === 'interactive') {
            setShowMultiStep(true);
        } else {
            handleGenerate(finalKeywords);
        }
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
            await publishToWordPress(generatedArticle, configId, category, status, date);
        }
    };

    const [isFactChecking, setIsFactChecking] = useState(false);

    const handleManualFactCheck = async () => {
        if (!generatedArticle) return;

        setIsFactChecking(true);
        try {
            const { factCheckService } = await import('../../services/factCheckService');
            // Use current content from generatedArticle
            const facts = factCheckService.extractFacts(generatedArticle.content, factCheckNote);

            if (facts.length === 0) {
                toast.error('チェックすべき事実が見つかりませんでした');
                setIsFactChecking(false);
                return;
            }

            toast.loading('ファクトチェックを実行中...', { duration: 2000 });
            // Use primary keyword or first keyword
            const keyword = generatedArticle.keywords?.[0] || '';
            const results = await factCheckService.verifyFacts(facts, keyword, factCheckModel);

            // Update article with results
            // Note: We don't remove markers here as they might be part of the content if user didn't use auto-check
            // But if we want to support markers in content, we should check content too.
            // The current service extracts from content AND userMarkedText.

            const updatedArticle = {
                ...generatedArticle,
                content: generatedArticle.content.replace(/\[\[(.+?)\]\]/g, '$1'),
                factCheckResults: results
            };

            setGeneratedArticle(updatedArticle as any);
            updateArticle(generatedArticle.id, updatedArticle as any);

            const criticalIssues = results.filter(r => r.verdict === 'incorrect' && r.confidence >= 70).length;
            if (criticalIssues > 0) {
                toast.error(`重大な事実誤認が ${criticalIssues} 件見つかりました`, { duration: 5000 });
            } else {
                toast.success('ファクトチェックが完了しました');
            }

        } catch (error) {
            console.error('Fact check error:', error);
            toast.error('ファクトチェックに失敗しました');
        } finally {
            setIsFactChecking(false);
        }
    };

    const handleBackToForm = () => {
        clearArticle();
        setShowMultiStep(false);
    };

    const handleRegenerateArticle = async (options: import('./RegenerateModal').RegenerateOptions) => {
        if (!generatedArticle) return;

        try {
            toast.loading('記事を再生成中...', { duration: 3000 });

            // 調整指示のマッピング
            const adjustmentMap = {
                'none': '',
                'detailed': 'より詳しく、具体例や詳細な説明を追加してください。',
                'concise': 'より簡潔に、要点を絞って書き直してください。',
                'technical': 'より専門的に、技術用語や専門知識を含めて書き直してください。',
                'simple': 'より分かりやすく、初心者向けに平易な表現で書き直してください。'
            };

            // カスタムプロンプトの構築
            let customInstructions = `以下の記事を基に、${options.targetWordCount}文字程度で再生成してください。\n\n`;

            if (options.adjustmentType !== 'none') {
                customInstructions += adjustmentMap[options.adjustmentType] + '\n';
            }

            if (options.customPrompt) {
                customInstructions += options.customPrompt + '\n';
            }

            customInstructions += `\n【元の記事】\nタイトル: ${generatedArticle.title}\n\n${generatedArticle.content}`;

            // 記事を再生成
            const regenerated = await generateArticle({
                keywords: generatedArticle.keywords || [],
                tone: generatedArticle.tone,
                length: generatedArticle.length,
                customInstructions
            });

            if (regenerated) {
                toast.success('記事を再生成しました');
            }
        } catch (error) {
            console.error('Regeneration error:', error);
            toast.error('再生成に失敗しました');
        }
    };

    const handleMultiStepComplete = () => {
        setShowMultiStep(false);
    };

    // 対話モード表示中
    if (showMultiStep) {
        return (
            <MultiStepGenerator
                keywords={keywords}
                tone={tone}
                length={length}
                customInstructions={promptSets.find(ps => ps.id === selectedPromptSetId)?.customInstructions}
                selectedTitleSetId={selectedTitleSetId}
                selectedTitle={selectedTitle}
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
                                disabled={!!selectedTitleSetId}
                                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-md font-medium transition-all ${generationMode === 'auto'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    } ${!!selectedTitleSetId ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title={!!selectedTitleSetId ? 'タイトルセット使用時は対話モードのみ利用可能です' : ''}
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
                            disabled={isGenerating}
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

                    {/* Title Set Selector */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            タイトルセット（登録済みタイトルから選ぶ）
                        </label>
                        <select
                            value={selectedTitleSetId}
                            onChange={(e) => {
                                setSelectedTitleSetId(e.target.value);
                                setSelectedTitle('');
                                if (e.target.value) {
                                    setGenerationMode('interactive');
                                }
                            }}
                            disabled={isGenerating}
                            className="input-field"
                        >
                            <option value="">（指定なし）</option>
                            {(titleSets || []).map(ts => (
                                <option key={ts.id} value={ts.id}>
                                    {ts.name} ({ts.titles.length}個)
                                </option>
                            ))}
                        </select>
                        {selectedTitleSetId && (
                            <p className="text-xs text-gray-500 mt-1">
                                登録タイトルからタイトルを選択して記事を生成します
                            </p>
                        )}

                        {/* 個別タイトル選択 */}
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
                                        disabled={isGenerating}
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

                    {/* Keyword Set Selector */}
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
                                    // キーワードセットを選択したら、既存のキーワードをクリア
                                    setKeywords([]);
                                    setInputValue('');
                                }
                            }}
                            disabled={isGenerating}
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
                                                    disabled={isGenerating}
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

                    {/* Keywords - タイトルセットとキーワードセット未選択時のみ表示 */}
                    {!selectedKeywordSetId && (
                        <KeywordManager
                            keywords={keywords}
                            inputValue={inputValue}
                            onInputChange={setInputValue}
                            onAdd={handleAddKeyword}
                            onRemove={handleRemoveKeyword}
                            disabled={isGenerating}
                        />
                    )}

                    {/* Tone */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            トーン
                        </label>
                        <select
                            value={tone}
                            onChange={(e) => setTone(e.target.value as any)}
                            disabled={isGenerating}
                            className="input-field"
                        >
                            <option value="professional">プロフェッショナル</option>
                            <option value="casual">カジュアル</option>
                            <option value="technical">テクニカル</option>
                            <option value="friendly">フレンドリー</option>
                        </select>
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
                                disabled={isGenerating}
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
                                disabled={isGenerating}
                            >
                                2,000字
                            </button>
                            <button
                                type="button"
                                onClick={() => setTargetWordCount(4000)}
                                className={`px-3 py-2 text-sm rounded-md border transition-colors ${targetWordCount === 4000
                                    ? 'bg-purple-600 text-white border-purple-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                                    }`}
                                disabled={isGenerating}
                            >
                                4,000字
                            </button>
                        </div>
                        <input
                            type="number"
                            value={targetWordCount}
                            onChange={(e) => setTargetWordCount(parseInt(e.target.value) || 2000)}
                            min="500"
                            max="10000"
                            step="100"
                            disabled={isGenerating}
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
                        disabled={isGenerating || (!selectedTitleSetId && keywords.length === 0 && !inputValue.trim())}
                        className="w-full btn-primary flex items-center justify-center space-x-2"
                    >
                        {isGenerating ? (
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

                    {!selectedTitleSetId && keywords.length === 0 && (
                        <p className="text-sm text-gray-500 text-center">
                            キーワードを追加するか、タイトルセットを選択してください
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
                            {generatedArticle.factCheckResults && (
                                <FactCheckResultsDisplay results={generatedArticle.factCheckResults} />
                            )}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">記事編集</h3>
                                <ArticleEditor
                                    article={generatedArticle}
                                    onUpdate={handleUpdateArticle}
                                    onRegenerate={handleRegenerateArticle}
                                    onFactCheck={handleManualFactCheck}
                                    isFactChecking={isFactChecking}
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
