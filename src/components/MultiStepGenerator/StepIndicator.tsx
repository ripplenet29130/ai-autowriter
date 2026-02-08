import React from 'react';
import {
    Check,
    Search,
    Type,
    Layout,
    FileText
} from 'lucide-react';
import { GenerationStep } from '../../types';

interface StepIndicatorProps {
    currentStep: GenerationStep;
    completedSteps: GenerationStep[];
}

const steps = [
    { step: 1, label: 'タイトル', icon: Type, description: '魅力的な案の選定' },
    { step: 2, label: 'アウトライン', icon: Layout, description: '構成の設計' },
    { step: 3, label: '本文生成', icon: FileText, description: 'AI執筆完了' }
];

/**
 * プレミアムなステップインジケーター
 */
export const StepIndicator: React.FC<StepIndicatorProps> = ({
    currentStep,
    completedSteps
}) => {
    const isStepCompleted = (step: number) => completedSteps.includes(step as GenerationStep);
    const isStepCurrent = (step: number) => currentStep === step;

    return (
        <div className="w-full py-8 mb-4">
            <div className="flex items-start justify-between relative">
                {/* 背景の接続線 */}
                <div className="absolute top-6 left-0 w-full h-0.5 bg-gray-100 -z-10" />

                {steps.map((stepInfo, index) => {
                    const Icon = stepInfo.icon;
                    const completed = isStepCompleted(stepInfo.step);
                    const current = isStepCurrent(stepInfo.step);

                    return (
                        <div key={stepInfo.step} className="flex flex-col items-center relative z-10 px-2 flex-1">
                            {/* アイコンサークル */}
                            <div
                                className={`
                                    w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500
                                    ${completed
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-100 scale-110'
                                        : current
                                            ? 'bg-white border-2 border-blue-600 text-blue-600 shadow-xl shadow-blue-50 ring-4 ring-blue-50 scale-125'
                                            : 'bg-white border-2 border-gray-100 text-gray-300'
                                    }
                                `}
                            >
                                {completed ? (
                                    <Check className="w-6 h-6 animate-in zoom-in duration-300" />
                                ) : (
                                    <Icon className={`w-5 h-5 ${current ? 'animate-pulse' : ''}`} />
                                )}
                            </div>

                            {/* ラベルセクション */}
                            <div className="mt-4 text-center max-w-[120px]">
                                <p
                                    className={`
                                        text-xs font-black uppercase tracking-widest transition-colors duration-300
                                        ${completed || current ? 'text-gray-900' : 'text-gray-300'}
                                    `}
                                >
                                    {stepInfo.label}
                                </p>
                                <p className={`
                                    text-[10px] mt-1 font-medium leading-tight transition-opacity duration-300
                                    ${current ? 'text-blue-600 opacity-100' : 'text-gray-400 opacity-60'}
                                `}>
                                    {stepInfo.description}
                                </p>
                            </div>

                            {/* 次のステップへのプログレス線（アクティブ時） */}
                            {index < steps.length - 1 && (
                                <div
                                    className={`
                                        absolute top-6 left-[calc(50%+1.5rem)] w-[calc(100%-3rem)] h-0.5 transition-all duration-1000
                                        ${completed ? 'bg-blue-600' : 'bg-transparent'}
                                    `}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
