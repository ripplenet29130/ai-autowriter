import React, { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, Save, Layers, Edit2, Info } from 'lucide-react';
import { keywordSetService } from '../services/keywordSetService';
import { KeywordSet } from '../types';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';

export const KeywordSettings: React.FC = () => {
    const { keywordSets, addKeywordSet, updateKeywordSet, deleteKeywordSet, loadKeywordSets } = useAppStore();
    const [loading, setLoading] = useState(false);

    // Keyword Set states
    const [setName, setSetName] = useState('');
    const [setKeywordsInput, setSetKeywordsInput] = useState('');
    const [editingSet, setEditingSet] = useState<KeywordSet | null>(null);

    useEffect(() => {
        loadKeywordSets();
    }, []);

    // Keyword Set Handlers
    const handleSaveSet = async () => {
        if (!setName.trim()) {
            toast.error('セット名を入力してください');
            return;
        }

        let keywordsArray: string[] = [];
        const trimmedInput = setKeywordsInput.trim();

        // JSON配列形式の入力をサポート
        if (trimmedInput.startsWith('[') && trimmedInput.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmedInput);
                if (Array.isArray(parsed)) {
                    keywordsArray = parsed.map(k => String(k).trim()).filter(k => k.length > 0);
                }
            } catch (e) {
                // JSONパース失敗時は通常の分割処理へ
            }
        }

        // 通常の改行・カンマ区切り処理
        if (keywordsArray.length === 0) {
            keywordsArray = setKeywordsInput
                .split(/[\n,]/)
                .map(k => k.trim())
                .filter(k => k.length > 0);
        }

        if (keywordsArray.length === 0) {
            toast.error('キーワードを1つ以上入力してください');
            return;
        }

        try {
            setLoading(true);
            const saved = await keywordSetService.saveKeywordSet({
                id: editingSet?.id,
                name: setName.trim(),
                keywords: keywordsArray
            });

            if (saved) {
                if (editingSet) {
                    updateKeywordSet(saved.id, saved);
                    toast.success('キーワードセットを更新しました');
                } else {
                    addKeywordSet(saved);
                    toast.success('キーワードセットを登録しました');
                }
                resetSetForm();
            }
        } catch (error) {
            console.error('Failed to save set:', error);
            toast.error('保存に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteSet = async (id: string, name: string) => {
        if (!confirm(`セット「${name}」を削除してもよろしいですか？`)) return;

        try {
            setLoading(true);
            await keywordSetService.deleteKeywordSet(id);
            deleteKeywordSet(id);
            toast.success('セットを削除しました');
        } catch (error) {
            console.error('Failed to delete set:', error);
            toast.error('削除に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleEditSet = (set: KeywordSet) => {
        setEditingSet(set);
        setSetName(set.name);
        setSetKeywordsInput(set.keywords.join('\n'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetSetForm = () => {
        setSetName('');
        setSetKeywordsInput('');
        setEditingSet(null);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-3">
                <Layers className="w-8 h-8 text-blue-600" />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">キーワードセット設定</h2>
                    <p className="text-gray-600">自動投稿などに使用するキーワードセットを管理します</p>
                </div>
            </div>

            {/* セット登録フォーム */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">セット名</label>
                        <input
                            type="text"
                            value={setName}
                            onChange={(e) => setSetName(e.target.value)}
                            placeholder="例: 生成AIニュース"
                            className="input-field"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">管理しやすい名前を付けてください</p>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">
                            登録キーワード
                        </label>
                        <textarea
                            value={setKeywordsInput}
                            onChange={(e) => setSetKeywordsInput(e.target.value)}
                            placeholder="AI&#13;&#10;ChatGPT&#13;&#10;Claude (改行で区切ってください)"
                            className="input-field min-h-[120px]"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">1行に1つのキーワードを入力してください</p>
                    </div>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                    {editingSet && (
                        <button
                            onClick={resetSetForm}
                            className="px-6 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            キャンセル
                        </button>
                    )}
                    <button
                        onClick={handleSaveSet}
                        disabled={loading || !setName.trim() || !setKeywordsInput.trim()}
                        className="btn-primary flex items-center space-x-2 px-8"
                    >
                        <Save className="w-4 h-4" />
                        <span>{editingSet ? '更新する' : 'セットを保存する'}</span>
                    </button>
                </div>
            </div>

            {/* セット一覧 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-blue-600" />
                        登録済みセット ({keywordSets.length})
                    </h3>
                </div>

                {keywordSets.length === 0 ? (
                    <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 font-medium">登録されているセットはありません</p>
                        <p className="text-sm text-gray-400 mt-2">上のフォームから最初のセットを作成しましょう</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {keywordSets.map((set) => (
                            <div
                                key={set.id}
                                className={`
                                    relative p-5 bg-white rounded-2xl border-2 transition-all group
                                    ${editingSet?.id === set.id ? 'border-blue-500 shadow-blue-50/50' : 'border-gray-100 hover:border-blue-200 hover:shadow-lg'}
                                `}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h4 className="font-bold text-gray-900 text-lg">{set.name}</h4>
                                        <span className="text-xs text-gray-400">{set.keywords.length}個のキーワード</span>
                                    </div>
                                    <div className="flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditSet(set)}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                                            title="編集"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSet(set.id, set.name)}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                            title="削除"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2 mt-auto">
                                    {set.keywords.slice(0, 10).map((k, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium">
                                            {k}
                                        </span>
                                    ))}
                                    {set.keywords.length > 10 && (
                                        <span className="px-2.5 py-1 bg-gray-50 text-gray-400 rounded-lg text-xs italic">
                                            +{set.keywords.length - 10} more
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-blue-50 p-4 rounded-xl flex items-start gap-3 border border-blue-100">
                <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800">
                    ここで作成したセットは、将来的に「スケジューラー」で一括投稿のターゲットとして指定することができます。
                </p>
            </div>
        </div>
    );
};
