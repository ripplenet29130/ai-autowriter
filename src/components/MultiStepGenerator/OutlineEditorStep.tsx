import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    FileText,
    Plus,
    Trash2,
    Edit2,
    ArrowLeft,
    ArrowRight,
    Sparkles,
    Loader2,
    GripVertical,
    Layout,
    Clock,
    AlignLeft
} from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArticleOutline, OutlineSection, TrendAnalysisResult } from '../../types';

interface OutlineEditorStepProps {
    keywords: string[];
    trendData: TrendAnalysisResult | undefined;
    outline: ArticleOutline | undefined;
    isGenerating: boolean;
    onGenerate: () => void;
    onUpdateOutline: (outline: ArticleOutline) => void;
    onUpdateSection: (sectionId: string, updates: Partial<OutlineSection>) => void;
    onAddSection: (section: OutlineSection) => void;
    onRemoveSection: (sectionId: string) => void;
    onReorderSections: (sectionIds: string[]) => void;
    onNext: () => void;
    onBack: () => void;
}

interface SortableSectionProps {
    section: OutlineSection;
    editingSection: string | null;
    editTitle: string;
    editDescription: string;
    editLevel: 2 | 3 | 4;
    editWordCount: number;
    setEditTitle: (val: string) => void;
    setEditDescription: (val: string) => void;
    setEditLevel: (val: 2 | 3 | 4) => void;
    setEditWordCount: (val: number) => void;
    handleStartEdit: (section: OutlineSection) => void;
    handleSaveEdit: () => void;
    handleCancelEdit: () => void;
    onRemoveSection: (id: string) => void;
}

/**
 * 個別の見出しアイテム（ドラッグ可能）
 */
