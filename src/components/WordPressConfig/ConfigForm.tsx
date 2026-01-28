import React, { useState } from 'react';
import { Globe, X } from 'lucide-react';
import { WordPressConfig } from '../../types';

interface ConfigFormProps {
    onSubmit: (config: Omit<WordPressConfig, 'id'>) => void;
    onCancel: () => void;
    initialData?: WordPressConfig;
}

/**
 * WordPress設定フォームコンポーネント
 */
export const ConfigForm: React.FC<ConfigFormProps> = ({
    onSubmit,
    onCancel,
    initialData,
}) => {
    const [formData, setFormData] = useState({
        name: initialData?.name || '',
        url: initialData?.url || '',
        username: initialData?.username || '',
        applicationPassword: initialData?.applicationPassword || '',
        category: initialData?.category || '',
        defaultCategory: initialData?.defaultCategory || '',
        postType: initialData?.postType || 'posts',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.name.trim()) {
            newErrors.name = '設定名は必須です';
        }

        if (!formData.url.trim()) {
            newErrors.url = 'URLは必須です';
        } else if (!formData.url.match(/^https?:\/\/.+/)) {
            newErrors.url = '有効なURLを入力してください';
        }

        if (!formData.username.trim()) {
            newErrors.username = 'ユーザー名は必須です';
        }

        if (!formData.applicationPassword.trim()) {
            newErrors.applicationPassword = 'アプリケーションパスワードは必須です';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (validate()) {
            onSubmit({
                ...formData,
                isActive: initialData?.isActive || false,
                scheduleSettings: initialData?.scheduleSettings,
            });
        }
    };

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Clear error when user starts typing
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                    <Globe className="w-6 h-6 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">
                        {initialData ? 'WordPress設定を編集' : '新しいWordPress設定'}
                    </h3>
                </div>
                <button
                    onClick={onCancel}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        設定名 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        placeholder="例: メインサイト"
                        className={`input-field ${errors.name ? 'border-red-500' : ''}`}
                    />
                    {errors.name && (
                        <p className="text-sm text-red-600 mt-1">{errors.name}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        WordPress URL <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="url"
                        value={formData.url}
                        onChange={(e) => handleChange('url', e.target.value)}
                        placeholder="https://example.com"
                        className={`input-field ${errors.url ? 'border-red-500' : ''}`}
                    />
                    {errors.url && (
                        <p className="text-sm text-red-600 mt-1">{errors.url}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                        WordPressサイトのURL（例: https://example.com）
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        ユーザー名 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => handleChange('username', e.target.value)}
                        placeholder="admin"
                        className={`input-field ${errors.username ? 'border-red-500' : ''}`}
                    />
                    {errors.username && (
                        <p className="text-sm text-red-600 mt-1">{errors.username}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        アプリケーションパスワード <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="password"
                        value={formData.applicationPassword}
                        onChange={(e) => handleChange('applicationPassword', e.target.value)}
                        placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                        className={`input-field ${errors.applicationPassword ? 'border-red-500' : ''}`}
                    />
                    {errors.applicationPassword && (
                        <p className="text-sm text-red-600 mt-1">{errors.applicationPassword}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                        WordPress管理画面の「ユーザー」→「プロフィール」から作成できます
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        デフォルトカテゴリ（スラッグ）
                    </label>
                    <input
                        type="text"
                        value={formData.category}
                        onChange={(e) => handleChange('category', e.target.value)}
                        placeholder="uncategorized"
                        className="input-field"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        カテゴリスタッグを指定（例: news, blog）。投稿タイプとどちらか一方でOK
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        投稿タイプ
                    </label>
                    <input
                        type="text"
                        value={formData.postType}
                        onChange={(e) => handleChange('postType', e.target.value)}
                        placeholder="posts"
                        className="input-field"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        投稿タイプを指定（デフォルト: post）。カスタム投稿タイプも可（例: product, event）
                    </p>
                </div>

                <div className="flex space-x-3 pt-4 border-t border-gray-200">
                    <button
                        type="submit"
                        className="btn-primary flex-1"
                    >
                        {initialData ? '更新' : '追加'}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn-secondary flex-1"
                    >
                        キャンセル
                    </button>
                </div>
            </form>
        </div>
    );
};
