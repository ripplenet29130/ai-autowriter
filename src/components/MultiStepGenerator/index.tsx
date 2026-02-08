import React, { useState, useEffect } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useMultiStepGeneration } from '../../hooks/useMultiStepGeneration';
import { useAppStore } from '../../store/useAppStore';
import { StepIndicator } from './StepIndicator';
import { TrendAnalysisStep } from './TrendAnalysisStep';
import { TitleSelectionStep } from './TitleSelectionStep';
import { OutlineEditorStep } from './OutlineEditorStep';
import { ContentGenerationStep } from './ContentGenerationStep';
import { GenerationStep } from '../../types';
import toast from 'react-hot-toast';

interface MultiStepGeneratorProps {
    keywords: string[];
    tone: 'professional' | 'casual' | 'technical' | 'friendly';
    length: 'short' | 'medium' | 'long';
    customInstructions?: string;
    selectedTitleSetId?: string;
    selectedTitle?: string;
    targetWordCount?: number;
    onComplete: () => void;
    onBack: () => void;
}

export const MultiStepGenerator: React.FC<MultiStepGeneratorProps> = ({
    keywords,
    tone,
    length,
    customInstructions,
    selectedTitleSetId,
    selectedTitle,
    targetWordCount,
    onComplete,
    onBack
}) => {
    const { addArticle, updateArticle: updateGlobalArticle, titleSets } = useAppStore();
    const selectedTitleSet = selectedTitleSetId
        ? titleSets.find(ts => ts.id === selectedTitleSetId)
        : null;

    const {
        currentStep,
        stepResults,
        trendData,
        titles,
        outline,
        article,
        isGenerating,
        executeStep1,
        executeStep2,
        executeStep3,
        executeStep4,
        updateOutline,
        updateSection,
        addSection,
        removeSection,
        reorderSections,
        updateArticle,
        nextStep,
        previousStep,
        reset,
        keywordPreferences,
        toggleKeywordPreference,
        addKeywordPreference
    } = useMultiStepGeneration();

    const [hasStarted, setHasStarted] = useState(false);
    const [localSelectedTitle, setLocalSelectedTitle] = useState<string | null>(selectedTitle || null);

    // 完了したステップを取得
    const completedSteps: GenerationStep[] = stepResults
        .filter(r => r.status === 'completed')
        .map(r => r.step);

    // Step 1を自動実行
    useEffect(() => {
        if (!hasStarted) {
            setHasStarted(true);

            // タイトルセット選択時はStep 2（タイトル選択）へ即座に移動
            if (selectedTitleSet) {
                // Step 2へ進むには、currentStepを2にする必要があるが、
                // useMultiStepGenerationの初期値は1。
                // trendDataがない状態でStep 2のTitleSelectionStepを表示することになる。
                // nextStep()を呼ぶと +1 される
                nextStep();
                return;
            }

            if (keywords.length > 0) {
                handleStep1();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // 依存配列を空にして初回のみ実行

    // Step 1: 競合調査 (競合分析を実行するが、自動でStep 2には進まない)
    const handleStep1 = async () => {
        if (trendData) {
            // 既にtrendDataがある場合は何もしない（ユーザーが次へボタンを押すのを待つ）
            return;
        };
        await executeStep1(keywords);
        // Step 1完了後はここで止まり、ユーザーが競合分析結果を確認できる
        // ユーザーが「次へ」ボタンを押すとhandleStep2Generateが呼ばれる
    };

    // Step 2: タイトル生成
    // trendDataを引数で受け取るように変更（stale closure対策）
    const handleStep2Generate = async (trendDataParam?: typeof trendData) => {
        const effectiveTrendData = trendDataParam || trendData;
        if (!effectiveTrendData) return;
        await executeStep2(effectiveTrendData);
    };

    // Step 3: アウトライン生成
    const handleStep3Generate = async () => {
        if (!trendData && !selectedTitleSet) return;

        // タイトルセット使用時はトレンドデータがないためダミーを作成
        const effectiveTrendData = trendData || {
            keyword: keywords[0] || (selectedTitleSet ? '指定タイトル' : ''),
            searchVolume: 0,
            competition: 'medium',
            trendScore: 0,
            relatedKeywords: [],
            hotTopics: [],
            seoData: {
                difficulty: 50,
                opportunity: 50,
                suggestions: []
            },
            competitorAnalysis: {
                topArticles: [],
                averageLength: 0,
                commonTopics: []
            },
            userInterest: {
                risingQueries: [],
                breakoutQueries: [],
                geographicData: []
            },
            timestamp: new Date()
        } as any;

        await executeStep3(keywords, effectiveTrendData, {
            targetLength: length,
            tone,
            selectedTitle: localSelectedTitle || undefined,
            customInstructions,
            targetWordCount // 追加
        });
    };

    // Step 4: 本文生成
    const handleStep4Generate = async () => {
        if (!outline) return;

        const result = await executeStep4(outline, {
            tone,
            customInstructions
        });

        if (result) {
            // 記事をストアに追加
            addArticle(result);


        }
    };

    // ステップをレンダリング
    const renderCurrentStep = () => {
        switch (currentStep) {
            case 1:
            case 1:
                if (isGenerating) {
                    return (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4" />
                            <p className="text-lg font-medium text-gray-900">記事生成の準備中...</p>
                            <p className="text-sm text-gray-500 mt-2">
                                競合分析とトレンド調査を行っています
                            </p>
                        </div>
                    );
                }
                return (
                    <TrendAnalysisStep
                        trendData={trendData}
                        isLoading={isGenerating}
                        onNext={() => handleStep2Generate()}
                        onBack={onBack}
                        keywordPreferences={keywordPreferences}
                        onKeywordToggle={toggleKeywordPreference}
                        onAddKeyword={addKeywordPreference}
                    />
                );
            case 2:
                return (
                    <TitleSelectionStep
                        titles={titles}
                        titleSet={selectedTitleSet || undefined}
                        isLoading={isGenerating}
                        onGenerate={handleStep2Generate}
                        onSelect={setLocalSelectedTitle}
                        onNext={async () => {
                            await handleStep3Generate();
                        }}
                        onBack={selectedTitleSet ? onBack : previousStep}
                    />
                );
            case 3:
                return (
                    <OutlineEditorStep
                        keywords={keywords}
                        trendData={trendData}
                        outline={outline}
                        isGenerating={isGenerating}
                        onGenerate={handleStep3Generate}
                        onUpdateOutline={updateOutline}
                        onUpdateSection={updateSection}
                        onAddSection={addSection}
                        onRemoveSection={removeSection}
                        onReorderSections={reorderSections}
                        onNext={handleStep4Generate}
                        onBack={previousStep}
                    />
                );
            case 4:
                return (
                    <ContentGenerationStep
                        outline={outline}
                        article={article}
                        isGenerating={isGenerating}
                        onGenerate={handleStep4Generate}
                        onUpdateArticle={updateArticle}
                        onBack={previousStep}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <button
                        onClick={onBack}
                        className="btn-secondary flex items-center space-x-2"
                        disabled={isGenerating}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>戻る</span>
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
                            <Sparkles className="w-7 h-7 text-purple-600" />
                            <span>対話型記事生成</span>
                        </h2>
                        <p className="text-gray-600 text-sm mt-1">
                            キーワード: {keywords.join(', ')}
                        </p>
                    </div>
                </div>
            </div>

            {/* ステップインジケーター */}
            <StepIndicator
                currentStep={(currentStep === 1 ? 1 : currentStep === 2 ? 1 : currentStep === 3 ? 2 : 3) as any}
                completedSteps={completedSteps.map(s => s === 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 0).filter(s => s > 0) as any}
            />

            {/* 現在のステップ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {renderCurrentStep()}
            </div>
        </div>
    );
};
