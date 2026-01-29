import React, { useState, useEffect } from 'react';
import { Calendar, Globe, Clock, Tag, Trash2, Edit2, Power, MessageSquare, Zap } from 'lucide-react';
import { scheduleService } from '../services/scheduleService';
import { ScheduleSetting } from '../types';
import { useAppStore } from '../store/useAppStore';
import { PromptSetManager } from './AIGenerator/PromptSetManager';
import toast from 'react-hot-toast';

export const Scheduler: React.FC = () => {
  const { aiConfigs, wordPressConfigs, keywordSets, promptSets, loadKeywordSets, loadPromptSets } = useAppStore();
  const [schedules, setSchedules] = useState<ScheduleSetting[]>([]);
  const [usedKeywordsMap, setUsedKeywordsMap] = useState<Record<string, string[]>>({});

  const [loading, setLoading] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleSetting | null>(null);
  const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    ai_config_id: '',
    wp_config_id: '',
    keyword: '',
    post_time: '09:00',
    frequency: '毎日',
    post_status: 'publish' as 'publish' | 'draft',
    start_date: '',
    end_date: '',
    chatwork_room_id: '',
    prompt_set_id: '',
    status: true,
  });

  // Load schedules and keyword sets on mount
  useEffect(() => {
    loadSchedules();
    loadKeywordSets();
    loadPromptSets();
  }, []);


  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await scheduleService.getSchedules();
      setSchedules(data);

      // Fetch used keywords for each schedule
      const keywordsMap: Record<string, string[]> = {};
      await Promise.all(data.map(async (schedule) => {
        if (schedule.id) {
          const used = await scheduleService.getUsedKeywords(schedule.id);
          keywordsMap[schedule.id] = used;
        }
      }));
      setUsedKeywordsMap(keywordsMap);

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
    if (!formData.keyword.trim()) {
      toast.error('キーワードを入力してください');
      return;
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
      keyword: schedule.keyword,
      post_time: schedule.post_time,
      frequency: schedule.frequency,
      post_status: schedule.post_status,
      start_date: schedule.start_date || '',
      end_date: schedule.end_date || '',
      chatwork_room_id: schedule.chatwork_room_id || '',
      prompt_set_id: schedule.prompt_set_id || '',
      status: schedule.status,
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

  const resetForm = () => {
    setFormData({
      ai_config_id: '',
      wp_config_id: '',
      keyword: '',
      post_time: '09:00',
      frequency: '毎日',
      post_status: 'publish',
      start_date: '',
      end_date: '',
      chatwork_room_id: '',
      prompt_set_id: '',
      status: true,
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
          <h2 className="text-2xl font-bold text-gray-900">キーワードベース自動投稿スケジューラー</h2>
        </div>
        <p className="text-gray-600">
          設定されたキーワードから毎回トレンド分析を行い、最適なタイトルで記事を自動生成・投稿します
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

          {/* キーワードセット選択 (Independent Row) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              キーワードセット <span className="text-red-500">*</span>
            </label>
            <select
              value={(() => {
                const matched = keywordSets.find(s => s.keywords.join(', ') === formData.keyword);
                if (matched) return matched.id;
                if (formData.keyword) return 'custom';
                return '';
              })()}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'custom') return; // Keep current value

                const selectedSet = keywordSets.find(s => s.id === value);
                if (selectedSet) {
                  setFormData({ ...formData, keyword: selectedSet.keywords.join(', ') });
                } else {
                  setFormData({ ...formData, keyword: '' });
                }
              }}
              className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">セットを選択してください...</option>
              {/* Show custom option if current keyword doesn't match any set */}
              {formData.keyword && !keywordSets.find(s => s.keywords.join(', ') === formData.keyword) && (
                <option value="custom">カスタム設定 (現在の値: {formData.keyword.length > 20 ? formData.keyword.substring(0, 20) + '...' : formData.keyword})</option>
              )}
              {keywordSets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name} ({set.keywords.length}個のキーワード)
                </option>
              ))}
            </select>
            {formData.keyword && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100 flex flex-wrap gap-1.5">
                {formData.keyword.split(', ').map((k, i) => (
                  <span key={i} className="px-2 py-0.5 bg-white border border-gray-200 text-gray-600 rounded text-xs">
                    {k}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              「キーワード設定」で作成したセットの中から投稿に使用するものを選択してください
            </p>
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
              ※ 空欄の場合はChatWorkに送信されません
            </p>
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
      </div>

      {/* 登録済みスケジュール一覧 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">登録済みスケジュール</h3>
          <span className="text-sm text-gray-500">全 {schedules.length} 件</span>
        </div>

        {loading && schedules.length === 0 ? (
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
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:space-x-8 space-y-4 md:space-y-0 flex-1">

                      {/* Time Block - Fixed width to ensure stability */}
                      {/* WordPress & AI Info - allowing expansion */}
                      <div className="flex flex-wrap gap-6 items-center flex-1">
                        {/* WordPress */}
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm">
                            <Globe className="w-5 h-5 text-blue-500" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">Target Site</div>
                            <div className="text-base font-bold text-gray-900 leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-[220px]" title={getWordPressName(schedule.wp_config_id)}>
                              {getWordPressName(schedule.wp_config_id)}
                            </div>
                          </div>
                        </div>

                        {/* AI Model */}
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm">
                            <Tag className="w-5 h-5 text-purple-500" />
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">AI Model</div>
                            <div className="text-sm font-bold text-gray-900 leading-tight whitespace-nowrap max-w-[150px] truncate">
                              {getAIName(schedule.ai_config_id).split('(')[0]}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Divider (Desktop) */}
                      <div className="hidden md:block w-px h-12 bg-gray-200"></div>

                      {/* WordPress & AI Info - allowing expansion */}
                      {/* Time Block - Fixed width to ensure stability */}
                      <div className="flex items-center space-x-4 min-w-[200px]">
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
                        </div>
                      </div>

                      {/* Divider (Desktop) removed from here */}

                      {/* Additional Info Block removed from here */}

                    </div>

                    <div className="flex items-center space-x-2 lg:ml-4 border-t lg:border-t-0 lg:border-l border-gray-100 pt-4 lg:pt-0 lg:pl-6">
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
      </div>

      <PromptSetManager
        isOpen={isPromptManagerOpen}
        onClose={() => setIsPromptManagerOpen(false)}
        onSelect={(ps) => setFormData(prev => ({ ...prev, prompt_set_id: ps.id }))}
      />
    </div >
  );
};