const SortableSection: React.FC<SortableSectionProps> = ({
    section,
    editingSection,
    editTitle,
    editDescription,
    editLevel,
    editWordCount,
    setEditTitle,
    setEditDescription,
    setEditLevel,
    setEditWordCount,
    handleStartEdit,
    handleSaveEdit,
    handleCancelEdit,
    onRemoveSection
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: section.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : 'auto',
        opacity: isDragging ? 0.5 : 1,
    };

    const isEditing = editingSection === section.id;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`
                overflow-hidden rounded-xl border-2 transition-all duration-200
                ${isEditing
                    ? 'border-purple-500 ring-4 ring-purple-50 shadow-lg'
                    : 'border-gray-100 bg-white hover:border-purple-200 hover:shadow-md'}
                ${isDragging ? 'shadow-2xl ring-4 ring-purple-100' : ''}
            `}
        >
            {isEditing ? (
                /* 編集モード */
                <div className="p-6 space-y-4 bg-white">
                    <div className="flex items-center space-x-3 mb-2">
                        {/* H2/H3/H4 切り替え (プルダウン) */}
                        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                            {section.isLead ? (
                                <span className="text-sm font-bold text-orange-500 px-2 py-0.5">
                                    導入
                                </span>
                            ) : (
                                <select
                                    value={editLevel}
                                    onChange={(e) => setEditLevel(Number(e.target.value) as 2 | 3 | 4)}
                                    className="bg-transparent text-sm font-bold border-none focus:ring-0 cursor-pointer py-0 pl-0 pr-6 text-purple-700"
                                >
                                    <option value={2}>H2</option>
                                    <option value={3}>H3</option>
                                    <option value={4}>H4</option>
                                </select>
                            )}
                        </div>

                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="block w-full text-lg font-bold text-gray-900 border-0 border-b-2 border-gray-100 focus:border-purple-600 focus:ring-0 px-0 py-1 transition-all"
                            placeholder="見出しのタイトルを入力..."
                            autoFocus
                        />
                    </div>

                    <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="block w-full text-gray-600 text-sm border-gray-100 rounded-lg focus:border-purple-600 focus:ring-purple-600/10 min-h-[80px]"
                        placeholder="このセクションで書く内容や、AIへの具体的な指示を入力してください。"
                    />

                    <div className="flex justify-between items-center pt-2">
                        <div className="flex items-center space-x-2">
                            <span className="text-xs font-bold text-gray-500">推定:</span>
                            <input
                                type="number"
                                value={editWordCount}
                                onChange={(e) => setEditWordCount(Number(e.target.value))}
                                className="w-20 text-sm border-gray-200 rounded-md focus:border-purple-500 focus:ring-purple-500/10 py-1 px-2"
                                min={100}
                                step={50}
                            />
                            <span className="text-xs text-gray-400">文字</span>
                        </div>

                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleCancelEdit}
                                className="text-sm font-bold text-gray-500 hover:text-gray-900 px-4 py-2"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                className="bg-purple-600 text-white px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-purple-100 hover:bg-purple-700 transition-all"
                            >
                                変更を適用
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                /* 表示モード */
                <div className={`
                    p-4 flex items-center space-x-4 group transition-all
                    ${section.level === 3 ? 'ml-8 border-l-4 border-l-purple-100' : ''}
                    ${section.level === 4 ? 'ml-16 border-l-4 border-l-blue-50 bg-gray-50/30' : ''}
                `}>
                    <div className="flex-1 text-base">
                        <div className="flex items-center space-x-3">
                            <span className={`
                                text-[10px] font-black w-8 h-8 rounded-lg flex items-center justify-center shadow-sm
                                ${section.isLead ? 'bg-orange-500 text-white' :
                                    section.level === 2 ? 'bg-gray-900 text-white' :
                                        section.level === 3 ? 'bg-white border-2 border-gray-200 text-gray-500' :
                                            'bg-white border-2 border-dashed border-gray-200 text-gray-400'}
                            `}>
                                {section.isLead ? '導入' : `H${section.level}`}
                            </span>
                            <h4 className={`
                                font-bold text-gray-900 flex-1
                                ${section.level === 2 ? 'text-lg' :
                                    section.level === 3 ? 'text-base' :
                                        'text-sm font-medium text-gray-700'}
                            `}>
                                {section.title}
                            </h4>
                        </div>

                        {section.description && (
                            <p className="text-sm text-gray-500 mt-1 pl-11 line-clamp-1">{section.description}</p>
                        )}

                        <div className="flex items-center space-x-4 mt-2 pl-11 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                            <span>推定: {section.estimatedWordCount}字</span>
                        </div>
                    </div>

                    <div className="flex items-center space-x-1">
                        <button
                            onClick={() => handleStartEdit(section)}
                            className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"
                            title="編集"
                        >
                            <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onRemoveSection(section.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="削除"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <div
                            {...attributes}
                            {...listeners}
                            className="p-2 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing transition-colors"
                            title="ドラッグして移動"
                        >
                            <GripVertical className="w-5 h-5" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * ステップ3: アウトライン（見出し構成）の編集
 */
export const OutlineEditorStep: React.FC<OutlineEditorStepProps> = ({
    keywords,
    trendData,
    outline,
    isGenerating,
    onGenerate,
    onUpdateSection,
    onAddSection,
    onRemoveSection,
    onReorderSections,
    onNext,
    onBack
}) => {
    const [editingSection, setEditingSection] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editLevel, setEditLevel] = useState<2 | 3 | 4>(2);
    const [editWordCount, setEditWordCount] = useState<number>(0);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = outline!.sections.findIndex((s) => s.id === active.id);
            const newIndex = outline!.sections.findIndex((s) => s.id === over.id);

            const newSections = arrayMove(outline!.sections, oldIndex, newIndex);
            onReorderSections(newSections.map(s => s.id));
        }
    };

    // アウトライン未生成の場合
    if (!outline && !isGenerating) {
        return (
            <div className="space-y-8 animate-in fade-in duration-500">
                <div className="bg-white border border-gray-200 rounded-3xl p-12 text-center shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-purple-50 rounded-full blur-3xl opacity-50" />
                    <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50" />

                    <div className="relative z-10">
                        <div className="bg-gradient-to-br from-purple-500 to-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-200">
                            <Layout className="w-10 h-10 text-white" />
                        </div>
                        <h3 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">
                            最高の構成をデザインしましょう
                        </h3>
                        <p className="text-gray-600 max-w-md mx-auto mb-8 leading-relaxed">
                            リサーチ結果と選択したタイトルを基に、読者の満足度とSEOを両立させた「売れる記事構成」をAIが自動作成します。
                        </p>
                        <button
                            onClick={onGenerate}
                            className="bg-gray-900 hover:bg-black text-white px-8 py-4 rounded-full font-bold transition-all transform hover:scale-105 active:scale-95 flex items-center space-x-3 mx-auto shadow-xl hover:shadow-2xl"
                        >
                            <Sparkles className="w-6 h-6 text-yellow-400" />
                            <span>構成案をAIで生成する</span>
                        </button>
                    </div>
                </div>

                <div className="flex justify-start">
                    <button
                        onClick={onBack}
                        className="flex items-center space-x-2 text-gray-500 hover:text-gray-900 font-medium transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>タイトル選択に戻る</span>
                    </button>
                </div>
            </div>
        );
    }

    // 生成中
    if (isGenerating) {
        return (
            <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in-95 duration-300">
                <div className="relative mb-8">
                    <div className="w-20 h-20 border-4 border-purple-100 rounded-full" />
                    <div className="w-20 h-20 border-4 border-purple-600 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                    <Sparkles className="w-8 h-8 text-purple-600 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">構成を構築中...</h3>
                <p className="text-gray-500 mt-2">論理的な流れとキーワード配置を最適化しています</p>
                <div className="mt-8 flex gap-1">
                    <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce" />
                </div>
            </div>
        );
    }

    const handleStartEdit = (section: OutlineSection) => {
        setEditingSection(section.id);
        setEditTitle(section.title);
        setEditDescription(section.description || '');
        setEditLevel(section.level as 2 | 3 | 4);
        setEditWordCount(section.estimatedWordCount);
    };

    const handleSaveEdit = () => {
        if (editingSection) {
            onUpdateSection(editingSection, {
                title: editTitle,
                description: editDescription,
                level: editLevel,
                estimatedWordCount: editWordCount
            });
            setEditingSection(null);
        }
    };

    const handleAddNewSection = () => {
        const newSection: OutlineSection = {
            id: uuidv4(),
            title: '新しい見出し',
            level: 2,
            description: '',
            estimatedWordCount: 300,
            order: outline!.sections.length,
            isGenerated: false
        };
        onAddSection(newSection);
    };

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* 記事概要カード */}
            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm ring-1 ring-gray-900/5">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <div className="flex items-center space-x-2 mb-2">
                            <span className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs font-bold rounded uppercase tracking-wider">
                                Final Title
                            </span>
                        </div>
                        <h2 className="text-2xl font-black text-gray-900 leading-tight">
                            {outline!.title}
                        </h2>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-50">
                    <div className="flex items-center space-x-2">
                        <div className="bg-blue-50 p-1.5 rounded-lg text-blue-600">
                            <AlignLeft className="w-4 h-4" />
                        </div>
                        {(() => {
                            const totalChars = outline?.sections.reduce((sum, s) => sum + s.estimatedWordCount, 0) || 0;
                            return (
                                <>
                                    <div>
                                        <p className="text-[10px] text-gray-500 font-bold uppercase">推定総文字数</p>
                                        <p className="text-sm font-bold text-gray-900">{totalChars.toLocaleString()}字</p>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="bg-green-50 p-1.5 rounded-lg text-green-600">
                            <Layout className="w-4 h-4" />
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-500 font-bold uppercase">セクション数</p>
                            <p className="text-sm font-bold text-gray-900">{outline!.sections.length}個</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-2 text-gray-400">
                        <div className="bg-gray-50 p-1.5 rounded-lg">
                            <Clock className="w-4 h-4" />
                        </div>
                        {(() => {
                            const totalChars = outline?.sections.reduce((sum, s) => sum + s.estimatedWordCount, 0) || 0;
                            return (
                                <div>
                                    <p className="text-[10px] text-gray-500 font-bold uppercase">想定読了時間</p>
                                    <p className="text-sm font-bold text-gray-900">約 {Math.ceil(totalChars / 600)}分</p>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* 見出し構成エリア */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                    <h3 className="font-black text-gray-900 flex items-center space-x-2">
                        <AlignLeft className="w-5 h-5 text-purple-600" />
                        <span>見出しの構成を編集</span>
                    </h3>
                    <p className="text-xs text-gray-500 font-medium italic">
                        右側のアイコンをドラッグして順番を入れ替えられます
                    </p>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={outline!.sections.map(s => s.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-3">
                            {outline!.sections.map((section) => (
                                <SortableSection
                                    key={section.id}
                                    section={section}
                                    editingSection={editingSection}
                                    editTitle={editTitle}
                                    editDescription={editDescription}
                                    editLevel={editLevel}
                                    editWordCount={editWordCount}
                                    setEditTitle={setEditTitle}
                                    setEditDescription={setEditDescription}
                                    setEditLevel={setEditLevel}
                                    setEditWordCount={setEditWordCount}
                                    handleStartEdit={handleStartEdit}
                                    handleSaveEdit={handleSaveEdit}
                                    handleCancelEdit={() => setEditingSection(null)}
                                    onRemoveSection={onRemoveSection}
                                />
                            ))}

                            <button
                                onClick={handleAddNewSection}
                                className="w-full border-2 border-dashed border-gray-200 rounded-xl p-4 text-gray-500 font-bold hover:border-purple-300 hover:bg-purple-50 hover:text-purple-600 transition-all flex items-center justify-center space-x-2 group"
                            >
                                <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                <span>新しい見出しを追加する</span>
                            </button>
                        </div>
                    </SortableContext>
                </DndContext>
            </div>

            {/* ナビゲーションバー */}
            <div className="flex justify-between items-center pt-8 border-t border-gray-100 mt-8">
                <button
                    onClick={onBack}
                    className="group flex items-center space-x-2 text-gray-500 hover:text-gray-900 font-bold transition-all"
                >
                    <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                    <span>タイトル選択に戻る</span>
                </button>

                <button
                    onClick={onNext}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-10 py-4 rounded-full font-black shadow-xl shadow-blue-100 flex items-center space-x-3 transform hover:scale-105 active:scale-95 transition-all"
                >
                    <span>本文の執筆を開始</span>
                    <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};
