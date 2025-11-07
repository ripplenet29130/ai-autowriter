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

  // ✅ 編集モードを管理するstate（全カード共通）
  const [editingStates, setEditingStates] = useState<{ [key: string]: boolean }>({});

  // ✅ 新規スケジュール登録
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

  // 🔄 初期データ読み込み
  useEffect(() => {
    loadData();
    fetchMainKeywords();
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

  const fetchMainKeywords = async () => {
    const { data } = await supabase.from("trend_keywords").select("id, keyword, related_keywords");
    if (data) setMainKeywords(data);
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

  // ==============================
  // 🧩 メイン JSX
  // ==============================
  return (
    <div>
      {message && (
        <Toast type={message.type} message={message.text} onClose={() => setMessage(null)} />
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">スケジューラー</h1>
        <p className="text-gray-600">記事の自動投稿スケジュールを管理します</p>
      </div>

      {/* === 登録済みスケジュール一覧 === */}
      {schedules.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">登録済みのスケジュール</h2>
          <div className="space-y-4">
            {schedules.map((schedule) => {
              const isEditing = editingStates[schedule.id] || false;
              const toggleEdit = (value: boolean) => {
                setEditingStates((prev) => ({ ...prev, [schedule.id]: value }));
              };

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
                              schedule.status
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-600"
                            }`}>
                              {schedule.status ? "有効" : "停止中"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                            <div>
                              <p className="font-medium text-gray-700 mb-1">AI設定</p>
                              <p>{schedule.ai_config?.name || `${schedule.ai_config?.provider}`}</p>
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 mb-1">WordPress</p>
                              <p>{schedule.wp_config?.url}</p>
                            </div>

                            <div className="col-span-2">
                              <p className="font-medium text-gray-700 mb-1">メインキーワード</p>
                              <p>{schedule.keyword || "未設定"}</p>
                            </div>

                            {schedule.related_keywords?.length > 0 && (
                              <div className="col-span-2">
                                <p className="font-medium text-gray-700 mb-1">関連ワード</p>
                                <div className="flex flex-wrap gap-2">
                                  {schedule.related_keywords.slice(0, 5).map((w, i) => (
                                    <span key={i} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                                      {w}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div>
                              <p className="font-medium text-gray-700 mb-1">投稿時刻</p>
                              <p className="flex items-center gap-1">🕒 {schedule.post_time}</p>
                            </div>

                            <div>
                              <p className="font-medium text-gray-700 mb-1">頻度</p>
                              <p>{schedule.frequency}</p>
                            </div>
                          </div>

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
                        // === 編集モード ===
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">AI設定ID</label>
                            <input
                              type="text"
                              defaultValue={schedule.ai_config_id}
                              onChange={(e) => (schedule.ai_config_id = e.target.value)}
                              className="border rounded w-full p-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">WordPress設定ID</label>
                            <input
                              type="text"
                              defaultValue={schedule.wp_config_id}
                              onChange={(e) => (schedule.wp_config_id = e.target.value)}
                              className="border rounded w-full p-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">メインキーワード</label>
                            <input
                              type="text"
                              defaultValue={schedule.keyword}
                              onChange={(e) => (schedule.keyword = e.target.value)}
                              className="border rounded w-full p-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">投稿時刻</label>
                            <input
                              type="time"
                              defaultValue={schedule.post_time}
                              onChange={(e) => (schedule.post_time = e.target.value)}
                              className="border rounded w-full p-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">頻度</label>
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
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">開始日</label>
                              <input
                                type="date"
                                defaultValue={schedule.start_date || ""}
                                onChange={(e) => (schedule.start_date = e.target.value)}
                                className="border rounded w-full p-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">終了日</label>
                              <input
                                type="date"
                                defaultValue={schedule.end_date || ""}
                                onChange={(e) => (schedule.end_date = e.target.value)}
                                className="border rounded w-full p-2 text-sm"
                              />
                            </div>
                          </div>

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
                                    start_date: schedule.start_date,
                                    end_date: schedule.end_date,
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

                    {/* 右側ボタン群 */}
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
