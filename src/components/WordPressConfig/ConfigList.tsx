import React from 'react';
import { Globe, Check, Trash2, Edit, X } from 'lucide-react';
import { WordPressConfig } from '../../types';

interface ConfigListProps {
    configs: WordPressConfig[];
    onSetActive: (configId: string) => void;
    onSetInactive?: (configId: string) => void;
    onDelete: (configId: string) => void;
    onEdit?: (config: WordPressConfig) => void;
    onTestConnection?: (config: WordPressConfig) => void;
}

/**
 * WordPress設定一覧コンポーネント
 */
export const ConfigList: React.FC<ConfigListProps> = ({
    configs,
    onSetActive,
    onSetInactive,
    onDelete,
    onEdit,
    onTestConnection,
}) => {
    if (configs.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                <Globe className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    WordPress設定がありません
                </h3>
                <p className="text-gray-600">
                    新しい設定を追加して、WordPressサイトと連携しましょう
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {configs.map((config) => (
                <div
                    key={config.id}
                    className={`bg-white rounded-xl shadow-sm border-2 p-6 transition-all ${config.isActive
                        ? 'border-blue-500 ring-2 ring-blue-100'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                >
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                                <h3 className="text-lg font-semibold text-gray-900">
                                    {config.name}
                                </h3>
                                {config.isActive && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        <Check className="w-3 h-3 mr-1" />
                                        アクティブ
                                    </span>
                                )}
                            </div>

                            <div className="space-y-1 text-sm text-gray-600">
                                <p className="flex items-center space-x-2">
                                    <Globe className="w-4 h-4" />
                                    <span>{config.url}</span>
                                </p>
                                <p>
                                    <span className="font-medium">ユーザー名:</span> {config.username}
                                </p>
                                {config.category && (
                                    <p>
                                        <span className="font-medium">カテゴリ:</span> {config.category}
                                    </p>
                                )}
                                {config.scheduleSettings?.isActive && (
                                    <p className="text-green-600 font-medium mt-2">
                                        スケジュール有効 - {config.scheduleSettings.frequency === 'daily' ? '毎日' :
                                            config.scheduleSettings.frequency === 'weekly' ? '毎週' :
                                                config.scheduleSettings.frequency === 'biweekly' ? '隔週' : '毎月'}{' '}
                                        {config.scheduleSettings.time}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                            {config.isActive ? (
                                <button
                                    onClick={() => onSetInactive && onSetInactive(config.id)}
                                    className="p-2 border border-blue-200 bg-blue-50 text-blue-600 rounded-lg transition-colors hover:bg-blue-100"
                                    title="アクティブ状態を解除"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            ) : (
                                <button
                                    onClick={() => onSetActive(config.id)}
                                    className="btn-secondary text-sm"
                                    title="この設定をアクティブにする"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                            )}

                            {onTestConnection && (
                                <button
                                    onClick={() => onTestConnection(config)}
                                    className="btn-secondary text-sm"
                                    title="接続テスト"
                                >
                                    接続テスト
                                </button>
                            )}

                            {onEdit && (
                                <button
                                    onClick={() => onEdit(config)}
                                    className="btn-secondary text-sm"
                                    title="編集"
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                            )}

                            <button
                                onClick={() => onDelete(config.id)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="削除"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
