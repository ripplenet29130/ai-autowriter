import React, { useState } from 'react';
import { Edit, Eye, Edit3, RefreshCw, ShieldCheck } from 'lucide-react';
import { Article } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RegenerateModal, RegenerateOptions } from './RegenerateModal';

interface ArticleEditorProps {
    article: Article;
    onUpdate: (updates: Partial<Article>) => void;
    onRegenerate?: (options: RegenerateOptions) => Promise<void>;
    onFactCheck?: () => void;
    isFactChecking?: boolean;
    readOnly?: boolean;
}

/**
 * 記事編集コンポーネント - タブ切り替えによるプレビュー機能付き
 */
export const ArticleEditor: React.FC<ArticleEditorProps> = ({
    article,
    onUpdate,
    onRegenerate,
    onFactCheck,
    isFactChecking = false,
    readOnly = false,
}) => {
    const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
    const [showRegenerateModal, setShowRegenerateModal] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

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
                            className="flex items-center space-x-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                            title="Perplexityで事実確認を行う"
                        >
                            <ShieldCheck className={`w-4 h-4 ${isFactChecking ? 'animate-pulse' : ''}`} />
                            <span>{isFactChecking ? '確認中...' : 'ファクトチェック'}</span>
                        </button>
                    )}
                    {onRegenerate && (
                        <button
                            onClick={() => setShowRegenerateModal(true)}
                            disabled={isRegenerating}
                            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                            <span>{isRegenerating ? '再生成中...' : '記事を再生成'}</span>
                        </button>
                    )}
                </div>
            </div>

            {viewMode === 'edit' ? (
                <div className="space-y-4 animate-in fade-in duration-300">
                    {/* Title */}
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

                    {/* Excerpt */}
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

                    {/* Content */}
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {article.content}
                        </ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Metadata (Always shown) */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 mt-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        トーン
                    </label>
                    <select
                        value={article.tone || 'professional'}
                        onChange={(e) => onUpdate({ tone: e.target.value as any })}
                        disabled={readOnly}
                        className="input-field"
                    >
                        <option value="professional">プロフェッショナル</option>
                        <option value="casual">カジュアル</option>
                        <option value="technical">テクニカル</option>
                        <option value="friendly">フレンドリー</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        長さ
                    </label>
                    <select
                        value={article.length || 'medium'}
                        onChange={(e) => onUpdate({ length: e.target.value as any })}
                        disabled={readOnly}
                        className="input-field"
                    >
                        <option value="short">短い</option>
                        <option value="medium">中程度</option>
                        <option value="long">長い</option>
                    </select>
                </div>
            </div>

            {/* Stats */}
            {article.wordCount && (
                <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-100/50">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">文字数 :</span>
                        <span className="font-semibold text-blue-700">{article.wordCount.toLocaleString('ja-JP')} 文字</span>
                    </div>
                    {article.readingTime && (
                        <div className="flex items-center justify-between text-sm mt-2">
                            <span className="text-gray-600">想定読了時間:</span>
                            <span className="font-semibold text-blue-700">{article.readingTime} 分</span>
                        </div>
                    )}
                </div>
            )}

            {/* Regenerate Modal */}
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
