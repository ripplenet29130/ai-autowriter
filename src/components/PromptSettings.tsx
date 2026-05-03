import React, { useEffect, useState } from 'react';
import { Edit2, Info, Layers, MessageSquare, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { PromptSet } from '../types';
import { useAppStore } from '../store/useAppStore';

export const PromptSettings: React.FC = () => {
    const {
        promptSets,
        addPromptSet,
        updatePromptSet,
        deletePromptSet,
        loadPromptSets
    } = useAppStore();
    const [loading, setLoading] = useState(false);
    const [setName, setSetName] = useState('');
    const [promptInput, setPromptInput] = useState('');
    const [editingSet, setEditingSet] = useState<PromptSet | null>(null);

    useEffect(() => {
        loadPromptSets();
    }, [loadPromptSets]);

    const resetSetForm = () => {
        setSetName('');
        setPromptInput('');
        setEditingSet(null);
    };

    const handleSaveSet = async () => {
        const name = setName.trim();
        const customInstructions = promptInput.trim();

        if (!name) {
            toast.error('セット名を入力してください');
            return;
        }

        if (!customInstructions) {
            toast.error('プロンプトを入力してください');
            return;
        }

        try {
            setLoading(true);

            if (editingSet) {
                await updatePromptSet(editingSet.id, {
                    name,
                    customInstructions
                });
                toast.success('プロンプトセットを更新しました');
            } else {
                await addPromptSet({
                    id: uuidv4(),
                    name,
                    customInstructions,
                    isDefault: false,
                    createdAt: new Date()
                });
                toast.success('プロンプトセットを登録しました');
            }

            resetSetForm();
        } catch (error) {
            console.error('Failed to save prompt set:', error);
            toast.error('保存に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteSet = async (id: string, name: string) => {
        if (!confirm(`セット「${name}」を削除してもよろしいですか？`)) return;

        try {
            setLoading(true);
            await deletePromptSet(id);
            toast.success('セットを削除しました');

            if (editingSet?.id === id) {
                resetSetForm();
            }
        } catch (error) {
            console.error('Failed to delete prompt set:', error);
            toast.error('削除に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const handleEditSet = (set: PromptSet) => {
        setEditingSet(set);
        setSetName(set.name);
        setPromptInput(set.customInstructions);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-3">
                <MessageSquare className="w-8 h-8 text-emerald-600" />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">プロンプトセット設定</h2>
                    <p className="text-gray-600">記事生成時に使用するプロンプトテンプレートを管理します</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">セット名</label>
                        <input
                            type="text"
                            value={setName}
                            onChange={(e) => setSetName(e.target.value)}
                            placeholder="例: 医療記事向け、比較記事向け、丁寧な文体"
                            className="input-field"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">管理しやすい名前を付けてください</p>
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700">プロンプト</label>
                        <textarea
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                            placeholder="例: 読者に寄り添う丁寧な文体で、専門用語は初出時にわかりやすく補足してください。"
                            className="input-field min-h-[180px]"
                            disabled={loading}
                        />
                        <p className="text-xs text-gray-400">記事生成時に追加したい指示を入力してください</p>
                    </div>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                    {editingSet && (
                        <button
                            onClick={resetSetForm}
                            className="px-6 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                            disabled={loading}
                        >
                            キャンセル
                        </button>
                    )}
                    <button
                        onClick={handleSaveSet}
                        disabled={loading || !setName.trim() || !promptInput.trim()}
                        className="btn-primary flex items-center space-x-2 px-8"
                    >
                        <Save className="w-4 h-4" />
                        <span>{editingSet ? '更新する' : 'セットを保存する'}</span>
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-emerald-600" />
                        登録済みセット ({promptSets.length})
                    </h3>
                </div>

                {promptSets.length === 0 ? (
                    <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                        <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 font-medium">登録されているセットはありません</p>
                        <p className="text-sm text-gray-400 mt-2">上のフォームから最初のプロンプトセットを作成しましょう</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {promptSets.map((set) => (
                            <div
                                key={set.id}
                                className={`
                                    relative p-5 bg-white rounded-2xl border-2 transition-all group
                                    ${editingSet?.id === set.id ? 'border-emerald-500 shadow-emerald-50/50' : 'border-gray-100 hover:border-emerald-200 hover:shadow-lg'}
                                `}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="min-w-0">
                                        <h4 className="font-bold text-gray-900 text-lg truncate">{set.name}</h4>
                                        <span className="text-xs text-gray-400">プロンプトセット</span>
                                    </div>
                                    <div className="flex gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditSet(set)}
                                            className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
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

                                <div className="px-3 py-2 bg-emerald-50 text-emerald-900 rounded-lg text-xs leading-relaxed line-clamp-4">
                                    {set.customInstructions}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-emerald-50 p-4 rounded-xl flex items-start gap-3 border border-emerald-100">
                <Info className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-800">
                    ここで作成したプロンプトセットは、記事生成やスケジューラーで生成方針として選択できます。
                </p>
            </div>
        </div>
    );
};
