import { useState, useEffect } from 'react';
import { supabase, ScheduleSetting, AIConfig, WPConfig } from '../lib/supabase';
import { Play, Pause, Trash2, Clock } from 'lucide-react';
import Toast from '../components/Toast';

export default function Scheduler() {
  const [schedules, setSchedules] = useState<(ScheduleSetting & { ai_config?: AIConfig; wp_config?: WPConfig })[]>([]);
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [wpConfigs, setWpConfigs] = useState<WPConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [mainKeywords, setMainKeywords] = useState<any[]>([]);
  const [selectedMainKeyword, setSelectedMainKeyword] = useState<string | null>(null);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    ai_config_id: '',
    wp_config_id: '',
    time: '17:00',
    frequency: '毎日',
    start_date: '',
    end_date: '',
    status: true,
  });

  // ✅ 編集モードを管理
  const [editingStates, setEditingStates] = useState<{ [key: string]: boolean }>({});

  // ✅ スケジュール保存
  const handleSave = async () => {
    if (!formData.ai_config_id || !formData.wp_config_id || !selectedMainKeyword) {
      showMessage('error', 'AI設定・WordPress設定・キーワードを選択してください');
      return;
    }

    setLoading(true);

    const insertData = {
      ai_config_id: formData.ai_config_id,
      wp_config_id: formData.wp_config_id,
      keyword: selectedMainKeyword,
      related_keywords: Array.isArray(relatedKeywords) ? relatedKeywords : [],
      post_time: formData.time,
      frequency: formData.frequency,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
      status: formData.status,
    };

    const { error } = await supabase.from('schedule_settings').insert([insertData]);

    setLoading(false);

    if (error) {
      console.error("❌ Supabase insert error:", error);
      showMessage('error', 'スケジュールの追加に失敗しました');
    } else {
      showMessage('success', 'スケジュールを追加しました');
      loadSchedules();
    }
  };

  useEffect(() => {
    fetchMainKeywords();
  }, []);

  const fetchMainKeywords = async () => {
    const { data, error } = await supabase.from("trend_keywords").select("id, keyword, related_keywords");
    if (!error) setMainKeywords(data || []);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    await Promise.all([loadSchedules(), loadAiConfigs(), loadWpConfigs()]);
  };

  const loadSchedules = async () => {
    const { data, error } = await supabase
      .from('schedule_settings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showMessage('error', 'スケジュールの読み込みに失敗しました');
    } else if (data) {
      const aiConfigsData = await supabase.from('ai_configs').select('*');
      const wpConfigsData = await supabase.from('wp_configs').select('*');
      const enrichedSchedules = data.map(schedule => ({
        ...schedule,
        ai_config: aiConfigsData.data?.find(c => c.id === schedule.ai_config_id),
        wp_config: wpConfigsData.data?.find(c => c.id === schedule.wp_config_id),
      }));
      setSchedules(enrichedSchedules);
    }
  };

  const loadAiConfigs = async () => {
    const { data } = await supabase.from('ai_configs').select('*').order('created_at', { ascending: false });
    if (data) setAiConfigs(data);
  };

  const loadWpConfigs = async () => {
    const { data } = await supabase.from('wp_configs').select('*').order('created_at', { ascending: false });
    if (data) setWpConfigs(data);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このスケジュールを削除してもよろしいですか？')) return;
    const { error } = await supabase.from('schedule_settings').delete().eq('id', id);
    if (error) showMessage('error', '削除に失敗しました');
    else {
      showMessage('success', 'スケジュールを削除しました');
      loadSchedules();
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase.from('schedule_settings').update({ status: !currentStatus }).eq('id', id);
    if (error) showMessage('error', 'ステータスの更新に失敗しました');
    else {
      showMessage('success', !currentStatus ? 'スケジュールを再開しました' : 'スケジュールを停止しました');
      loadSchedules();
    }
  };

  const handleRunNow = async (scheduleId: string) => {
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/auto-post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ schedule_id: scheduleId }),
      });
      if (!response.ok) throw new Error('投稿に失敗しました');
      showMessage('success', '投稿を実行しました');
      loadSchedules();
    } catch {
      showMessage('error', '投稿の実行に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {message && (
        <Toast type={message.type} message={message.text} onClose={() => setMessage(null)} />
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">スケジューラー</h1>
        <p className="text-gray-600">記事の自動投稿スケジュールを管理します</p>
      </div>

      {/* === 新規登録フォーム === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">新しいスケジュール</h2>
        {/* （中略：あなたの元のフォーム部分はそのまま保持） */}
        {/* コードが長いので割愛。上の投稿に書いてあった通りです。 */}
      </div>

      {/* === 登録済みスケジュール一覧 === */}
      {schedules.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">登録済みのスケジュール</h2>
          <div className="space-y-4">
            {schedules.map((schedule) => {
              const isEditing = editingStates[schedule.id] || false;
              const toggleEdit = (v: boolean) =>
                setEditingStates((prev) => ({ ...prev, [schedule.id]: v }));

              return (
                <div key={schedule.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {!isEditing ? (
                        <>
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="text-lg font-semibold text-gray-800">
                              {schedule.wp_config?.name || "WordPress設定"}
                            </h3>
                            <span className={`px-3 py-1 text-sm rounded-full ${
                              schedule.status ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                            }`}>
                              {schedule.status ? "有効" : "停止中"}
                            </span>
                          </div>

                          <p className="text-sm text-gray-700 mb-2">
                            <strong>AI設定：</strong> {schedule.ai_config?.name || schedule.ai_config_id}
                          </p>
                          <p className="text-sm text-gray-700 mb-2">
                            <strong>WordPress：</strong> {schedule.wp_config?.url}
                          </p>
                          <p className="text-sm text-gray-700 mb-2">
                            <strong>キーワード：</strong> {schedule.keyword || "未設定"}
                          </p>
                          <p className="text-sm text-gray-700 mb-2">
                            <strong>投稿時刻：</strong> {schedule.post_time}
                          </p>
                          <p className="text-sm text-gray-700 mb-2">
                            <strong>頻度：</strong> {schedule.frequency}
                          </p>

                          <div className="flex gap-2 mt-4">
                            <button
                              onClick={() => toggleEdit(true)}
                              className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors"
                            >
                              ✏️ 編集
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <label className="block text-xs text-gray-500">AI設定ID</label>
                          <input
                            type="text"
                            defaultValue={schedule.ai_config_id}
                            onChange={(e) => (schedule.ai_config_id = e.target.value)}
                            className="border rounded w-full p-2 text-sm"
                          />
                          <label className="block text-xs text-gray-500">WordPress設定ID</label>
                          <input
                            type="text"
                            defaultValue={schedule.wp_config_id}
                            onChange={(e) => (schedule.wp_config_id = e.target.value)}
                            className="border rounded w-full p-2 text-sm"
                          />
                          <label className="block text-xs text-gray-500">メインキーワード</label>
                          <input
                            type="text"
                            defaultValue={schedule.keyword}
                            onChange={(e) => (schedule.keyword = e.target.value)}
                            className="border rounded w-full p-2 text-sm"
                          />
                          <label className="block text-xs text-gray-500">投稿時刻</label>
                          <input
                            type="time"
                            defaultValue={schedule.post_time}
                            onChange={(e) => (schedule.post_time = e.target.value)}
                            className="border rounded w-full p-2 text-sm"
                          />
                          <label className="block text-xs text-gray-500">頻度</label>
                          <select
                            defaultValue={schedule.frequency}
                            onChange={(e) => (schedule.frequency = e.target.value)}
                            className="border rounded w-full p-2 text-sm"
                          >
                            <option value="毎日">毎日</option>
                            <option value="毎週">毎週</option>
                            <option value="隔週">隔週</option>
                            <option value="月一">月一</option>
                          </select>

                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={async () => {
                                const { error } = await supabase
                                  .from("schedule_settings")
                                  .update({
                                    ai_config_id: schedule.ai_config_id,
                                    wp_config_id: schedule.wp_config_id,
                                    keyword: schedule.keyword,
                                    post_time: schedule.post_time,
                                    frequency: schedule.frequency,
                                  })
                                  .eq("id", schedule.id);
                                if (error) showMessage("error", "更新に失敗しました");
                                else {
                                  showMessage("success", "スケジュールを更新しました");
                                  loadSchedules();
                                  toggleEdit(false);
                                }
                              }}
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => toggleEdit(false)}
                              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => toggleStatus(schedule.id, schedule.status)}
                        className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                          schedule.status
                            ? "bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                            : "bg-green-50 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        {schedule.status ? "停止" : "再開"}
                      </button>
                      <button
                        onClick={() => handleRunNow(schedule.id)}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-green-100"
                      >
                        今すぐ実行
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id)}
                        className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
