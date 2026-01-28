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

interface MultiStepGeneratorProps {
    keywords: string[];
    tone: 'professional' | 'casual' | 'technical' | 'friendly';
    length: 'short' | 'medium' | 'long';
    customInstructions?: string;
    onComplete: () => void;
    onBack: () => void;
}

export const MultiStepGenerator: React.FC<MultiStepGeneratorProps> = ({
    keywords,
    tone,
    length,
    customInstructions,
    onComplete,
    onBack
}) => {
    const { addArticle } = useAppStore();
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
    const [selectedTitle, setSelectedTitle] = useState<string | null>(null);

    // 完了したステップを取得
    const completedSteps: GenerationStep[] = stepResults
        .filter(r => r.status === 'completed')
        .map(r => r.step);

    // Step 1を自動実行
    useEffect(() => {
        if (!hasStarted && keywords.length > 0) {
            setHasStarted(true);
            handleStep1();
        }
    }, [keywords, hasStarted]);

    // Step 1: 競合調査
    const handleStep1 = async () => {
        if (trendData) return;
        await executeStep1(keywords);
    };

    // Step 2: タイトル生成
    const handleStep2Generate = async () => {
        if (!trendData) return;
        await executeStep2(trendData);
    };

    // Step 3: アウトライン生成
    const handleStep3Generate = async () => {
        if (!trendData) return;

        await executeStep3(keywords, trendData, {
            targetLength: length,
            tone,
            selectedTitle: selectedTitle || undefined,
            customInstructions
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
                return (
                    <TrendAnalysisStep
                        trendData={trendData}
                        isLoading={isGenerating}
                        keywordPreferences={keywordPreferences}
                        onKeywordToggle={toggleKeywordPreference}
                        onAddKeyword={addKeywordPreference}
                        onNext={async () => {
                            await handleStep2Generate();
                        }}
                        onBack={onBack}
                    />
                );
            case 2:
                return (
                    <TitleSelectionStep
                        titles={titles}
                        isLoading={isGenerating}
                        onGenerate={handleStep2Generate}
                        onSelect={setSelectedTitle}
                        onNext={async () => {
                            await handleStep3Generate();
                        }}
                        onBack={previousStep}
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
            <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

            {/* 現在のステップ */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {renderCurrentStep()}
            </div>
        </div>
    );
};
