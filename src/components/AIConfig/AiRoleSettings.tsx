import React, { useEffect, useMemo, useState } from 'react';
import { PenLine, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';
import { getCurrentUserId, getOwnershipInsertFields } from '../../services/accountScope';
import {
  DEFAULT_QUALITY_MODE,
  getAiModelOptions,
  normalizeAiModel,
  resolveWritingModel,
  type AiProvider,
} from '../../shared/aiModelCatalog';
import {
  AI_PROVIDER_LABELS,
  AI_ROLE_SETTING_KEYS,
  formatAiRoleChoice,
  parseAiRoleChoice,
  type AiRole,
} from '../../shared/aiRoleSettings';
import type { AIConfig } from '../../types';

interface Props {
  aiConfigs: AIConfig[];
}

const PROVIDERS: AiProvider[] = ['gemini', 'claude', 'openai'];

const ROLE_INFO: Record<AiRole, { title: string; description: string; icon: React.ReactNode }> = {
  writer: {
    title: '執筆に使う AI',
    description: '記事の本文を書く AI です（記事作成の新方式「広い調査＋1回で書き切る」で使います）。調査は Gemini の Google 検索で行います。',
    icon: <PenLine className="w-5 h-5 text-blue-600" />,
  },
  factcheck: {
    title: 'ファクトチェックに使う AI',
    description: '本文の主張を抜き出し、Web 検索で正しいか確かめる AI です。書いた AI と別の AI にすると、同じ思い込みで見逃すことが減ります。',
    icon: <ShieldCheck className="w-5 h-5 text-green-600" />,
  },
};

export const AiRoleSettings: React.FC<Props> = ({ aiConfigs }) => {
  const [values, setValues] = useState<Record<AiRole, string>>({ writer: 'auto', factcheck: 'auto' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const configuredProviders = useMemo(
    () => new Set(aiConfigs.map((c) => c.provider)),
    [aiConfigs],
  );

  // 未選択（auto）のときに実際に使われる Gemini のモデル（記事作成の新方式と同じ決め方）
  // - 執筆: 高品質モード（標準）では上位モデル
  // - ファクトチェック: AI 設定の Gemini のモデル
  // 選択欄では auto をこのモデルとして表示し、このモデルを選んだら auto として保存する（今まで通りの動き）
  const defaultValues = useMemo(() => {
    const geminiBase = normalizeAiModel('gemini', aiConfigs.find((c) => c.provider === 'gemini')?.model);
    return {
      writer: formatAiRoleChoice({ provider: 'gemini', model: resolveWritingModel('gemini', geminiBase, DEFAULT_QUALITY_MODE) }),
      factcheck: formatAiRoleChoice({ provider: 'gemini', model: geminiBase }),
    } as Record<AiRole, string>;
  }, [aiConfigs]);

  useEffect(() => {
    const userId = getCurrentUserId();
    if (!userId || !supabase) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase!
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', [AI_ROLE_SETTING_KEYS.writer, AI_ROLE_SETTING_KEYS.factcheck]);
      if (error) console.error('Failed to load AI role settings:', error);
      const map = new Map((data || []).map((row: any) => [String(row.key), String(row.value || '')]));
      setValues({
        writer: formatAiRoleChoice(parseAiRoleChoice(map.get(AI_ROLE_SETTING_KEYS.writer))),
        factcheck: formatAiRoleChoice(parseAiRoleChoice(map.get(AI_ROLE_SETTING_KEYS.factcheck))),
      });
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    for (const role of ['writer', 'factcheck'] as AiRole[]) {
      const choice = parseAiRoleChoice(values[role]);
      if (choice && !configuredProviders.has(choice.provider)) {
        toast.error(`${AI_PROVIDER_LABELS[choice.provider]} の API キーを先に保存してください`);
        return;
      }
    }
    if (!supabase) {
      toast.error('データベースに接続できません');
      return;
    }
    const client = supabase;
    setSaving(true);
    try {
      const ownership = getOwnershipInsertFields();
      for (const role of ['writer', 'factcheck'] as AiRole[]) {
        const { error } = await client.from('app_settings').upsert({
          ...ownership,
          key: AI_ROLE_SETTING_KEYS[role],
          value: values[role],
          description: role === 'writer' ? 'AI used to write article body' : 'AI used for fact checking',
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

  const renderSelect = (role: AiRole) => {
    const current = values[role];
    const defaultValue = defaultValues[role];
    const shown = current === 'auto' ? defaultValue : current;
    const shownChoice = parseAiRoleChoice(shown);
    return (
      <select
        value={shown}
        disabled={loading}
        onChange={(e) => {
          const next = e.target.value === defaultValue ? 'auto' : e.target.value;
          setValues((prev) => ({ ...prev, [role]: next }));
        }}
        className="input-field"
      >
        {PROVIDERS.map((provider) => {
          const configured = configuredProviders.has(provider);
          // 選んでいるモデルの会社は、キーが消えていても表示だけはする
          if (!configured && shownChoice?.provider !== provider) return null;
          const options = getAiModelOptions(provider).map((option) => ({
            value: formatAiRoleChoice({ provider, model: option.value }),
            label: `${option.label}（${option.tier}）`,
          }));
          // 一覧にないモデルを使っている場合も、そのモデルを選べるようにする
          if (shownChoice?.provider === provider && !options.some((o) => o.value === shown)) {
            options.unshift({ value: shown, label: shownChoice.model });
          }
          return (
            <optgroup key={provider} label={`${AI_PROVIDER_LABELS[provider]}${configured ? '' : '（API キー未設定）'}`}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">役割ごとの AI</h3>
      <p className="text-sm text-gray-600 mb-5">
        記事の執筆とファクトチェックに使う AI を別々に選べます。選べるのは API キーを保存した AI だけです。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(['writer', 'factcheck'] as AiRole[]).map((role) => (
          <div key={role}>
            <div className="flex items-center gap-2 mb-2">
              {ROLE_INFO[role].icon}
              <label className="text-sm font-medium text-gray-800">{ROLE_INFO[role].title}</label>
            </div>
            {renderSelect(role)}
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">{ROLE_INFO[role].description}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-4">
        ChatGPT・Claude を選んだ場合も、調査と間違いの書き直しは Gemini で行います（Gemini の API キーは必要です）。
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
