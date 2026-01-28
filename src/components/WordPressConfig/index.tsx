import React, { useState } from 'react';
import { Globe, Plus } from 'lucide-react';
import { useWordPressConfig } from '../../hooks/useWordPressConfig';
import { ConfigList } from './ConfigList';
import { ConfigForm } from './ConfigForm';
import { WordPressConfig } from '../../types';
import toast from 'react-hot-toast';

/**
 * WordPress設定メインコンポーネント
 */
export const WordPressConfigComponent: React.FC = () => {
    const {
        configs,
        testConnection,
        setActive,
        setInactive,
        deleteConfig,
        addConfig,
        updateConfig,
    } = useWordPressConfig();

    const [showForm, setShowForm] = useState(false);
    const [editingConfig, setEditingConfig] = useState<WordPressConfig | null>(null);

    // Activeな設定を先頭にするソート
    const sortedConfigs = [...configs].sort((a, b) => {
        if (a.isActive === b.isActive) return 0;
        return a.isActive ? -1 : 1;
    });

    const handleSubmit = (configData: Omit<WordPressConfig, 'id'>) => {
        if (editingConfig) {
            updateConfig(editingConfig.id, configData);
            toast.success('設定を更新しました');
        } else {
            addConfig(configData);
        }
        setShowForm(false);
        setEditingConfig(null);
    };

    const handleEdit = (config: WordPressConfig) => {
        setEditingConfig(config);
        setShowForm(true);
    };

    const handleCancel = () => {
        setShowForm(false);
        setEditingConfig(null);
    };

    const handleTestConnection = async (config: WordPressConfig) => {
        await testConnection(config);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <Globe className="w-8 h-8 text-blue-600" />
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">WordPress設定</h2>
                        <p className="text-gray-600">WordPressサイトとの連携を設定します</p>
                    </div>
                </div>

                {!showForm && (
                    <button
                        onClick={() => {
                            setEditingConfig(null);
                            setShowForm(true);
                        }}
                        className="btn-primary flex items-center space-x-2"
                    >
                        <Plus className="w-5 h-5" />
                        <span>新規設定</span>
                    </button>
                )}
            </div>

            {/* Form */}
            {showForm && (
                <ConfigForm
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                    initialData={editingConfig || undefined}
                />
            )}

            {/* Config List */}
            {!showForm && (
                <ConfigList
                    configs={sortedConfigs}
                    onSetActive={setActive}
                    onSetInactive={setInactive}
                    onDelete={deleteConfig}
                    onTestConnection={handleTestConnection}
                    onEdit={handleEdit}
                />
            )}

            {/* Help Section */}
            {!showForm && configs.length === 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                    <h3 className="font-semibold text-blue-900 mb-2">
                        WordPress設定の手順
                    </h3>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                        <li>WordPress管理画面にログイン</li>
                        <li>「ユーザー」→「プロフィール」を開く</li>
                        <li>「アプリケーションパスワード」セクションまでスクロール</li>
                        <li>新しいアプリケーションパスワードを作成</li>
                        <li>生成されたパスワードをコピー</li>
                        <li>上の「新規設定」ボタンから設定を追加</li>
                    </ol>
                </div>
            )}
        </div>
    );
};

export default WordPressConfigComponent;
