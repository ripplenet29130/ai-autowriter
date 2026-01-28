import React from 'react';
import { Hash, X } from 'lucide-react';

interface KeywordManagerProps {
    keywords: string[];
    inputValue: string;
    onInputChange: (value: string) => void;
    onAdd: (keyword: string) => void;
    onRemove: (keyword: string) => void;
    disabled?: boolean;
}

/**
 * キーワード管理コンポーネント
 */
export const KeywordManager: React.FC<KeywordManagerProps> = ({
    keywords,
    inputValue,
    onInputChange,
    onAdd,
    onRemove,
    disabled = false,
}) => {
    const handleAdd = () => {
        const trimmed = inputValue.trim();
        if (trimmed && !keywords.includes(trimmed)) {
            onAdd(trimmed);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    キーワード
                </label>
                <div className="flex space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="キーワードを追加"
                        disabled={disabled}
                        className="input-field flex-1"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={disabled || !inputValue.trim()}
                        className="btn-secondary"
                    >
                        <Hash className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {keywords.map((keyword, index) => (
                        <span
                            key={index}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 border border-blue-200"
                        >
                            {keyword}
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => onRemove(keyword)}
                                    className="ml-2 text-blue-600 hover:text-blue-800"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};
