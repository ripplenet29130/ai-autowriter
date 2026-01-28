import React, { useState } from 'react';
import { Send, Save, Globe } from 'lucide-react';
import { Article, WordPressConfig } from '../../types';

interface PublishControlProps {
    article: Article;
    wordPressConfigs: WordPressConfig[];
    isPublishing: boolean;
    publishStatus: 'publish' | 'draft' | 'future';
    onPublishStatusChange: (status: 'publish' | 'draft' | 'future') => void;
    scheduledDate: string;
    onScheduledDateChange: (date: string) => void;
    onPublish: (configId: string, category?: string, status?: 'publish' | 'draft' | 'future', date?: Date) => void;
}

/**
 * 投稿コントロールコンポーネント
 */
export const PublishControl: React.FC<PublishControlProps> = ({
    article,
    wordPressConfigs,
    isPublishing,
    publishStatus,
    onPublishStatusChange,
    scheduledDate,
    onScheduledDateChange,
    onPublish,
}) => {
    const [selectedConfig, setSelectedConfig] = useState<string>('');
    const [category, setCategory] = useState<string>('');

    const activeConfigs = wordPressConfigs.filter(c => c.isActive);
    const defaultConfig = activeConfigs.length > 0 ? activeConfigs[0].id : '';

    React.useEffect(() => {
        if (defaultConfig && !selectedConfig) {
            setSelectedConfig(defaultConfig);
        }
    }, [defaultConfig, selectedConfig]);

    const handlePublish = () => {
        if (selectedConfig) {
            const date = publishStatus === 'future' ? new Date(scheduledDate) : undefined;
            onPublish(selectedConfig, category || undefined, publishStatus, date);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">投稿設定</h3>

            {/* WordPress Config Selection */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    投稿先WordPress
                </label>
                <select
                    value={selectedConfig}
                    onChange={(e) => setSelectedConfig(e.target.value)}
                    disabled={isPublishing || activeConfigs.length === 0}
                    className="input-field"
                >
                    <option value="">選択してください</option>
                    {activeConfigs.map((config) => (
                        <option key={config.id} value={config.id}>
                            {config.name} ({config.url})
                        </option>
                    ))}
                </select>
                {activeConfigs.length === 0 && (
                    <p className="text-sm text-red-600 mt-1">
                        有効なWordPress設定を追加、または有効化してください
                    </p>
                )}
            </div>

            {/* Category */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    カテゴリ（オプション）
                </label>
                <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="例: ブログ"
                    disabled={isPublishing}
                    className="input-field"
                />
            </div>

            {/* Publish Status */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    公開ステータス
                </label>
                <select
                    value={publishStatus}
                    onChange={(e) => onPublishStatusChange(e.target.value as any)}
                    disabled={isPublishing}
                    className="input-field"
                >
                    <option value="publish">公開</option>
                    <option value="draft">下書き</option>
                    <option value="future">予約投稿</option>
                </select>
            </div>

            {/* Scheduled Date for Future Posts */}
            {publishStatus === 'future' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        公開日時
                    </label>
                    <input
                        type="datetime-local"
                        value={scheduledDate}
                        onChange={(e) => onScheduledDateChange(e.target.value)}
                        className="input-field"
                        required
                    />
                </div>
            )}

            {/* Action Buttons */}
            <div className="pt-4 border-t border-gray-200">
                <button
                    onClick={handlePublish}
                    disabled={isPublishing || !selectedConfig || activeConfigs.length === 0}
                    className="w-full btn-primary flex items-center justify-center space-x-2 py-3"
                >
                    {isPublishing ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>投稿中...</span>
                        </>
                    ) : (
                        <>
                            <Send className="w-4 h-4" />
                            <span>WordPressに投稿</span>
                        </>
                    )}
                </button>
            </div>

            {/* Status */}
            {article.status && (
                <div className="text-sm text-gray-600">
                    <span className="font-medium">ステータス:</span>{' '}
                    <span className={`
            ${article.status === 'published' ? 'text-green-600' : ''}
            ${article.status === 'draft' ? 'text-blue-600' : ''}
            ${article.status === 'failed' ? 'text-red-600' : ''}
          `}>
                        {article.status === 'published' ? '投稿済み' :
                            article.status === 'draft' ? '下書き' :
                                article.status === 'failed' ? '失敗' : article.status}
                    </span>
                </div>
            )}

            {article.wordPressUrl && (
                <a
                    href={article.wordPressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                >
                    <Globe className="w-4 h-4" />
                    <span>投稿を表示</span>
                </a>
            )}
        </div>
    );
};
