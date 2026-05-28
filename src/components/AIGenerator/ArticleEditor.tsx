import React, { useState } from 'react';
import { Eye, Edit3, RefreshCw, ShieldCheck, Wand2 } from 'lucide-react';
import { Article } from '../../types';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RegenerateModal, RegenerateOptions } from './RegenerateModal';
import { getSharedToneDescription, normalizeSharedTone, sharedToneOptions, type SharedTone } from '../../shared/toneOptions';

interface ArticleEditorProps {
    article: Article;
    onUpdate: (updates: Partial<Article>) => void;
    onRegenerate?: (options: RegenerateOptions) => Promise<void>;
    onFactCheck?: () => void;
    isFactChecking?: boolean;
    onFactCheckFix?: () => void;
    isFactCheckFixing?: boolean;
    canFactCheckFix?: boolean;
    readOnly?: boolean;
}

/**
 * 記事編集コンポーネント: タブ切り替えによるプレビュー表示付き
 */
export const ArticleEditor: React.FC<ArticleEditorProps> = ({
    article,
    onUpdate,
    onRegenerate,
    onFactCheck,
    isFactChecking = false,
    onFactCheckFix,
    isFactCheckFixing = false,
    canFactCheckFix = false,
    readOnly = false,
}) => {
    const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
    const [showRegenerateModal, setShowRegenerateModal] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const currentCharCount = article.content?.length || 0;
    const targetCharCount = article.targetWordCount;
    const charDiff = typeof targetCharCount === 'number' ? currentCharCount - targetCharCount : null;
    const markdownUrlTransform = (url: string, key?: string) => {
        if (key === 'src' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(url)) {
            return url;
        }
        return defaultUrlTransform(url);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMode('edit')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${viewMode === 'edit'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        <Edit3 className="w-4 h-4" />
                        <span className="font-medium">編集</span>
                    </button>
                    <button
                        onClick={() => setViewMode('preview')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${viewMode === 'preview'
                            ? 'bg-white text-purple-600 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        <Eye className="w-4 h-4" />
                        <span className="font-medium">プレビュー</span>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {onFactCheck && (
                        <button
                            onClick={onFactCheck}
                            disabled={isFactChecking}
                            className={`p-2.5 rounded-lg transition-all border ${isFactChecking
                                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-white border-teal-200 text-teal-600 hover:bg-teal-50 hover:border-teal-300 hover:shadow-sm active:scale-95'
                                }`}
                            title={isFactChecking ? '確認中...' : 'ファクトチェックを実行'}
                        >
                            <ShieldCheck className={`w-5 h-5 ${isFactChecking ? 'animate-pulse' : ''}`} />
                        </button>
                    )}
                    {onRegenerate && (
                        <button
                            onClick={() => setShowRegenerateModal(true)}
                            disabled={isRegenerating}
                            className={`p-2.5 rounded-lg transition-all border ${isRegenerating
                                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-white border-purple-200 text-purple-600 hover:bg-purple-50 hover:border-purple-300 hover:shadow-sm active:scale-95'
                                }`}
                            title={isRegenerating ? '再生成中...' : '記事を再生成'}
                        >
                            <RefreshCw className={`w-5 h-5 ${isRegenerating ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                    {onFactCheckFix && (
                        <button
                            onClick={onFactCheckFix}
                            disabled={isFactCheckFixing || !canFactCheckFix}
                            className={`p-2.5 rounded-lg transition-all border ${isFactCheckFixing || !canFactCheckFix
                                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                                : 'bg-white border-orange-200 text-orange-600 hover:bg-orange-50 hover:border-orange-300 hover:shadow-sm active:scale-95'
                                }`}
                            title={isFactCheckFixing ? '修正中...' : 'ファクトチェック結果をAIで修正'}
                        >
                            <Wand2 className={`w-5 h-5 ${isFactCheckFixing ? 'animate-pulse' : ''}`} />
                        </button>
                    )}
                </div>
            </div>

            {viewMode === 'edit' ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center space-x-2">
                            <Edit3 className="w-4 h-4" />
                            <span>タイトル</span>
                        </label>
                        <input
                            type="text"
                            value={article.title}
                            onChange={(e) => onUpdate({ title: e.target.value })}
                            disabled={readOnly}
                            className="input-field text-lg font-semibold"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            抜粋
                        </label>
                        <textarea
                            value={article.excerpt}
                            onChange={(e) => onUpdate({ excerpt: e.target.value })}
                            disabled={readOnly}
                            rows={2}
                            className="input-field"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            本文
                        </label>
                        <textarea
                            value={article.content}
                            onChange={(e) => onUpdate({ content: e.target.value })}
                            disabled={readOnly}
                            rows={15}
                            className="input-field font-mono text-sm leading-relaxed"
                        />
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-lg p-8 border border-gray-100 shadow-sm animate-in zoom-in-95 duration-300">
                    <h1 className="text-3xl font-bold text-gray-900 mb-6">{article.title}</h1>
                    {article.excerpt && (
                        <div className="mb-8 p-4 bg-gray-50 rounded-lg italic text-gray-600 border-l-4 border-gray-200">
                            {article.excerpt}
                        </div>
                    )}
                    <div className="article-prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>
                            {article.content}
                        </ReactMarkdown>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 pt-4 border-t border-gray-100 mt-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        トーン
                    </label>
                    <select
                        value={normalizeSharedTone(article.tone)}
                        onChange={(e) => onUpdate({ tone: e.target.value as SharedTone })}
                        disabled={readOnly}
                        className="input-field"
                    >
                        {sharedToneOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <p className="mt-2 text-xs leading-relaxed text-gray-500">
                        {getSharedToneDescription(article.tone)}
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        文字数
                    </label>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">目標文字数</div>
                        <div className="mt-1 text-base font-semibold text-gray-900">
                            {typeof targetCharCount === 'number'
                                ? `${targetCharCount.toLocaleString('ja-JP')} 文字`
                                : '未指定'}
                        </div>
                        <div className="mt-2 text-xs text-gray-500">現在文字数</div>
                        <div className="mt-1 text-sm font-medium text-gray-800">
                            {currentCharCount.toLocaleString('ja-JP')} 文字
                        </div>
                        {charDiff !== null && (
                            <div className={`mt-1 text-xs font-semibold ${charDiff >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>
                                差分: {charDiff >= 0 ? '+' : ''}{charDiff.toLocaleString('ja-JP')} 文字
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showRegenerateModal && onRegenerate && (
                <RegenerateModal
                    currentArticle={{
                        title: article.title,
                        content: article.content,
                        wordCount: article.wordCount
                    }}
                    onClose={() => setShowRegenerateModal(false)}
                    onRegenerate={async (options) => {
                        setIsRegenerating(true);
                        try {
                            await onRegenerate(options);
                            setShowRegenerateModal(false);
                        } catch (error) {
                            console.error('Regeneration failed:', error);
                        } finally {
                            setIsRegenerating(false);
                        }
                    }}
                    isRegenerating={isRegenerating}
                />
            )}
        </div>
    );
};
