import React, { useState, useEffect } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useMultiStepGeneration } from '../../hooks/useMultiStepGeneration';
import { useAppStore } from '../../store/useAppStore';
import { StepIndicator } from './StepIndicator';
import { TrendAnalysisStep } from './TrendAnalysisStep';
import { TitleSelectionStep } from './TitleSelectionStep';
import { OutlineEditorStep } from './OutlineEditorStep';
import { ContentGenerationStep } from './ContentGenerationStep';
import { Article, ArticleGoal, ArticleStructureType, GenerationStep } from '../../types';

interface MultiStepGeneratorProps {
  keywords: string[];
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  length: 'short' | 'medium' | 'long';
  articleGoal?: ArticleGoal;
  articleStructureType?: ArticleStructureType;
  customInstructions?: string;
  selectedTitleSetId?: string;
  selectedTitle?: string;
  targetWordCount?: number;
  onComplete: (article: Article) => void;
  onBack: () => void;
}

export const MultiStepGenerator: React.FC<MultiStepGeneratorProps> = ({
  keywords,
  tone,
  length,
  articleGoal,
  articleStructureType,
  customInstructions,
  selectedTitleSetId,
  selectedTitle,
  targetWordCount,
  onComplete,
  onBack,
}) => {
  const { addArticle, titleSets } = useAppStore();
  const selectedTitleSet = selectedTitleSetId
    ? titleSets.find((ts) => ts.id === selectedTitleSetId)
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
    previousStep,
    goToStep,
    keywordPreferences,
    toggleKeywordPreference,
    addKeywordPreference,
  } = useMultiStepGeneration();

  const [hasStarted, setHasStarted] = useState(false);
  const [localSelectedTitle, setLocalSelectedTitle] = useState<string | null>(selectedTitle || null);
  const shouldAutoSkipTitleSelection = Boolean((selectedTitle || '').trim());

  const completedSteps: GenerationStep[] = stepResults
    .filter((r) => r.status === 'completed')
    .map((r) => r.step);
  const visualCompletedSteps: GenerationStep[] = (() => {
    const stepSet = new Set<GenerationStep>(completedSteps);
    if (shouldAutoSkipTitleSelection && (currentStep >= 3 || stepSet.has(3) || stepSet.has(4))) {
      stepSet.add(2);
    }
    return Array.from(stepSet.values()) as GenerationStep[];
  })();

  useEffect(() => {
    if (!hasStarted) {
      setHasStarted(true);
      if (keywords.length > 0) {
        void handleStep1();
      }
    }
  }, []);

  useEffect(() => {
    setLocalSelectedTitle(selectedTitle || null);
  }, [selectedTitle]);

  useEffect(() => {
    if (shouldAutoSkipTitleSelection && currentStep === 2) {
      goToStep(3);
    }
  }, [shouldAutoSkipTitleSelection, currentStep, goToStep]);

  const handleStep1 = async () => {
    if (trendData) return;
    await executeStep1(keywords);
  };

  const handleStep2Generate = async (trendDataParam?: typeof trendData) => {
    const effectiveTrendData = trendDataParam || trendData;
    if (!effectiveTrendData) return;
    await executeStep2(effectiveTrendData);
  };

  const handleStep3Generate = async () => {
    if (!trendData) return;

    await executeStep3(keywords, trendData, {
      targetLength: length,
      tone,
      selectedTitle: localSelectedTitle || undefined,
      customInstructions,
      targetWordCount,
      articleStructureType,
    });
  };

    const handleStep4Generate = async (latestOutline: typeof outline) => {
      if (!latestOutline) return;

      const result = await executeStep4(latestOutline, {
        tone,
        customInstructions,
        targetWordCount,
      });

    if (result) {
      result.articleGoal = articleGoal || 'standard';
      result.articleStructureType = articleStructureType || 'standard';
      addArticle(result);
      onComplete(result);
    }
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        if (isGenerating) {
          return (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4" />
            <p className="text-lg font-medium text-gray-900">キーワード検索を実行中...</p>
              <p className="text-sm text-gray-500 mt-2">キーワードから検索需要と競合情報を取得しています</p>
            </div>
          );
        }

        if (!trendData) {
          return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg font-medium text-gray-900">キーワード検索が未実行です</p>
              <p className="text-sm text-gray-500 mt-2">キーワードを分析してから次のステップへ進みます</p>
              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={handleStep1}
                  disabled={keywords.length === 0}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
            キーワード検索を実行
                </button>
                <button onClick={onBack} className="btn-secondary">
                  戻る
                </button>
              </div>
              {keywords.length === 0 && (
                <p className="text-xs text-amber-600 mt-3">キーワードが未設定です。前の画面で設定してください。</p>
              )}
            </div>
          );
        }

        return (
          <TrendAnalysisStep
            trendData={trendData}
            isLoading={isGenerating}
            onNext={() => void (shouldAutoSkipTitleSelection ? handleStep3Generate() : handleStep2Generate())}
            onBack={onBack}
            nextLabel={shouldAutoSkipTitleSelection ? '見出し作成へ進む' : 'タイトル生成へ進む'}
            keywordPreferences={keywordPreferences}
            onKeywordToggle={toggleKeywordPreference}
            onAddKeyword={addKeywordPreference}
          />
        );
      case 2:
        if (shouldAutoSkipTitleSelection) {
          return (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4" />
              <p className="text-lg font-medium text-gray-900">構成作成へ移動中...</p>
            </div>
          );
        }

        return (
          <TitleSelectionStep
            titles={titles}
            titleSet={selectedTitleSet || undefined}
            isLoading={isGenerating}
            onGenerate={() => void handleStep2Generate()}
            onSelect={setLocalSelectedTitle}
            onNext={() => void handleStep3Generate()}
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
            onGenerate={() => void handleStep3Generate()}
            onUpdateOutline={updateOutline}
            onUpdateSection={updateSection}
            onAddSection={addSection}
            onRemoveSection={removeSection}
            onReorderSections={reorderSections}
            onNext={(latestOutline) => void handleStep4Generate(latestOutline)}
            onBack={shouldAutoSkipTitleSelection ? () => goToStep(1) : previousStep}
          />
        );
      case 4:
        return (
          <ContentGenerationStep
            outline={outline}
            article={article}
            isGenerating={isGenerating}
            onGenerate={() => void handleStep4Generate(outline)}
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
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="btn-secondary flex items-center space-x-2" disabled={isGenerating}>
            <ArrowLeft className="w-4 h-4" />
            <span>戻る</span>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
              <Sparkles className="w-7 h-7 text-purple-600" />
              <span>対話型記事生成</span>
            </h2>
            <p className="text-gray-600 text-sm mt-1">キーワード: {keywords.join(', ')}</p>
          </div>
        </div>
      </div>

      <StepIndicator
        currentStep={currentStep}
        completedSteps={visualCompletedSteps}
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">{renderCurrentStep()}</div>
    </div>
  );
};
