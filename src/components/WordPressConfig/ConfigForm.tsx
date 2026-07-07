import React, { useState } from 'react';
import { Check, Clipboard, Globe, X } from 'lucide-react';
import { WordPressConfig } from '../../types';

interface ConfigFormProps {
    onSubmit: (config: Omit<WordPressConfig, 'id'>) => void;
    onCancel: () => void;
    initialData?: WordPressConfig;
    isSubmitting?: boolean;
}

export const ConfigForm: React.FC<ConfigFormProps> = ({
    onSubmit,
    onCancel,
    initialData,
    isSubmitting = false,
}) => {
    const [formData, setFormData] = useState({
        name: initialData?.name || '',
        url: initialData?.url || '',
        username: initialData?.username || '',
        applicationPassword: initialData?.applicationPassword || '',
        category: initialData?.category || '',
        defaultCategory: initialData?.defaultCategory || '',
        postType: initialData?.postType || 'posts',
        styleReferenceUrl: initialData?.styleReferenceUrl || '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [copied, setCopied] = useState(false);

    const wpRestApiCode = `// カスタム投稿タイプ news をREST APIで公開する設定
add_filter('register_post_type_args', function($args, $post_type) {
    if ($post_type === 'news') {
        $args['show_in_rest'] = true;
        $args['rest_base'] = 'news';
    }
    return $args;
}, 10, 2);

// お知らせカテゴリー news_category をREST APIで公開する設定
add_filter('register_taxonomy_args', function($args, $taxonomy) {
    if ($taxonomy === 'news_category') {
        $args['show_in_rest'] = true;
        $args['rest_base'] = 'news_category';
    }
    return $args;
}, 10, 2);`;

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

        if (
            formData.styleReferenceUrl.trim() &&
            !formData.styleReferenceUrl.match(/^https?:\/\/.+/)
        ) {
            newErrors.styleReferenceUrl = '有効なURLを入力してください';
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
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: '' }));
        }
    };

    const handleCopyRestApiCode = async () => {
        await navigator.clipboard.writeText(wpRestApiCode);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
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
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                    <p className="font-semibold">投稿タイプ・カテゴリーの設定方法</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>通常の「投稿」に入れる場合は、投稿タイプに <code>posts</code> を入力します。</li>
                        <li>「お知らせ」などのカスタム投稿に入れる場合は、WordPressでREST APIへ公開されている投稿タイプ名を入力します。例: <code>news</code></li>
                        <li>カテゴリーは、選んだ投稿タイプに紐づいているカテゴリースラッグを入力します。例: お知らせカテゴリーの「コラム」は <code>column</code></li>
                        <li>保存時に、投稿タイプとカテゴリーがWordPress上に実在するか自動で確認します。</li>
                    </ul>
                </div>

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
                    {errors.name && <p className="text-sm text-red-600 mt-1">{errors.name}</p>}
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
                    {errors.url && <p className="text-sm text-red-600 mt-1">{errors.url}</p>}
                    <p className="text-xs text-gray-500 mt-1">
                        WordPressサイトのベースURLを入力します。
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
                    {errors.username && <p className="text-sm text-red-600 mt-1">{errors.username}</p>}
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
                        WordPress管理画面の「ユーザー」→「プロフィール」で発行した値を入力します。
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        デフォルトカテゴリー
                    </label>
                    <input
                        type="text"
                        value={formData.category}
                        onChange={(e) => handleChange('category', e.target.value)}
                        placeholder="uncategorized"
                        className="input-field"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        投稿タイプに紐づくカテゴリースラッグです。保存時にWordPress上の完全一致を確認します。
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
                        通常投稿は `posts` です。保存時にREST APIで利用できる投稿タイプか確認します。
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        スタイル参照URL
                    </label>
                    <input
                        type="url"
                        value={formData.styleReferenceUrl}
                        onChange={(e) => handleChange('styleReferenceUrl', e.target.value)}
                        placeholder="https://example.com/sample-article"
                        className={`input-field ${errors.styleReferenceUrl ? 'border-red-500' : ''}`}
                    />
                    {errors.styleReferenceUrl && (
                        <p className="text-sm text-red-600 mt-1">{errors.styleReferenceUrl}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                        このURLの本文表現を参考に、語尾や文体の傾向を新規記事へ反映します。内容そのものはコピーしません。
                    </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-gray-900">
                                WordPress側に必要なREST API公開コード例
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                                カスタム投稿タイプや独自カテゴリーを使う場合は、WordPressテーマの functions.php などに追加します。
                                投稿タイプ名・タクソノミー名が異なる場合は <code>news</code> / <code>news_category</code> を置き換えてください。
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleCopyRestApiCode}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                            {copied ? (
                                <>
                                    <Check className="h-4 w-4 text-green-600" />
                                    コピー済み
                                </>
                            ) : (
                                <>
                                    <Clipboard className="h-4 w-4" />
                                    コピー
                                </>
                            )}
                        </button>
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
                        <code>{wpRestApiCode}</code>
                    </pre>
                </div>

                <div className="flex space-x-3 pt-4 border-t border-gray-200">
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`btn-primary flex-1 ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isSubmitting ? '投稿先を確認中...' : initialData ? '更新' : '保存'}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSubmitting}
                        className="btn-secondary flex-1"
                    >
                        キャンセル
                    </button>
                </div>
            </form>
        </div>
    );
};
