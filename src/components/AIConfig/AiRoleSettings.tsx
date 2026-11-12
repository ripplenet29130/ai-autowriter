import React, { useEffect, useMemo, useState } from 'react';
import { PenLine, Save, Search, ShieldCheck, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import { getCurrentUserId, getOwnershipInsertFields } from '../../services/accountScope';
import { getAiModelOptions } from '../../shared/aiModelCatalog';
import {
  AI_PROVIDER_LABELS,
  AI_ROLES,
  formatAiRoleChoice,
  normalizeAiRoleValue,
  parseAiRoleChoice,
  type AiRole,
  type AiRoleDefinition,
} from '../../shared/aiRoleSettings';
import type { AIConfig } from '../../types';

interface Props {
  aiConfigs: AIConfig[];
}

// 役割の一覧（名前・説明・選べる AI・標準）は shared/aiRoleSettings.ts の AI_ROLES にある。
// ここはその一覧から欄を作るだけなので、役割を増やしても画面を直す必要はない（アイコンだけ任意で足す）
const ROLE_ICONS: Partial<Record<AiRole, React.ReactNode>> = {
  research: <Search className="w-5 h-5 text-purple-600" />,
  writer: <PenLine className="w-5 h-5 text-blue-600" />,
  factcheck: <ShieldCheck className="w-5 h-5 text-green-600" />,
  fix: <Wrench className="w-5 h-5 text-orange-600" />,
};

const defaultValues = (): Record<string, string> =>
  Object.fromEntries(AI_ROLES.map((role) => [role.id, role.defaultValue]));

export const AiRoleSettings: React.FC<Props> = ({ aiConfigs }) => {
  const [values, setValues] = useState<Record<string, string>>(defaultValues);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const configuredProviders = useMemo(() => new Set(aiConfigs.map((c) => c.provider)), [aiConfigs]);

  useEffect(() => {
    const userId = getCurrentUserId();
    const client = supabase;
    if (!userId || !client) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await client
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', AI_ROLES.map((role) => role.settingKey));
      if (error) console.error('Failed to load AI role settings:', error);
      const map = new Map((data || []).map((row: any) => [String(row.key), String(row.value || '')]));
      setValues(Object.fromEntries(AI_ROLES.map((role) => [role.id, normalizeAiRoleValue(role, map.get(role.settingKey))])));
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    for (const role of AI_ROLES) {
      const choice = parseAiRoleChoice(values[role.id]);
      // 標準の選択はキーがなくても保存できる（キーを保存するまで Gemini で行う）
      if (choice && choice.provider !== 'gemini' && values[role.id] !== role.defaultValue && !configuredProviders.has(choice.provider)) {
        toast.error(`${role.title}: ${AI_PROVIDER_LABELS[choice.provider]} の API キーを先に保存してください`);
        return;
      }
    }
    const client = supabase;
    if (!client) {
      toast.error('データベースに接続できません');
      return;
    }
    setSaving(true);
    try {
      const ownership = getOwnershipInsertFields();
      for (const role of AI_ROLES) {
        const { error } = await client.from('app_settings').upsert({
          ...ownership,
          key: role.settingKey,
          value: values[role.id],
          description: `AI used for: ${role.id}`,
        }, { onConflict: 'user_id,key' });
        if (error) throw error;
      }
      toast.success('役割ごとの AI を保存しました');
    } catch (error) {
      console.error('Failed to save AI role settings:', error);
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const renderSelect = (role: AiRoleDefinition) => {
    const current = values[role.id] || role.defaultValue;
    const currentChoice = parseAiRoleChoice(current);
    const isDefault = (value: string) => value === role.defaultValue;
    return (
      <select
        value={current}
        disabled={loading}
        onChange={(e) => setValues((prev) => ({ ...prev, [role.id]: e.target.value }))}
        className="input-field"
      >
        <option value="auto">Gemini（標準のモデル）{isDefault('auto') ? '・おすすめ' : ''}</option>
        {role.providers.map((provider) => {
          const configured = provider === 'gemini' || configuredProviders.has(provider);
          // 保存済みの選択は、キーが消えていても表示だけはする
          if (!configured && currentChoice?.provider !== provider) return null;
          return (
            <optgroup key={provider} label={`${AI_PROVIDER_LABELS[provider]}${configured ? '' : '（API キー未設定）'}`}>
              {getAiModelOptions(provider).map((option) => {
                const value = formatAiRoleChoice({ provider, model: option.value });
                return (
                  <option key={option.value} value={value}>
                    {option.label}（{option.tier}）{isDefault(value) ? '・おすすめ' : ''}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>
    );
  };

  const defaultChoiceMissingKey = (role: AiRoleDefinition) => {
    const choice = parseAiRoleChoice(values[role.id]);
    return choice && choice.provider !== 'gemini' && !configuredProviders.has(choice.provider);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">役割ごとの AI</h3>
      <p className="text-sm text-gray-600 mb-5">
        記事作成の新方式で、工程ごとに使う AI を選べます。ChatGPT・Claude は API キーを保存すると選べるようになります。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {AI_ROLES.map((role) => (
          <div key={role.id}>
            <div className="flex items-center gap-2 mb-2">
              {ROLE_ICONS[role.id]}
              <label className="text-sm font-medium text-gray-800">{role.title}</label>
            </div>
            {renderSelect(role)}
            {defaultChoiceMissingKey(role) && (
              <p className="text-xs text-amber-700 mt-2">
                この AI の API キーがありません。キーを保存するまでは Gemini で行います。
              </p>
            )}
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">{role.description}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-4">
        選んだ AI が使えなかったとき（キーがない・混雑で失敗した）は Gemini で続け、通知に残します。Gemini の API キーは必ず必要です。
      </p>
      <div className="flex justify-end mt-5 pt-4 border-t border-gray-200">
        <button onClick={handleSave} disabled={loading || saving} className="btn-primary flex items-center space-x-2 disabled:opacity-50">
          <Save className="w-4 h-4" />
          <span>{saving ? '保存中...' : '保存'}</span>
        </button>
      </div>
    </div>
  );
};
