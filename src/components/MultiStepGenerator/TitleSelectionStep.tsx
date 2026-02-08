import React, { useState } from 'react';
import { Type, Sparkles, ArrowRight, Check, MousePointer2, Info, ArrowLeft } from 'lucide-react';
import { TitleSuggestion, TitleSet } from '../../types';

interface TitleSelectionStepProps {
    titles: TitleSuggestion[] | undefined;
    titleSet?: TitleSet;
    isLoading: boolean;
    onGenerate: () => void;
    onSelect: (title: string) => void;
    onNext: () => void;
    onBack: () => void;
}

export const TitleSelectionStep: React.FC<TitleSelectionStepProps> = ({
    titles,
    titleSet,
    isLoading,
    onGenerate,
    onSelect,
    onNext,
    onBack
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // タイトルセットがある場合はそれを変換して表示、なければ生成されたタイトルを使用
    const displayTitles: TitleSuggestion[] | undefined = titleSet
        ? titleSet.titles.map((t, i) => ({
            id: `preset-${i}`,
            title: t,
            description: 'タイトルセットから選択',
            // ダミーデータ
            keyword: '',
            trendScore: 0,
            searchVolume: 0,
            competition: 'medium',
            seoScore: 0,
            clickPotential: 0,
            targetAudience: '',
            contentAngle: '',
            relatedKeywords: []
        }))
        : titles;

    const handleSelect = (title: TitleSuggestion) => {
        setSelectedId(title.id);
        onSelect(title.title);
    };

    if (isLoading && (!displayTitles || displayTitles.length === 0)) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-lg font-medium text-gray-900">タイトル案を生成中...</p>
                <p className="text-sm text-gray-500 mt-2">
                    競合記事の傾向を分析し、最適なタイトルを考えています
                </p>
            </div>
        );
    }

    if (!displayTitles || displayTitles.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Type className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">タイトル案を作成しましょう</h3>
                <p className="text-gray-600 mb-6">
                    競合調査の結果を基に、読者を惹きつけるタイトルを生成します。
                </p>
                <button
                    onClick={onGenerate}
                    disabled={isLoading}
                    className="btn-primary flex items-center space-x-2 mx-auto"
                >
                    <Sparkles className="w-4 h-4" />
                    <span>タイトル案を生成する</span>
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                        <Type className="w-6 h-6 text-blue-600" />
                        <span>{titleSet ? 'タイトルの選択' : 'タイトル案の選択'}</span>
                    </h3>
                    <p className="text-gray-600 mt-1">
                        {titleSet
                            ? `「${titleSet.name}」から記事にするタイトルを選んでください`
                            : 'AIが作成したタイトル案から、記事に最適なものを選んでください'
                        }
                    </p>
                </div>
                {!titleSet && (
                    <button
                        onClick={onGenerate}
                        disabled={isLoading}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                    >
                        <Sparkles className="w-4 h-4" />
                        <span>再生成する</span>
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4">
                {displayTitles.map((suggestion) => (
                    <div
                        key={suggestion.id}
                        onClick={() => handleSelect(suggestion)}
                        className={`
                            relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200
                            ${selectedId === suggestion.id
                                ? 'border-blue-500 bg-blue-50 shadow-md transform scale-[1.01]'
                                : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50'
                            }
                        `}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <h4 className="font-bold text-gray-900 text-lg mb-1">{suggestion.title}</h4>
                                <p className="text-sm text-gray-600 leading-relaxed mb-3">
                                    {suggestion.description}
                                </p>

                            </div>
                            <div className={`
                                w-6 h-6 rounded-full border-2 flex items-center justify-center mt-1 transition-colors
                                ${selectedId === suggestion.id
                                    ? 'bg-blue-500 border-blue-500 text-white'
                                    : 'border-gray-300'
                                }
                            `}>
                                {selectedId === suggestion.id && <Check className="w-4 h-4" />}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-gray-100">
                <button
                    onClick={onBack}
                    className="btn-secondary flex items-center space-x-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{titleSet ? '設定に戻る' : '競合調査に戻る'}</span>
                </button>
                <div className="flex items-center text-sm text-gray-500">
                    <Info className="w-4 h-4 mr-1.5" />
                    <span>タイトルを選んで次へ進んでください</span>
                </div>
                <button
                    onClick={onNext}
                    disabled={!selectedId}
                    className="btn-primary flex items-center space-x-2"
                >
                    <span>アウトライン作成へ</span>
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
