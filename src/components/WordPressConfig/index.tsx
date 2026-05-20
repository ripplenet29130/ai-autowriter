import React, { useState } from 'react';
import { Globe, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWordPressConfig } from '../../hooks/useWordPressConfig';
import { useAuthStore } from '../../store/useAuthStore';
import { ConfigList } from './ConfigList';
import { ConfigForm } from './ConfigForm';
import { WordPressConfig } from '../../types';

export const WordPressConfigComponent: React.FC = () => {
  const { account } = useAuthStore();
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wordpressLimit = account?.wordpress_site_limit ?? 1;
  const isAtLimit = configs.length >= wordpressLimit;

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message) return error.message;
    return 'WordPress設定の保存に失敗しました。';
  };

  const sortedConfigs = [...configs].sort((a, b) => {
    if (a.isActive === b.isActive) return 0;
    return a.isActive ? -1 : 1;
  });

  const handleSubmit = async (configData: Omit<WordPressConfig, 'id'>) => {
    setIsSubmitting(true);
    try {
      if (editingConfig) {
        await updateConfig(editingConfig.id, configData);
        toast.success('WordPress設定を更新しました');
      } else {
        if (isAtLimit) {
          toast.error(`WordPress登録上限に達しています。現在の上限は${wordpressLimit}件です。`);
          return;
        }
        await addConfig(configData);
      }
      setShowForm(false);
      setEditingConfig(null);
    } catch (error) {
      console.error('Failed to save WordPress config:', error);
      toast.error(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (config: WordPressConfig) => {
    setEditingConfig(config);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingConfig(null);
  };

  const handleAddClick = () => {
    if (isAtLimit) {
      toast.error(`WordPress登録上限に達しています。現在の上限は${wordpressLimit}件です。`);
      return;
    }
    setEditingConfig(null);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Globe className="w-8 h-8 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">WordPress設定</h2>
            <p className="text-gray-600">WordPressサイトとの連携を管理します</p>
            <p className="text-sm text-gray-500 mt-1">
              登録数: {configs.length} / {wordpressLimit}
            </p>
          </div>
        </div>

        {!showForm && (
          <button
            onClick={handleAddClick}
            disabled={isAtLimit || isSubmitting}
            className={`btn-primary flex items-center space-x-2 ${isAtLimit || isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Plus className="w-5 h-5" />
            <span>新規設定</span>
          </button>
        )}
      </div>

      {isAtLimit && !showForm && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          WordPress登録上限に達しています。追加が必要な場合は管理者に上限変更を依頼してください。
        </div>
      )}

      {showForm && (
        <ConfigForm
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          initialData={editingConfig || undefined}
        />
      )}

      {!showForm && (
        <ConfigList
          configs={sortedConfigs}
          onSetActive={setActive}
          onSetInactive={setInactive}
          onDelete={deleteConfig}
          onTestConnection={testConnection}
          onEdit={handleEdit}
        />
      )}

      {!showForm && configs.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">
            WordPress設定の手順
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
            <li>WordPress管理画面にログイン</li>
            <li>ユーザーのプロフィールを開く</li>
            <li>アプリケーションパスワードを作成</li>
            <li>作成されたパスワードをこの画面に登録</li>
          </ol>
        </div>
      )}
    </div>
  );
};

export default WordPressConfigComponent;
