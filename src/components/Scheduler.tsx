import React, { useState, useEffect } from 'react';
import { Calendar, Globe, Clock, Tag, Trash2, Edit2, Power, MessageSquare, Zap, ShieldCheck } from 'lucide-react';
import { scheduleService } from '../services/scheduleService';
import { supabaseSchedulerService } from '../services/supabaseSchedulerService';
import { ScheduleSetting } from '../types';
import { useAppStore } from '../store/useAppStore';
import { PromptSetManager } from './AIGenerator/PromptSetManager';
import toast from 'react-hot-toast';
import { Play } from 'lucide-react';

const SCHEDULE_LIMIT = 5;

const DEFAULT_CHATWORK_TEMPLATE = `いつもお世話になっております。
記事の投稿が完了しましたので、ご報告いたします。

■ 記事タイトル
{title}

■ キーワード
{keyword}

■ 投稿URL
{url}

■ 投稿状態
{status}

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。`;

export const Scheduler: React.FC = () => {
  const { aiConfigs, wordPressConfigs, keywordSets, titleSets, promptSets, loadKeywordSets, loadTitleSets, loadPromptSets } = useAppStore();
  const [schedules, setSchedules] = useState<ScheduleSetting[]>([]);
  const [usedKeywordsMap, setUsedKeywordsMap] = useState<Record<string, string[]>>({});
  const [lastExecutionMap, setLastExecutionMap] = useState<Record<string, string | null>>({});

  const [loading, setLoading] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleSetting | null>(null);
  const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    ai_config_id: '',
    wp_config_id: '',
    generation_mode: 'keyword' as 'keyword' | 'title' | 'both',
    keyword: '',
    keyword_set_id: '',
    title_set_id: '',
    post_time: '09:00',
    frequency: '毎日',
    post_status: 'publish' as 'publish' | 'draft',
    start_date: '',
    end_date: '',
    chatwork_room_id: '',
    chatwork_message_template: DEFAULT_CHATWORK_TEMPLATE,
    prompt_set_id: '',
    target_word_count: 2000,
    writing_tone: 'professional',
    status: true,
    enable_fact_check: false,
    fact_check_note: '',
    selected_title: '',
  });

  // Load schedules and keyword sets on mount
  useEffect(() => {
    loadSchedules();
    loadKeywordSets();
    loadTitleSets();
    loadPromptSets();
  }, []);


  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await scheduleService.getSchedules();
      setSchedules(data);

      // Fetch used keywords and last execution for each schedule
      const keywordsMap: Record<string, string[]> = {};
      const executionsMap: Record<string, string | null> = {};
      await Promise.all(data.map(async (schedule) => {
        if (schedule.id) {
          const [used, lastRun] = await Promise.all([
            scheduleService.getUsedKeywords(schedule.id),
            scheduleService.getLastExecution(schedule.id)
          ]);
          keywordsMap[schedule.id] = used;
          executionsMap[schedule.id] = lastRun;
        }
      }));
      setUsedKeywordsMap(keywordsMap);
      setLastExecutionMap(executionsMap);

    } catch (error) {
      console.error('Failed to load schedules:', error);
      toast.error('スケジュールの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!formData.ai_config_id) {
      toast.error('AI設定を選択してください');
      return;
    }
    if (!formData.wp_config_id) {
      toast.error('WordPress設定を選択してください');
      return;
    }

    // Validate based on generation mode
    if (formData.generation_mode === 'keyword' || formData.generation_mode === 'both') {
      if (!formData.keyword.trim()) {
        toast.error('キーワードセットを選択してください');
        return;
      }
    }

    if (formData.generation_mode === 'title' || formData.generation_mode === 'both') {
      if (!formData.title_set_id) {
        toast.error('タイトルセットを選択してください');
        return;
      }
    }

    try {
      setLoading(true);

      if (editingSchedule) {
        await scheduleService.updateSchedule(editingSchedule.id!, formData);
        toast.success('スケジュールを更新しました');
      } else {
        await scheduleService.createSchedule(formData);
        toast.success('スケジュールを作成しました');
      }

      await loadSchedules();
      resetForm();
    } catch (error) {
      console.error('Failed to save schedule:', error);
      toast.error('スケジュールの保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (schedule: ScheduleSetting) => {
    setEditingSchedule(schedule);
    setFormData({
      ai_config_id: schedule.ai_config_id,
      wp_config_id: schedule.wp_config_id,
      generation_mode: (schedule as any).generation_mode || 'keyword',
      keyword: schedule.keyword,
      keyword_set_id: (schedule as any).keyword_set_id || '',
      title_set_id: (schedule as any).title_set_id || '',
      post_time: schedule.post_time,
      frequency: schedule.frequency,
      post_status: schedule.post_status,
      start_date: schedule.start_date || '',
      end_date: schedule.end_date || '',
      chatwork_room_id: schedule.chatwork_room_id || '',
      chatwork_message_template: schedule.chatwork_message_template || DEFAULT_CHATWORK_TEMPLATE,
      prompt_set_id: schedule.prompt_set_id || '',
      target_word_count: schedule.target_word_count || 2000,
      writing_tone: schedule.writing_tone || 'professional',
      status: schedule.status,
      enable_fact_check: schedule.enable_fact_check || false,
      fact_check_note: schedule.fact_check_note || '',
    });
    // Scroll to top to show the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このスケジュールを削除しますか？')) return;

    try {
      setLoading(true);
      await scheduleService.deleteSchedule(id);
      toast.success('スケジュールを削除しました');
      await loadSchedules();
    } catch (error) {
      console.error('Failed to delete schedule:', error);
      toast.error('スケジュールの削除に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (schedule: ScheduleSetting) => {
    try {
      await scheduleService.toggleScheduleStatus(schedule.id!);
      toast.success(schedule.status ? 'スケジュールを無効にしました' : 'スケジュールを有効にしました');
      await loadSchedules();
    } catch (error) {
      console.error('Failed to toggle status:', error);
      toast.error('ステータスの変更に失敗しました');
    }
  };

  const handleRunNow = async (scheduleId: string) => {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    if (!confirm(`${schedule.post_time} のスケジュールを今すぐ実行しますか？\n(キーワードの消費と記事生成が行われます)`)) return;

    const loadingToast = toast.loading('スケジューラーを実行中...');
    try {
      const result = await supabaseSchedulerService.triggerScheduler(true, scheduleId);
      console.log('Manual trigger result:', result);

      // 結果の検証
      if (result.results && result.results.length > 0) {
        const executionResult = result.results[0];
        if (!executionResult.success) {
          throw new Error(executionResult.error || '不明なエラーが発生しました');
        }
      }

      toast.success('スケジューラーの実行が完了しました', { id: loadingToast });
      await loadSchedules();
    } catch (error: any) {
      console.error('Failed to trigger scheduler:', error);
      toast.error(`実行に失敗しました: ${error.message}`, { id: loadingToast });
    }
  };

  const resetForm = () => {
    setFormData({
      ai_config_id: '',
      wp_config_id: '',
      generation_mode: 'keyword',
      keyword: '',
      keyword_set_id: '',
      title_set_id: '',
      post_time: '09:00',
      frequency: '毎日',
      post_status: 'publish',
      start_date: '',
      end_date: '',
      chatwork_room_id: '',
      chatwork_message_template: DEFAULT_CHATWORK_TEMPLATE,
      prompt_set_id: '',
      target_word_count: 2000,
      writing_tone: 'professional',
      status: true,
      enable_fact_check: false,
      fact_check_note: '',
    });
    setEditingSchedule(null);
  };

  const getWordPressName = (wpConfigId: string) => {
    const config = wordPressConfigs.find(c => c.id === wpConfigId);
    return config?.name || 'Unknown';
  };

  const getAIName = (aiConfigId: string) => {
    const config = aiConfigs.find(c => c.id === aiConfigId);
    if (!config) return 'Unknown AI';
    const label = config.provider === 'openai' ? 'OpenAI' :
      config.provider === 'claude' ? 'Anthropic Claude' :
        config.provider === 'gemini' ? 'Google Gemini' : config.provider;
    return `${label} (${config.model})`;
  };

  const getPromptSetName = (promptSetId?: string) => {
    if (!promptSetId) return null;
    const ps = promptSets.find(p => p.id === promptSetId);
    return ps ? ps.name : null;
  };

  // フィルタリングされたWordPress設定（アクティブのみ）
  const activeWordPressConfigs = wordPressConfigs.filter(config => config.isActive);

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-2">
          <Calendar className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">自動投稿スケジューラー</h2>
        </div>
        <p className="text-gray-600">
          キーワードまたはタイトルから記事を自動生成・投稿します
        </p>
      </div>

      {/* スケジュール作成フォーム */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {editingSchedule ? 'スケジュールを編集' : '新しいスケジュール'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* AI設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                AI設定 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.ai_config_id}
                onChange={(e) => setFormData({ ...formData, ai_config_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">選択してください</option>
                {aiConfigs.map((config) => {
                  const label = config.provider === 'openai' ? 'OpenAI' :
                    config.provider === 'claude' ? 'Anthropic Claude' :
                      config.provider === 'gemini' ? 'Google Gemini' : config.provider;
                  return (
                    <option key={config.id} value={config.id || ''}>
                      {label} ({config.model}){config.isActive ? ' (アクティブ)' : ''}
                    </option>
                  );
                })}
              </select>
              {aiConfigs.length === 0 && (
                <p className="text-xs text-red-500 mt-1">
                  登録されたAI設定がありません。「AI設定」から設定してください。
                </p>
              )}
            </div>

            {/* WordPress設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                WordPress設定 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.wp_config_id}
                onChange={(e) => setFormData({ ...formData, wp_config_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">選択してください</option>
                {activeWordPressConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name} ({config.url})
                  </option>
                ))}
              </select>
              {activeWordPressConfigs.length === 0 && (
                <p className="text-xs text-red-500 mt-1">
                  有効なWordPress設定がありません。「WordPress設定」から有効化してください。
                </p>
              )}
            </div>
          </div>

          {/* プロンプトセット選択 (Independent Row) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                プロンプトセット（任意）
              </label>
              <button
                type="button"
                onClick={() => setIsPromptManagerOpen(true)}
                className="text-xs text-purple-600 font-bold hover:text-purple-800 flex items-center gap-1"
              >
                <Zap className="w-3 h-3" />
                管理・作成
              </button>
            </div>
            <select
              value={formData.prompt_set_id}
              onChange={(e) => setFormData({ ...formData, prompt_set_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">指定なし（デフォルト設定を使用）</option>
              {promptSets.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              記事生成時に適用するカスタム指示を選択できます
            </p>
          </div>

          {/* 生成モード選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              生成モード <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="generation_mode"
                  value="keyword"
                  checked={formData.generation_mode === 'keyword'}
                  onChange={(e) => setFormData({ ...formData, generation_mode: e.target.value as any })}
                  className="mr-2"
                />
                <span className="text-sm font-medium">キーワードから生成</span>
              </label>
              <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50">
                <input
                  type="radio"
                  name="generation_mode"
                  value="title"
                  checked={formData.generation_mode === 'title'}
                  onChange={(e) => setFormData({ ...formData, generation_mode: e.target.value as any })}
                  className="mr-2"
                />
                <span className="text-sm font-medium">タイトルから生成</span>
              </label>
              <label className="flex items-center px-4 py-2 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 has-[:checked]:border-green-500 has-[:checked]:bg-green-50">
                <input
                  type="radio"
                  name="generation_mode"
                  value="both"
                  checked={formData.generation_mode === 'both'}
                  onChange={(e) => setFormData({ ...formData, generation_mode: e.target.value as any })}
                  className="mr-2"
                />
                <span className="text-sm font-medium">両方使用</span>
              </label>
            </div>
          </div>

          {/* キーワードセット選択 */}
          {(formData.generation_mode === 'keyword' || formData.generation_mode === 'both') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                キーワードセット <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.keyword_set_id}
                onChange={(e) => {
                  const value = e.target.value;
                  const selectedSet = keywordSets.find(s => s.id === value);
                  if (selectedSet) {
                    setFormData({
                      ...formData,
                      keyword_set_id: value,
                      keyword: selectedSet.keywords.join(', ')
                    });
                  } else {
                    setFormData({ ...formData, keyword_set_id: '', keyword: '' });
                  }
                }}
                className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required={formData.generation_mode === 'keyword' || formData.generation_mode === 'both'}
              >
                <option value="">セットを選択してください...</option>
                {keywordSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} ({set.keywords.length}個のキーワード)
                  </option>
                ))}
              </select>
              {formData.keyword && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-xs font-medium text-blue-900 mb-1">選択中のキーワード:</p>
                  <div className="flex flex-wrap gap-1">
                    {formData.keyword.split(',').map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                        {kw.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* タイトルセット選択 */}
          {(formData.generation_mode === 'title' || formData.generation_mode === 'both') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                タイトルセット <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.title_set_id}
                onChange={(e) => {
                  setFormData({ ...formData, title_set_id: e.target.value, selected_title: '' });
                }}
                className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required={formData.generation_mode === 'title' || formData.generation_mode === 'both'}
              >
                <option value="">セットを選択してください...</option>
                {titleSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name} ({set.titles.length}個のタイトル)
                  </option>
                ))}
              </select>
              {formData.title_set_id && (() => {
                const selectedSet = titleSets.find(s => s.id === formData.title_set_id);
                return selectedSet && (
                  <div className="mt-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <p className="text-xs font-medium text-purple-900 mb-1">選択中のタイトル ({selectedSet.titles.length}個):</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {selectedSet.titles.slice(0, 5).map((title, i) => (
                        <div key={i} className="text-xs text-purple-800 bg-purple-100 px-2 py-1 rounded">
                          {title}
                        </div>
                      ))}
                      {selectedSet.titles.length > 5 && (
                        <p className="text-xs text-purple-600 italic">...他 {selectedSet.titles.length - 5}個</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* 個別タイトル選択 */}
              {formData.title_set_id && (() => {
                const selectedSet = titleSets.find(s => s.id === formData.title_set_id);
                return selectedSet && selectedSet.titles.length > 0 && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      使用するタイトルを選択 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.selected_title}
                      onChange={(e) => setFormData({ ...formData, selected_title: e.target.value })}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      required
                    >
                      <option value="">タイトルを選択してください...</option>
                      {selectedSet.titles.map((title, index) => (
                        <option key={index} value={title}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
            </div>
          )}       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 目標文字数 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                目標文字数
              </label>
              <select
                value={formData.target_word_count}
                onChange={(e) => setFormData({ ...formData, target_word_count: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="1000">1000文字 (サクサク読める短編)</option>
                <option value="2000">2000文字 (標準的な記事)</option>
                <option value="3000">3000文字 (しっかり解説)</option>
                <option value="5000">5000文字 (網羅的な長文)</option>
                <option value="10000">10000文字 (超長文・完全版)</option>
              </select>
            </div>

            {/* 文体（トーン） */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                文体（トーン）
              </label>
              <select
                value={formData.writing_tone}
                onChange={(e) => setFormData({ ...formData, writing_tone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="professional">プロフェッショナル</option>
                <option value="casual">カジュアル</option>
                <option value="technical">テクニカル</option>
                <option value="friendly">フレンドリー</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 投稿時刻 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                投稿時刻 <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={formData.post_time}
                onChange={(e) => setFormData({ ...formData, post_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* 頻度 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                投稿頻度 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.frequency}
                onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="毎日">毎日</option>
                <option value="毎週">毎週</option>
                <option value="隔週">隔週</option>
                <option value="毎月">毎月</option>
              </select>
            </div>

            {/* 投稿状態 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                投稿状態 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.post_status}
                onChange={(e) => setFormData({ ...formData, post_status: e.target.value as 'publish' | 'draft' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="publish">公開</option>
                <option value="draft">下書き</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 開始日 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                開始日（任意）
              </label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 終了日 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                終了日（任意）
              </label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* ChatWorkルームID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ChatWorkルームID（任意）
            </label>
            <input
              type="text"
              value={formData.chatwork_room_id}
              onChange={(e) => setFormData({ ...formData, chatwork_room_id: e.target.value })}
              placeholder="例: 123456789"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              ※ 空欄の場合はChatWorkに送信されません。複数送る場合はカンマ(,)で区切ってください
            </p>
          </div>

          {/* ChatWork メッセージテンプレート */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              通知メッセージテンプレート（任意）
            </label>
            <textarea
              value={formData.chatwork_message_template}
              onChange={(e) => setFormData({ ...formData, chatwork_message_template: e.target.value })}
              placeholder="[info][title]記事投稿完了：{title}[/title]URL: {url}[/info]"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              使用可能な変数: {`{title}`} (記事タイトル), {`{url}`} (記事URL), {`{keyword}`} (キーワード), {`{status}`} (投稿状態)
            </p>
          </div>

          {/* ファクトチェック設定 */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center space-x-2 mb-3">
              <input
                type="checkbox"
                id="enable_fact_check"
                checked={formData.enable_fact_check || false}
                onChange={(e) => setFormData({ ...formData, enable_fact_check: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="enable_fact_check" className="text-sm font-medium text-gray-700">
                Perplexityによるファクトチェックを有効化
              </label>
            </div>

            {formData.enable_fact_check && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  優先チェック箇所（任意）
                </label>
                <textarea
                  value={formData.fact_check_note || ''}
                  onChange={(e) => setFormData({ ...formData, fact_check_note: e.target.value })}
                  placeholder="特に確認してほしい情報を [[ ]] で囲んで入力してください。&#10;例: この治療法は [[2023年に厚生労働省が承認]] されました。"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  [[  ]]で囲んだ箇所は優先的にファクトチェックされます
                </p>
              </div>
            )}
          </div>

          {/* スケジュール有効化 */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="status"
              checked={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.checked })}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="status" className="text-sm font-medium text-gray-700">
              スケジュールを有効化
            </label>
          </div>

          {/* ボタン */}
          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '保存中...' : editingSchedule ? 'スケジュールを更新' : 'スケジュールを作成'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              リセット
            </button>
          </div>
        </form>
      </div >

      {/* 登録済みスケジュール一覧 */}
      < div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6" >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">登録済みスケジュール</h3>
          <span className="text-sm text-gray-500">全 {schedules.length} 件</span>
        </div>

        {
          loading && schedules.length === 0 ? (
            <div className="text-center py-8 text-gray-500">読み込み中...</div>
          ) : schedules.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-2">登録済みのスケジュールがありません</p>
              <p className="text-sm text-gray-400">上のボタンから新しいスケジュールを作成してください</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => {
                const keywordsList = schedule.keyword ? schedule.keyword.split(',').map(k => k.trim()).filter(k => k) : [];
                const usedList = schedule.id ? (usedKeywordsMap[schedule.id] || []) : [];
                const promptSetName = getPromptSetName(schedule.prompt_set_id);

                return (
                  <div
                    key={schedule.id}
                    className={`border rounded-xl p-6 shadow-md transition-all ${schedule.status ? 'bg-white border-blue-100 hover:shadow-lg' : 'bg-gray-50 border-gray-200'
                      }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                      <div className="flex flex-col md:flex-row md:items-center md:space-x-6 space-y-4 md:space-y-0 flex-1 min-w-0">

                        {/* Time Block - Fixed width to ensure stability */}
                        {/* WordPress & AI Info - allowing expansion */}
                        <div className="flex flex-wrap gap-4 items-center flex-1 min-w-0">
                          {/* WordPress */}
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm flex-shrink-0">
                              <Globe className="w-5 h-5 text-blue-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">Target Site</div>
                              <div className="text-base font-bold text-gray-900 leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title={getWordPressName(schedule.wp_config_id)}>
                                {getWordPressName(schedule.wp_config_id)}
                              </div>
                            </div>
                          </div>

                          {/* AI Model */}
                          <div className="flex items-center space-x-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm flex-shrink-0">
                              <Tag className="w-5 h-5 text-purple-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">AI Model</div>
                              <div className="text-sm font-bold text-gray-900 leading-tight whitespace-nowrap max-w-[140px] truncate">
                                {getAIName(schedule.ai_config_id).split('(')[0]}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Divider (Desktop) */}
                        <div className="hidden md:block w-px h-12 bg-gray-200"></div>

                        {/* WordPress & AI Info - allowing expansion */}
                        {/* Time Block - Fixed width to ensure stability */}
                        <div className="flex items-center space-x-4 min-w-[200px] flex-shrink-0">
                          <div className={`p-4 rounded-xl shadow-sm ${schedule.status ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            <Clock className="w-8 h-8" />
                          </div>
                          <div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-3xl font-bold text-gray-900 tracking-tight leading-none">
                                {schedule.post_time}
                              </span>
                              <span className="text-sm font-semibold text-gray-500">
                                /{schedule.frequency}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span
                                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded border ${schedule.status
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : 'bg-gray-50 text-gray-500 border-gray-200'
                                  }`}
                              >
                                {schedule.status ? 'Active' : 'Stopped'}
                              </span>
                              <span className="text-xs text-gray-400">
                                {schedule.post_status === 'publish' ? '公開' : '下書き'}
                              </span>
                            </div>
                            {/* Last Execution Time */}
                            {schedule.id && lastExecutionMap[schedule.id] && (
                              <div className="mt-2 flex items-center text-[10px] text-gray-400">
                                <span className="font-bold mr-1">Last Run:</span>
                                <span>{new Date(lastExecutionMap[schedule.id]!).toLocaleString('ja-JP', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Divider (Desktop) removed from here */}

                        {/* Additional Info Block removed from here */}

                      </div>

                      <div className="flex items-center space-x-2 lg:ml-2 border-t lg:border-t-0 lg:border-l border-gray-100 pt-4 lg:pt-0 lg:pl-4 flex-shrink-0">
                        {/* Action Buttons */}
                        <button
                          onClick={() => handleToggleStatus(schedule)}
                          className={`p-2.5 rounded-lg transition-colors border ${schedule.status
                            ? 'text-green-600 border-green-200 hover:bg-green-50'
                            : 'text-gray-400 border-gray-200 hover:bg-gray-100'
                            }`}
                          title={schedule.status ? '無効にする' : '有効にする'}
                        >
                          <Power className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleRunNow(schedule.id!)}
                          disabled={loading}
                          className="p-2.5 text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                          title="今すぐ実行"
                        >
                          <Play className="w-5 h-5 fill-current" />
                        </button>
                        <button
                          onClick={() => handleEdit(schedule)}
                          className="p-2.5 text-gray-500 border border-gray-200 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 rounded-lg transition-colors"
                          title="編集"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDelete(schedule.id!)}
                          className="p-2.5 text-gray-400 border border-gray-200 hover:text-red-600 hover:bg-red-50 hover:border-red-200 rounded-lg transition-colors"
                          title="削除"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Additional Info Block (Moved to bottom) */}
                    {(schedule.start_date || schedule.chatwork_room_id || promptSetName) && (
                      <div className="mb-4 pt-4 border-t border-gray-100 flex flex-wrap gap-6">
                        {schedule.start_date && (
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Start Date:</span>
                            <span className="font-semibold text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">{schedule.start_date}</span>
                          </div>
                        )}
                        {schedule.chatwork_room_id && (
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">ChatWork ID:</span>
                            <span className="font-mono text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded border border-gray-200">{schedule.chatwork_room_id}</span>
                          </div>
                        )}
                        {promptSetName && (
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Prompt Set:</span>
                            <div className="flex items-center space-x-1 text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
                              <MessageSquare className="w-3 h-3" />
                              <span className="font-medium">{promptSetName}</span>
                            </div>
                          </div>
                        )}

                        {/* Tone & Word Count Badge */}
                        <div className="flex items-center space-x-2 text-sm">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tone:</span>
                          <span className="font-mono text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                            {schedule.writing_tone === 'desu_masu' ? 'です・ます' :
                              schedule.writing_tone === 'da_dearu' ? 'だ・である' :
                                schedule.writing_tone === 'friendly' ? '親しみ' :
                                  schedule.writing_tone === 'professional' ? '専門的' : schedule.writing_tone || 'Default'}
                          </span>
                          <span className="font-mono text-xs bg-gray-50 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                            {schedule.target_word_count || 3000}文字
                          </span>
                        </div>

                        {schedule.enable_fact_check && (
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fact Check:</span>
                            <span className="flex items-center space-x-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">
                              <ShieldCheck className="w-3 h-3" />
                              <span className="font-medium">Enabled</span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-gray-700 flex items-center">
                          <Tag className="w-4 h-4 mr-2 text-blue-500" />
                          ターゲットキーワード ({keywordsList.length})
                        </h4>
                        <span className="text-xs text-gray-500">
                          {usedList.length} / {keywordsList.length} 消化済み
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {keywordsList.map((k, i) => {
                          const isUsed = usedList.includes(k);
                          return (
                            <span
                              key={i}
                              className={`
                            px-2.5 py-1 rounded text-xs font-medium transition-colors border select-none
                            ${isUsed
                                  ? 'bg-gray-100 text-gray-400 border-gray-200 decoration-gray-400 line-through'
                                  : 'bg-white text-gray-700 border-blue-200 shadow-sm hover:border-blue-400 hover:text-blue-600'
                                }
                          `}
                              title={isUsed ? '記事作成済み' : '未作成'}
                            >
                              {k}
                            </span>
                          );
                        })}
                        {keywordsList.length === 0 && (
                          <span className="text-sm text-gray-400 italic">キーワードが設定されていません</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      </div >

      <PromptSetManager
        isOpen={isPromptManagerOpen}
        onClose={() => setIsPromptManagerOpen(false)}
        onSelect={(ps) => setFormData(prev => ({ ...prev, prompt_set_id: ps.id }))}
      />
    </div >
  );
};
