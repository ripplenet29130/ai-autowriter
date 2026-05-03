import React, { useState } from 'react';
import { BookOpen, Heading, MessageSquare, Tag } from 'lucide-react';
import { KeywordSettings } from './KeywordSettings';
import { PromptSettings } from './PromptSettings';
import { TitleSettings } from './TitleSettings';

type TemplateTab = 'keywords' | 'titles' | 'prompts';

const tabs: Array<{ id: TemplateTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'keywords', label: 'キーワード', icon: Tag },
  { id: 'titles', label: 'タイトル', icon: Heading },
  { id: 'prompts', label: 'プロンプト', icon: MessageSquare },
];

export const ClientTemplates: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TemplateTab>('keywords');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="w-8 h-8 text-gray-700" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">テンプレート</h2>
          <p className="text-gray-600">記事作成で使用するキーワード、タイトル、プロンプトを管理します。</p>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'keywords' && <KeywordSettings />}
      {activeTab === 'titles' && <TitleSettings />}
      {activeTab === 'prompts' && <PromptSettings />}
    </div>
  );
};
