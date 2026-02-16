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

    // 螳御ｺ・＠縺溘せ繝・ャ繝励ｒ蜿門ｾ・
    const completedSteps: GenerationStep[] = stepResults
        .filter(r => r.status === 'completed')
        .map(r => r.step);

    // Step 1繧定・蜍募ｮ溯｡・
    useEffect(() => {
        if (!hasStarted) {
            setHasStarted(true);

            // 繧ｿ繧､繝医Ν繧ｻ繝・ヨ驕ｸ謚樊凾縺ｯStep 2・医ち繧､繝医Ν驕ｸ謚橸ｼ峨∈蜊ｳ蠎ｧ縺ｫ遘ｻ蜍・
            if (selectedTitleSet) {
                // Step 2縺ｸ騾ｲ繧縺ｫ縺ｯ縲…urrentStep繧・縺ｫ縺吶ｋ蠢・ｦ√′縺ゅｋ縺後・
                // useMultiStepGeneration縺ｮ蛻晄悄蛟､縺ｯ1縲・
                // trendData縺後↑縺・憾諷九〒Step 2縺ｮTitleSelectionStep繧定｡ｨ遉ｺ縺吶ｋ縺薙→縺ｫ縺ｪ繧九・
                // nextStep()繧貞他縺ｶ縺ｨ +1 縺輔ｌ繧・
                nextStep();
                return;
            }

            if (keywords.length > 0) {
                handleStep1();
            }
        }
    }, []); // 萓晏ｭ倬・蛻励ｒ遨ｺ縺ｫ縺励※蛻晏屓縺ｮ縺ｿ螳溯｡・

    // Step 1: 遶ｶ蜷郁ｪｿ譟ｻ (遶ｶ蜷亥・譫舌ｒ螳溯｡後☆繧九′縲∬・蜍輔〒Step 2縺ｫ縺ｯ騾ｲ縺ｾ縺ｪ縺・
    const handleStep1 = async () => {
        if (trendData) {
            // 譌｢縺ｫtrendData縺後≠繧句ｴ蜷医・菴輔ｂ縺励↑縺・ｼ医Θ繝ｼ繧ｶ繝ｼ縺梧ｬ｡縺ｸ繝懊ち繝ｳ繧呈款縺吶・繧貞ｾ・▽・・
            return;
        };
        await executeStep1(keywords);
        // Step 1螳御ｺ・ｾ後・縺薙％縺ｧ豁｢縺ｾ繧翫√Θ繝ｼ繧ｶ繝ｼ縺檎ｫｶ蜷亥・譫千ｵ先棡繧堤｢ｺ隱阪〒縺阪ｋ
        // 繝ｦ繝ｼ繧ｶ繝ｼ縺後梧ｬ｡縺ｸ縲阪・繧ｿ繝ｳ繧呈款縺吶→handleStep2Generate縺悟他縺ｰ繧後ｋ
    };

    // Step 2: 繧ｿ繧､繝医Ν逕滓・
    // trendData繧貞ｼ墓焚縺ｧ蜿励￠蜿悶ｋ繧医≧縺ｫ螟画峩・・tale closure蟇ｾ遲厄ｼ・
    const handleStep2Generate = async (trendDataParam?: typeof trendData) => {
        const effectiveTrendData = trendDataParam || trendData;
        if (!effectiveTrendData) return;
        await executeStep2(effectiveTrendData);
    };

    // Step 3: 繧｢繧ｦ繝医Λ繧､繝ｳ逕滓・
    const handleStep3Generate = async () => {
        if (!trendData && !selectedTitleSet) return;

        // 繧ｿ繧､繝医Ν繧ｻ繝・ヨ菴ｿ逕ｨ譎ゅ・繝医Ξ繝ｳ繝峨ョ繝ｼ繧ｿ縺後↑縺・◆繧√ム繝溘・繧剃ｽ懈・
        const effectiveTrendData = trendData || {
            keyword: keywords[0] || (selectedTitleSet ? '謖・ｮ壹ち繧､繝医Ν' : ''),
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
            targetWordCount // 霑ｽ蜉
        });
    };

    // Step 4: 譛ｬ譁・函謌・
    const handleStep4Generate = async () => {
        if (!outline) return;

        const result = await executeStep4(outline, {
            tone,
            customInstructions
        });

        if (result) {
            // 險倅ｺ九ｒ繧ｹ繝医い縺ｫ霑ｽ蜉
            addArticle(result);


        }
    };

    // 繧ｹ繝・ャ繝励ｒ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ
    const renderCurrentStep = () => {
        switch (currentStep) {
            case 1:
                if (isGenerating) {
                    return (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4" />
                            <p className="text-lg font-medium text-gray-900">險倅ｺ狗函謌舌・貅門ｙ荳ｭ...</p>
                            <p className="text-sm text-gray-500 mt-2">
                                遶ｶ蜷亥・譫舌→繝医Ξ繝ｳ繝芽ｪｿ譟ｻ繧定｡後▲縺ｦ縺・∪縺・
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
            {/* 繝倥ャ繝繝ｼ */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <button
                        onClick={onBack}
                        className="btn-secondary flex items-center space-x-2"
                        disabled={isGenerating}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>謌ｻ繧・</span>
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center space-x-2">
                            <Sparkles className="w-7 h-7 text-purple-600" />
                            <span>蟇ｾ隧ｱ蝙玖ｨ倅ｺ狗函謌・</span>
                        </h2>
                        <p className="text-gray-600 text-sm mt-1">
                            繧ｭ繝ｼ繝ｯ繝ｼ繝・ {keywords.join(', ')}
                        </p>
                    </div>
                </div>
            </div>

            {/* 繧ｹ繝・ャ繝励う繝ｳ繧ｸ繧ｱ繝ｼ繧ｿ繝ｼ */}
            <StepIndicator
                currentStep={(currentStep === 1 ? 1 : currentStep === 2 ? 1 : currentStep === 3 ? 2 : 3) as any}
                completedSteps={completedSteps.map(s => s === 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 0).filter(s => s > 0) as any}
            />

            {/* 迴ｾ蝨ｨ縺ｮ繧ｹ繝・ャ繝・*/}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                {renderCurrentStep()}
            </div>
        </div>
    );
};



