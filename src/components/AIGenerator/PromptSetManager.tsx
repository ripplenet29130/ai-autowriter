import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Trash2, Edit2, X, Save, AlertCircle } from 'lucide-react';
import { PromptSet } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import toast from 'react-hot-toast';

interface PromptSetManagerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (promptSet: PromptSet) => void;
}

export const PromptSetManager: React.FC<PromptSetManagerProps> = ({
    isOpen,
    onClose,
    onSelect
}) => {
    const { promptSets, addPromptSet, updatePromptSet, deletePromptSet } = useAppStore();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editInstructions, setEditInstructions] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    if (!isOpen) return null;

    const handleStartCreate = () => {
        setIsCreating(true);
        setEditingId(null);
        setEditName('');
        setEditInstructions('');
    };

    const handleStartEdit = (ps: PromptSet) => {
        setIsCreating(false);
        setEditingId(ps.id);
        setEditName(ps.name);
        setEditInstructions(ps.customInstructions);
    };

    const handleSave = () => {
        if (!editName.trim() || !editInstructions.trim()) {
            toast.error('名前と指示内容は必須です');
            return;
        }

        if (isCreating) {
            const newPromptSet: PromptSet = {
                id: uuidv4(),
                name: editName,
                customInstructions: editInstructions,
                createdAt: new Date(),
                isDefault: false
            };
            addPromptSet(newPromptSet);
            toast.success('プロンプトセットを作成しました');
            setIsCreating(false);
        } else if (editingId) {
            updatePromptSet(editingId, {
                name: editName,
                customInstructions: editInstructions
            });
            toast.success('プロンプトセットを更新しました');
            setEditingId(null);
        }
    };

    const handleDelete = (id: string) => {
        if (confirm('本当に削除しますか？')) {
            deletePromptSet(id);
            toast.success('プロンプトセットを削除しました');
            if (editingId === id) {
                setEditingId(null);
                setIsCreating(false);
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 className="text-xl font-bold text-gray-900">プロンプトセット管理</h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar List */}
                    <div className="w-1/3 border-r border-gray-100 overflow-y-auto bg-gray-50/30 p-4 space-y-2">
                        <button
                            onClick={handleStartCreate}
                            className="w-full flex items-center justify-center space-x-2 bg-white border border-dashed border-gray-300 rounded-xl p-3 text-gray-500 hover:text-purple-600 hover:border-purple-300 hover:bg-purple-50 transition-all font-bold mb-4"
                        >
                            <Plus className="w-4 h-4" />
                            <span>新規作成</span>
                        </button>

                        {promptSets.length === 0 && !isCreating && (
                            <div className="text-center py-8 text-gray-400 text-sm">
                                プロンプトセットがありません
                            </div>
                        )}

                        {promptSets.map(ps => (
                            <div
                                key={ps.id}
                                className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${editingId === ps.id
                                    ? 'bg-purple-50 border-purple-200 ring-1 ring-purple-100'
                                    : 'bg-white border-gray-100 hover:border-purple-100 hover:shadow-sm'
                                    }`}
                                onClick={() => handleStartEdit(ps)}
                            >
                                <div className="flex-1 min-w-0">
                                    <h4 className={`font-bold truncate ${editingId === ps.id ? 'text-purple-700' : 'text-gray-700'}`}>
                                        {ps.name}
                                    </h4>
                                    <p className="text-xs text-gray-400 truncate mt-0.5">
                                        {ps.customInstructions.substring(0, 30)}...
                                    </p>
                                </div>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelect(ps);
                                            onClose();
                                        }}
                                        className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                        title="選択して閉じる"
                                    >
                                        <div className="text-xs font-bold px-2">適用</div>
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(ps.id);
                                        }}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Editor Area */}
                    <div className="flex-1 p-6 overflow-y-auto bg-white">
                        {isCreating || editingId ? (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-lg font-bold text-gray-900">
                                        {isCreating ? '新しいプロンプトセット' : 'プロンプトセットを編集'}
                                    </h4>
                                    <div className="flex items-center space-x-2">
                                        {(isCreating || editingId) && (
                                            <button
                                                onClick={() => {
                                                    setIsCreating(false);
                                                    setEditingId(null);
                                                }}
                                                className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg text-sm"
                                            >
                                                キャンセル
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSave}
                                            className="bg-gray-900 text-white px-6 py-2 rounded-lg font-bold text-sm flex items-center space-x-2 hover:bg-black transition-colors shadow-lg"
                                        >
                                            <Save className="w-4 h-4" />
                                            <span>保存する</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            セット名
                                        </label>
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            placeholder="例: 観光系記事ルール、禁止用語リストなど"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none font-bold text-gray-900 placeholder-gray-400"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">
                                            AIへの指示（プロンプト）
                                        </label>
                                        <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 mb-2 flex items-start space-x-2">
                                            <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                                            <p className="text-xs text-yellow-800 leading-relaxed">
                                                ここで設定した指示は、記事生成時のシステムプロンプトに追加されます。<br />
                                                具体的な禁止事項や、特定の文体、ターゲット読者への呼びかけ方などを記述してください。
                                            </p>
                                        </div>
                                        <textarea
                                            value={editInstructions}
                                            onChange={(e) => setEditInstructions(e.target.value)}
                                            rows={12}
                                            placeholder="例：
- 競合他社（A社、B社）の具体的なサービス名は出さないでください。
- 語尾は「〜です」「〜ます」で統一し、親しみやすいトーンにしてください。
- 読者に対して「あなた」と呼びかけ、共感を誘う書き方をしてください。
- 専門用語を使う場合は必ず注釈を入れてください。"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-gray-700 leading-relaxed resize-none font-mono text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 space-y-4">
                                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center">
                                    <Edit2 className="w-8 h-8 text-gray-300" />
                                </div>
                                <p>左側のリストから編集するセットを選択するか、<br />新規作成ボタンを押してください</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
