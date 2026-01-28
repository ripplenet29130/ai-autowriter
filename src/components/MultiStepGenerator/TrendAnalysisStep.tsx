import React from 'react';
import { TrendingUp, Users, ArrowRight, Loader2, ChevronDown, List, ArrowLeft, ExternalLink, Sparkles } from 'lucide-react';
import { TrendAnalysisResult } from '../../types';

interface TrendAnalysisStepProps {
    trendData: TrendAnalysisResult | undefined;
    isLoading: boolean;
    onNext: () => void;
    onBack: () => void;
    keywordPreferences: Record<string, import('../../types').KeywordPreference>;
    onKeywordToggle: (keyword: string) => void;
    onAddKeyword: (keyword: string, preference: import('../../types').KeywordPreference) => void;
}

/**
 * ステップ1: 競合調査・トレンド分析の表示
 */
export const TrendAnalysisStep: React.FC<TrendAnalysisStepProps> = ({
    trendData,
    isLoading,
    onNext,
    onBack,
    keywordPreferences,
    onKeywordToggle,
    onAddKeyword
}) => {
    const [expandedIndex, setExpandedIndex] = React.useState<number | null>(null);
    const [ngInput, setNgInput] = React.useState('');
    const [essentialInput, setEssentialInput] = React.useState('');

    const handleAddNgKeyword = () => {
        if (ngInput.trim()) {
            onAddKeyword(ngInput.trim(), 'ng');
            setNgInput('');
        }
    };

    const handleAddEssentialKeyword = () => {
        if (essentialInput.trim()) {
            onAddKeyword(essentialInput.trim(), 'essential');
            setEssentialInput('');
        }
    };

    if (isLoading || !trendData) {
        return (
            <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                <p className="text-lg font-medium text-gray-900">競合記事を調査中...</p>
                <p className="text-sm text-gray-500 mt-2">
                    Google検索上位の記事からタイトル・見出し・本文を分析しています
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* ヘッダー */}
            <div>
                <h3 className="text-xl font-bold text-gray-900 flex items-center space-x-2">
                    <TrendingUp className="w-6 h-6 text-blue-600" />
                    <span>競合調査結果</span>
                </h3>
                <p className="text-gray-600 mt-1">
                    キーワード「{trendData.keyword}」の検索上位記事を分析しました
                </p>
            </div>

            {/* 競合記事リスト */}
            <div className="space-y-4">
                <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    <span>分析対象の上位記事</span>
                </h4>
                <div className="grid grid-cols-1 gap-4">
                    {trendData.competitorAnalysis.topArticles.map((article, index) => (
                        <div key={index} className="bg-white border border-gray-200 rounded-xl hover:shadow-md transition-all divide-y divide-gray-100 overflow-hidden">
                            <div className="p-5">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <a
                                                href={article.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-all flex items-center gap-1"
                                                title="サイトを見る"
                                            >
                                                {article.domain}
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                            <span className="text-xs text-gray-500">
                                                約 {article.wordCount.toLocaleString()} 文字
                                            </span>
                                        </div>
                                        <h5 className="font-bold text-gray-900 text-lg leading-tight">
                                            {article.title}
                                        </h5>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                            title="構成を分析"
                                        >
                                            {expandedIndex === index ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <List className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>

                                <p className="text-sm text-gray-600 line-clamp-2">
                                    {article.metaDescription || "要約データなし"}
                                </p>
                            </div>

                            {/* 見出し構成プレビュー */}
                            {expandedIndex === index && (
                                <div className="bg-gray-50/50 p-5 animate-in slide-in-from-top-2 duration-300">
                                    <h6 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                        <List className="w-4 h-4 text-blue-500" />
                                        記事構成分析の結果
                                    </h6>
                                    {article.headings && article.headings.length > 0 ? (
                                        <div className="space-y-2">
                                            {article.headings.map((h, i) => {
                                                const isH2 = h.startsWith('## ') || !h.startsWith('#');
                                                return (
                                                    <div key={i} className={`text-sm ${isH2 ? 'font-semibold text-gray-800' : 'pl-4 text-gray-600 flex items-start gap-1'}`}>
                                                        {!isH2 && <span className="text-gray-300 mt-0.5 ml-2">•</span>}
                                                        {h.replace(/^#+\s*/, '')}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500 italic py-2">
                                            記事内容を解析中、または見出しが取得できませんでした。タイトルと要約から重要なポイントを抽出して記事作成に活用します。
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 話題のトピック */}
            {trendData.hotTopics.length > 0 && (
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                    <h4 className="font-semibold text-purple-900 mb-3 flex items-center space-x-2">
                        <TrendingUp className="w-4 h-4" />
                        <span>話題のトピック</span>
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {trendData.hotTopics.map((topic, index) => (
                            <span
                                key={index}
                                className="px-3 py-1 bg-purple-100 border border-purple-300 rounded-full text-sm text-purple-800 font-medium"
                            >
                                {topic}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* 関連キーワード */}
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-yellow-500" />
                        <span>関連キーワードの選別</span>
                    </h4>
                    <span className="text-xs text-gray-500">
                        タップで切り替え: お任せ → NG → 必須
                    </span>
                </div>

                <div className="flex flex-col gap-4 mb-6">
                    {/* 手動追加エリア */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={ngInput}
                                onChange={(e) => setNgInput(e.target.value)}
                                placeholder="NGワードを追加..."
                                className="flex-1 px-3 py-2 text-sm border border-red-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-red-50/30"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddNgKeyword()}
                            />
                            <button
                                onClick={handleAddNgKeyword}
                                disabled={!ngInput.trim()}
                                className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm font-bold hover:bg-red-200 disabled:opacity-50 transition-colors"
                            >
                                追加
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={essentialInput}
                                onChange={(e) => setEssentialInput(e.target.value)}
                                placeholder="必須ワードを追加..."
                                className="flex-1 px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50/30"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddEssentialKeyword()}
                            />
                            <button
                                onClick={handleAddEssentialKeyword}
                                disabled={!essentialInput.trim()}
                                className="px-3 py-2 bg-blue-100 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-200 disabled:opacity-50 transition-colors"
                            >
                                追加
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    {/* ユーザー追加キーワードも含めて表示するために、既存リストとpreferenceにあるキーをマージ */}
                    {Array.from(new Set([
                        ...trendData.relatedKeywords.slice(0, 20),
                        ...Object.keys(keywordPreferences)
                    ])).map((keyword, index) => {
                        const status = keywordPreferences[keyword] || 'default';

                        // 関連キーワードリストになく、preferenceもdefaultなら表示しない（削除されたとみなす）
                        if (!trendData.relatedKeywords.includes(keyword) && status === 'default') {
                            return null;
                        }

                        let baseStyle = "px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer select-none transform hover:scale-105 active:scale-95 border-2 shadow-sm";
                        let statusStyle = "";

                        if (status === 'default') {
                            statusStyle = "bg-white border-gray-200 text-gray-600 hover:border-gray-400";
                        } else if (status === 'ng') {
                            statusStyle = "bg-red-50 border-red-200 text-red-500 line-through decoration-2 hover:bg-red-100";
                        } else if (status === 'essential') {
                            statusStyle = "bg-blue-600 border-blue-800 text-white shadow-md hover:bg-blue-700";
                        }

                        return (
                            <div
                                key={index}
                                onClick={() => onKeywordToggle(keyword)}
                                className={`${baseStyle} ${statusStyle}`}
                                title={status === 'default' ? 'AIにお任せ' : status === 'ng' ? 'この記事では使わない' : '非常に重要なキーワード'}
                            >
                                {keyword}
                                {status === 'essential' && <span className="ml-1.5 text-[10px] bg-white/20 px-1 rounded">必須</span>}
                                {status === 'ng' && <span className="ml-1.5 text-[10px] opacity-70">NG</span>}
                            </div>
                        );
                    })}
                </div>

                <p className="text-[11px] text-gray-400 mt-4 leading-relaxed italic">
                    ※ 青色はAIに「積極的に使う」よう指示します。赤色は「絶対に使わない」よう除外します。
                    グレーはAIが必要に応じて判断します。
                </p>
            </div>

            {/* ナビゲーションバー */}
            <div className="flex justify-between items-center pt-8 border-t border-gray-100 mt-8">
                <button
                    onClick={onBack}
                    className="group flex items-center space-x-2 text-gray-500 hover:text-gray-900 font-bold transition-all"
                >
                    <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    <span>条件入力に戻る</span>
                </button>

                <button
                    onClick={onNext}
                    className="bg-gray-900 hover:bg-black text-white px-10 py-4 rounded-full font-black shadow-xl hover:shadow-2xl flex items-center space-x-3 transform hover:scale-105 active:scale-95 transition-all"
                >
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                    <span>タイトル生成を開始</span>
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
