import React, { useState, useEffect } from 'react';
import { Heading, Plus, Trash2, Save, Layers, Edit2, Info } from 'lucide-react';
import { titleSetService } from '../services/titleSetService';
import { TitleSet } from '../types';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';

export const TitleSettings: React.FC = () => {
    const { titleSets, addTitleSet, updateTitleSet, deleteTitleSet, loadTitleSets } = useAppStore();
    const [loading, setLoading] = useState(false);

    // Title Set states
    const [setName, setSetName] = useState('');
    const [setTitlesInput, setSetTitlesInput] = useState('');
    const [editingSet, setEditingSet] = useState<TitleSet | null>(null);

    useEffect(() => {
        loadTitleSets();
    }, []);

    // Title Set Handlers
    const handleSaveSet = async () => {
        if (!setName.trim()) {
            toast.error('セット名を入力してください');
            return;
        }

        let titlesArray: string[] = [];
        const trimmedInput = setTitlesInput.trim();

        // JSON配列形式の入力をサポート
        if (trimmedInput.startsWith('[') && trimmedInput.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmedInput);
                if (Array.isArray(parsed)) {
                    titlesArray = parsed.map(t => String(t).trim()).filter(t => t.length > 0);
                }
            } catch (e) {
                // JSONパース失敗時は通常の分割処理へ
            }
        }

        // 通常の改行・カンマ区切り処理
        if (titlesArray.length === 0) {
            titlesArray = setTitlesInput
                .split(/[\n,]/)
                .map(t => t.trim())
                .filter(t => t.length > 0);
        }

        if (titlesArray.length === 0) {
            toast.error('タイトルを1つ以上入力してください');
            return;
        }

        try {
            setLoading(true);
            const saved = await titleSetService.saveTitleSet({
                id: editingSet?.id,
                name: setName.trim(),
                titles: titlesArray
            });

            if (saved) {
                if (editingSet) {
                    updateTitleSet(saved.id, saved);
                    toast.success('タイトルセットを更新しました');
                } else {
                    addTitleSet(saved);
                    toast.success('タイトルセットを登録しました');
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
            await titleSetService.deleteTitleSet(id);
            deleteTitleSet(id);
            toast.success('セットを削除しました');
        } catch (error) {
            console.error('Failed to delete set:', error);
            toast.error('削除に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleEditSet = (set: TitleSet) => {
        setEditingSet(set);
        setSetName(set.name);
        setSetTitlesInput(set.titles.join('\n'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetSetForm = () => {
        setSetName('');
        setSetTitlesInput('');
        setEditingSet(null);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-3">
                <Heading className="w-8 h-8 text-purple-600" />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">タイトルリスト設定</h2>
                    <p className="text-gray-600">自動投稿などに使用するタイトルセットを管理します</p>
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
                            placeholder="例: 生成AI関連タイトル集"
                            className="input-field"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">管理しやすい名前を付けてください</p>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">
                            登録タイトル
                        </label>
                        <textarea
                            value={setTitlesInput}
                            onChange={(e) => setSetTitlesInput(e.target.value)}
                            placeholder="AIの最新動向2024&#13;&#10;ChatGPTの使い方完全ガイド&#13;&#10;生成AIがもたらす未来 (改行で区切ってください)"
                            className="input-field min-h-[120px]"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">1行に1つのタイトルを入力してください</p>
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
                        disabled={loading || !setName.trim() || !setTitlesInput.trim()}
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
                        <Layers className="w-5 h-5 text-purple-600" />
                        登録済みセット ({titleSets.length})
                    </h3>
                </div>

                {titleSets.length === 0 ? (
                    <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <Heading className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 font-medium">登録されているセットはありません</p>
                        <p className="text-sm text-gray-400 mt-2">上のフォームから最初のセットを作成しましょう</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {titleSets.map((set) => (
                            <div
                                key={set.id}
                                className={`
                                    relative p-5 bg-white rounded-2xl border-2 transition-all group
                                    ${editingSet?.id === set.id ? 'border-purple-500 shadow-purple-50/50' : 'border-gray-100 hover:border-purple-200 hover:shadow-lg'}
                                `}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h4 className="font-bold text-gray-900 text-lg">{set.name}</h4>
                                        <span className="text-xs text-gray-400">{set.titles.length}個のタイトル</span>
                                    </div>
                                    <div className="flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditSet(set)}
                                            className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-xl transition-all"
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

                                <div className="space-y-2 mt-auto">
                                    {set.titles.slice(0, 3).map((title, i) => (
                                        <div key={i} className="px-3 py-2 bg-purple-50 text-purple-900 rounded-lg text-xs font-medium truncate">
                                            {title}
                                        </div>
                                    ))}
                                    {set.titles.length > 3 && (
                                        <div className="px-3 py-2 bg-gray-50 text-gray-400 rounded-lg text-xs italic text-center">
                                            +{set.titles.length - 3} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-purple-50 p-4 rounded-xl flex items-start gap-3 border border-purple-100">
                <Info className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                <p className="text-sm text-purple-800">
                    ここで作成したセットは、「スケジューラー」でタイトルから直接記事を生成する際に使用できます。
                </p>
            </div>
        </div>
    );
};
