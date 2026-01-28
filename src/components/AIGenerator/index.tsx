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

/**
 * AI記事生成メインコンポーネント
 */
export const AIGenerator: React.FC = () => {
    const { addArticle, updateArticle, wordPressConfigs, promptSets } = useAppStore();
    const { isGenerating, generatedArticle, generateArticle, clearArticle, setGeneratedArticle } = useArticleGeneration();
    const { isPublishing, publishToWordPress } = useWordPressPublish();

    const [inputValue, setInputValue] = useState('');
    const [keywords, setKeywords] = useState<string[]>([]);
    const [tone, setTone] = useState<'professional' | 'casual' | 'technical' | 'friendly'>('professional');
    const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
    const [generationMode, setGenerationMode] = useState<'auto' | 'interactive'>('interactive');
    const [showMultiStep, setShowMultiStep] = useState(false);

    // Publish Status State
    const [publishStatus, setPublishStatus] = useState<'publish' | 'draft' | 'future'>('publish');
    const [scheduledDate, setScheduledDate] = useState<string>('');

    // Prompt Set State
    const [selectedPromptSetId, setSelectedPromptSetId] = useState<string>('');
    const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

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
            customInstructions: selectedPromptSet?.customInstructions
        });
        if (article) {
            addArticle(article);
        }
    };

    const handleStartGeneration = () => {
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

    const handleBackToForm = () => {
        clearArticle();
        setShowMultiStep(false);
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
                                <span>対話モード</span>
                            </button>
                            <button
                                onClick={() => setGenerationMode('auto')}
                                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 rounded-md font-medium transition-all ${generationMode === 'auto'
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                <Zap className="w-4 h-4" />
                                <span>自動モード</span>
                            </button>
                        </div>

                        {generationMode === 'auto' ? (
                            <p className="text-sm text-gray-600 mb-4">
                                すべての工程を自動で実行し、記事を生成します
                            </p>
                        ) : (
                            <p className="text-sm text-gray-600 mb-4">
                                トレンド分析 → アウトライン編集 → 本文生成の順に進めます
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
                            {promptSets.map(ps => (
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

                    {/* Keywords */}
                    <KeywordManager
                        keywords={keywords}
                        inputValue={inputValue}
                        onInputChange={setInputValue}
                        onAdd={handleAddKeyword}
                        onRemove={handleRemoveKeyword}
                        disabled={isGenerating}
                    />

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

                    {/* Length */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            記事の長さ
                        </label>
                        <select
                            value={length}
                            onChange={(e) => setLength(e.target.value as any)}
                            disabled={isGenerating}
                            className="input-field"
                        >
                            <option value="short">短い（約1,000文字以上）</option>
                            <option value="medium">中程度（約2,000文字以上）</option>
                            <option value="long">長い（約4,000文字以上）</option>
                        </select>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleStartGeneration}
                        disabled={isGenerating || (keywords.length === 0 && !inputValue.trim())}
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

                    {keywords.length === 0 && (
                        <p className="text-sm text-gray-500 text-center">
                            キーワードを追加して記事を生成してください
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
                        {/* Article Editor */}
                        <div className="lg:col-span-2">
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 mb-4">記事編集</h3>
                                <ArticleEditor
                                    article={generatedArticle}
                                    onUpdate={handleUpdateArticle}
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
