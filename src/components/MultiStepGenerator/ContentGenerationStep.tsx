import React, { useState } from 'react';
import {
    FileText,
    Sparkles,
    ArrowLeft,
    Loader2,
    CheckCircle2,
    Zap,
    Clock,
    AlignLeft,
    Check,
    ArrowRight,
    Trophy,
    ExternalLink,
    X,
    Globe,
    Send,
    RefreshCw
} from 'lucide-react';
import { ArticleOutline, Article } from '../../types';
import { ArticleEditor } from '../AIGenerator/ArticleEditor';
import { useWordPressPublish } from '../../hooks/useWordPressPublish';
import { useWordPressConfig } from '../../hooks/useWordPressConfig';
import toast from 'react-hot-toast';

interface ContentGenerationStepProps {
    outline: ArticleOutline | undefined;
    article: Article | undefined;
    isGenerating: boolean;
    onGenerate: () => void;
    onUpdateArticle: (article: Article) => void;
    onBack: () => void;
}

/**
 * ステップ4: 本文の生成と最終プレビュー
 */
export const ContentGenerationStep: React.FC<ContentGenerationStepProps> = ({
    outline,
    article,
    isGenerating,
    onGenerate,
    onUpdateArticle,
    onBack
}) => {
    const [showPreview, setShowPreview] = useState(false);
    const [selectedConfigId, setSelectedConfigId] = useState<string>('');
    const [publishStatus, setPublishStatus] = useState<'publish' | 'draft' | 'future'>('publish');
    const [scheduledDate, setScheduledDate] = useState<string>('');
    const { publishToWordPress, isPublishing } = useWordPressPublish();
    const { configs } = useWordPressConfig();
    const activeConfigs = configs.filter(c => c.isActive);

    // 初期値として最初のアクティブな設定を選択
    React.useEffect(() => {
        if (activeConfigs.length > 0 && !selectedConfigId) {
            setSelectedConfigId(activeConfigs[0].id);
        }
    }, [activeConfigs, selectedConfigId]);

    // 生成完了のプレミアムな成功画面
    if (article) {
        return (
            <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="bg-white border-2 border-green-100 rounded-3xl p-10 text-center shadow-xl shadow-green-50 relative overflow-hidden">
                    {/* Background celebratory elements */}
                    <div className="absolute -top-12 -right-12 w-48 h-48 bg-green-50 rounded-full blur-3xl opacity-60" />
                    <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-blue-50 rounded-full blur-3xl opacity-60" />

                    <div className="relative z-10">
                        <div className="bg-gradient-to-br from-green-400 to-green-600 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-200 animate-bounce">
                            <Trophy className="w-12 h-12 text-white" />
                        </div>
                        <h3 className="text-3xl font-black text-gray-900 mb-2">執筆完了！</h3>
                        <p className="text-gray-500 mb-8 max-w-sm mx-auto">
                            ハイクオリティな記事が完成しました。すぐに確認して公開できます。
                        </p>
                        <div className="max-w-xl mx-auto bg-gray-50 rounded-2xl p-6 border border-gray-100 text-left mb-8">
                            <div className="flex items-center space-x-2 mb-4">
                                <span className="bg-green-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">Generated Article</span>
                            </div>
                            <h4 className="text-xl font-bold text-gray-900 mb-6 leading-tight">
                                {article.title}
                            </h4>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">文字数</p>
                                    <p className="text-xl font-black text-gray-900">{article.wordCount?.toLocaleString()} <span className="text-xs font-medium text-gray-400">字</span></p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">読了目安</p>
                                    <p className="text-xl font-black text-gray-900">{article.readingTime}<span className="text-xs font-medium text-gray-400">分</span></p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-4 justify-center items-center">
                            <button
                                onClick={() => setShowPreview(true)}
                                className="bg-white border-2 border-gray-100 hover:border-gray-900 px-10 py-4 rounded-full font-bold flex items-center justify-center space-x-2 transition-all hover:scale-105 active:scale-95 w-full max-w-lg mx-auto"
                            >
                                <ExternalLink className="w-5 h-5" />
                                <span>内容を確認する</span>
                            </button>

                            {activeConfigs.length > 0 && (
                                <div className="bg-white border-2 border-blue-100 rounded-2xl p-6 w-full max-w-lg mx-auto text-left space-y-4 shadow-sm">
                                    <div className="flex items-center gap-2 text-blue-900 font-bold border-b border-blue-100 pb-2 mb-2">
                                        <Globe className="w-5 h-5" />
                                        <span>WordPress投稿設定</span>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                                            投稿先サイト
                                        </label>
                                        <select
                                            value={selectedConfigId}
                                            onChange={(e) => setSelectedConfigId(e.target.value)}
                                            className="w-full px-4 py-2 border border-blue-100 rounded-lg focus:border-blue-500 outline-none bg-blue-50/30"
                                        >
                                            {activeConfigs.map(config => (
                                                <option key={config.id} value={config.id}>
                                                    {config.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                            公開ステータス
                                        </label>
                                        <div className="flex flex-wrap gap-3">
                                            <label className={`
                                                flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-all
                                                ${publishStatus === 'publish' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-100 hover:bg-gray-50'}
                                            `}>
                                                <input
                                                    type="radio"
                                                    name="genStepStatus"
                                                    value="publish"
                                                    checked={publishStatus === 'publish'}
                                                    onChange={() => setPublishStatus('publish')}
                                                    className="hidden"
                                                />
                                                <Send className="w-4 h-4" />
                                                <span className="text-sm font-bold">公開</span>
                                            </label>
                                            <label className={`
                                                flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-all
                                                ${publishStatus === 'draft' ? 'bg-gray-100 border-gray-200 text-gray-700' : 'border-gray-100 hover:bg-gray-50'}
                                            `}>
                                                <input
                                                    type="radio"
                                                    name="genStepStatus"
                                                    value="draft"
                                                    checked={publishStatus === 'draft'}
                                                    onChange={() => setPublishStatus('draft')}
                                                    className="hidden"
                                                />
                                                <FileText className="w-4 h-4" />
                                                <span className="text-sm font-bold">下書き</span>
                                            </label>
                                            <label className={`
                                                flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-all
                                                ${publishStatus === 'future' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'border-gray-100 hover:bg-gray-50'}
                                            `}>
                                                <input
                                                    type="radio"
                                                    name="genStepStatus"
                                                    value="future"
                                                    checked={publishStatus === 'future'}
                                                    onChange={() => setPublishStatus('future')}
                                                    className="hidden"
                                                />
                                                <Clock className="w-4 h-4" />
                                                <span className="text-sm font-bold">予約</span>
                                            </label>
                                        </div>
                                    </div>

                                    {publishStatus === 'future' && (
                                        <div className="animate-in fade-in slide-in-from-top-2">
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                                                公開日時
                                            </label>
                                            <input
                                                type="datetime-local"
                                                value={scheduledDate}
                                                onChange={(e) => setScheduledDate(e.target.value)}
                                                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>
                                    )}

                                    <button
                                        onClick={async () => {
                                            if (!article) return;
                                            if (!selectedConfigId) {
                                                toast.error('投稿先を選択してください');
                                                return;
                                            }
                                            if (publishStatus === 'future' && !scheduledDate) {
                                                toast.error('予約日時を設定してください');
                                                return;
                                            }

                                            const date = publishStatus === 'future' ? new Date(scheduledDate) : undefined;
                                            await publishToWordPress(article, selectedConfigId, undefined, publishStatus, date);
                                        }}
                                        disabled={isPublishing || !selectedConfigId}
                                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold flex items-center justify-center space-x-2 shadow-lg shadow-blue-100 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale mt-2"
                                    >
                                        {isPublishing ? (
                                            <RefreshCw className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <Send className="w-5 h-5" />
                                        )}
                                        <span>
                                            {isPublishing ? '投稿処理中...' :
                                                publishStatus === 'future' ? '予約投稿する' :
                                                    publishStatus === 'draft' ? '下書き保存する' : 'WordPressに公開する'}
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* プレビューモーダル */}
                {showPreview && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                        <div className="bg-white w-full max-w-5xl h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col relative animate-in zoom-in-95 duration-300">
                            {/* モーダルヘッダー */}
                            <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                                <div className="flex items-center space-x-3">
                                    <div className="bg-purple-100 p-2 rounded-xl text-purple-600">
                                        <FileText className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-gray-900">記事プレビュー</h3>
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Draft Review</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowPreview(false)}
                                    className="p-3 hover:bg-gray-100 rounded-2xl transition-all"
                                >
                                    <X className="w-6 h-6 text-gray-400" />
                                </button>
                            </div>

                            {/* モーダルコンテンツ */}
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                <ArticleEditor
                                    article={article}
                                    onUpdate={(updates) => {
                                        onUpdateArticle({ ...article, ...updates });
                                    }}
                                    readOnly={false}
                                />
                            </div>

                            {/* モーダルフッター */}
                            <div className="px-8 py-6 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                                <button
                                    onClick={() => setShowPreview(false)}
                                    className="bg-gray-900 text-white px-8 py-3 rounded-full font-bold hover:bg-black transition-all shadow-lg active:scale-95"
                                >
                                    閉じる
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // 生成中の進捗表示UI
    if (isGenerating) {
        const completedCount = outline?.sections.filter(s => s.isGenerated).length || 0;
        const totalCount = outline?.sections.length || 1;
        const progressPercent = Math.round((completedCount / totalCount) * 100);

        return (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                <div className="text-center">
                    <div className="relative inline-block mb-6">
                        <div className="w-24 h-24 border-8 border-gray-50 rounded-full" />
                        <svg className="w-24 h-24 absolute top-0 left-0 transform -rotate-90">
                            <circle
                                cx="48"
                                cy="48"
                                r="40"
                                stroke="currentColor"
                                strokeWidth="8"
                                fill="transparent"
                                className="text-purple-600 transition-all duration-700"
                                strokeDasharray={251.2}
                                strokeDashoffset={251.2 - (251.2 * progressPercent) / 100}
                            />
                        </svg>
                        <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
                            <span className="text-xl font-black text-gray-900">{progressPercent}%</span>
                        </div>
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 mb-2">最高品質の文章を紡いでいます</h3>
                    <p className="text-gray-500">
                        {completedCount} / {totalCount} セクションが完了しました
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-3 max-w-2xl mx-auto">
                    {outline?.sections.map((section, index) => (
                        <div
                            key={section.id}
                            className={`
                                flex items-center space-x-4 p-4 rounded-2xl border-2 transition-all duration-500
                                ${section.isGenerated
                                    ? 'border-green-100 bg-green-50/50 shadow-sm'
                                    : index === completedCount
                                        ? 'border-purple-200 bg-white ring-2 ring-purple-50 animate-pulse'
                                        : 'border-gray-50 bg-gray-50/30 grayscale opacity-40'}
                            `}
                        >
                            <div className={`
                                w-10 h-10 rounded-full flex items-center justify-center shrink-0
                                ${section.isGenerated ? 'bg-green-500 shadow-lg shadow-green-100' : 'bg-white border-2 border-gray-100'}
                            `}>
                                {section.isGenerated ? (
                                    <Check className="w-5 h-5 text-white" />
                                ) : index === completedCount ? (
                                    <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                                ) : (
                                    <div className="w-2 h-2 bg-gray-200 rounded-full" />
                                )}
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <p className={`font-bold text-sm truncate ${section.isGenerated ? 'text-gray-900' : 'text-gray-500'}`}>
                                    {section.title}
                                </p>
                                <div className="h-1 bg-gray-100 rounded-full mt-2 overflow-hidden">
                                    <div className={`h-full transition-all duration-1000 ${section.isGenerated ? 'w-full bg-green-500' : index === completedCount ? 'w-1/3 bg-purple-400' : 'w-0'}`} />
                                </div>
                            </div>
                            {section.isGenerated && (
                                <span className="text-[10px] font-black text-green-600 bg-green-100 px-2 py-1 rounded">COMPLETE</span>
                            )}
                        </div>
                    ))}
                </div>

                <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 max-w-2xl mx-auto flex items-start space-x-3">
                    <Zap className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-800 leading-relaxed font-medium">
                        AIが文脈を考慮しながら一文一文丁寧に執筆しています。この工程には数分かかる場合がありますが、ブラウザを閉じずにお待ちください。
                    </p>
                </div>
            </div>
        );
    }

    // 本文生成開始前の待機状態（基本的には親から直接トリガーされるため一瞬のみ表示）
    return (
        <div className="flex flex-col items-center justify-center py-24 animate-in fade-in duration-500">
            <Loader2 className="w-12 h-12 text-purple-600 animate-spin mb-6" />
            <h3 className="text-xl font-bold text-gray-900">執筆の準備をしています</h3>
            <p className="text-gray-500 mt-2">AIが構成を読み込み、執筆を開始します...</p>
        </div>
    );
};
