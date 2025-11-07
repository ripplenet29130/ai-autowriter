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
    start_date: '',   // ← 開始日
    end_date: '',     // ← 終了日
    status: true,
  });

  // 👇 ココに置く（Scheduler関数の中に定義されていることを確認）
  const handleSave = async () => {
    if (
      !formData.ai_config_id ||
      !formData.wp_config_id ||
      !selectedMainKeyword
    ) {
      showMessage('error', 'AI設定・WordPress設定・キーワードを選択してください');
      return;
    }

    setLoading(true);

    const { error } = await supabase.from('schedule_settings').insert([
      {
        ai_config_id: formData.ai_config_id,
        wp_config_id: formData.wp_config_id,
        keyword: selectedMainKeyword, // ← 選択中のメインキーワード
        post_time: formData.time,
        frequency: formData.frequency,
        enabled: formData.status,
      },
    ]);

    setLoading(false);

    if (error) {
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
  const { data, error } = await supabase
    .from("trend_keywords")
    .select("id, keyword, related_keywords");
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
    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setAiConfigs(data);
      if (data.length > 0 && !formData.ai_config_id) {
        setFormData(prev => ({ ...prev, ai_config_id: data[0].id }));
      }
    }
  };

  const loadWpConfigs = async () => {
    const { data, error } = await supabase
      .from('wp_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setWpConfigs(data);
      if (data.length > 0 && !formData.wp_config_id) {
        setFormData(prev => ({ ...prev, wp_config_id: data[0].id }));
      }
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

 

  const handleDelete = async (id: string) => {
    if (!confirm('このスケジュールを削除してもよろしいですか？')) return;

    const { error } = await supabase
      .from('schedule_settings')
      .delete()
      .eq('id', id);

    if (error) {
      showMessage('error', '削除に失敗しました');
    } else {
      showMessage('success', 'スケジュールを削除しました');
      loadSchedules();
    }
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('schedule_settings')
      .update({ status: !currentStatus })
      .eq('id', id);

    if (error) {
      showMessage('error', 'ステータスの更新に失敗しました');
    } else {
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

      if (!response.ok) {
        throw new Error('投稿に失敗しました');
      }

      const result = await response.json();
      showMessage('success', '投稿を実行しました');
      loadSchedules();
    } catch (error) {
      showMessage('error', '投稿の実行に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {message && (
        <Toast
          type={message.type}
          message={message.text}
          onClose={() => setMessage(null)}
        />
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">スケジューラー</h1>
        <p className="text-gray-600">記事の自動投稿スケジュールを管理します</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">新しいスケジュール</h2>

        {aiConfigs.length === 0 || wpConfigs.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800">
              スケジュールを作成する前に、AI設定とWordPress設定を登録してください。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI設定
              </label>
              <select
                value={formData.ai_config_id}
                onChange={(e) => setFormData({ ...formData, ai_config_id: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {aiConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name || `${config.provider} - ${config.model}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                WordPress設定
              </label>
              <select
                value={formData.wp_config_id}
                onChange={(e) => setFormData({ ...formData, wp_config_id: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {wpConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name} ({config.url})
                  </option>
                ))}
              </select>
            </div>

         {/* メインキーワード選択 */}
<div className="mt-4">
  <label className="block text-sm font-medium text-gray-700">キーワード設定</label>
  <select
    className="mt-1 block w-full border border-gray-300 rounded-md p-2"
    value={selectedMainKeyword || ""}
    onChange={(e) => {
      const selected = e.target.value;
      setSelectedMainKeyword(selected);
      const found = mainKeywords.find((k) => k.keyword === selected);
      // JSONB 配列を直接使える
      setRelatedKeywords(found?.related_keywords || []);
    }}
  >
    <option hidden value="">キーワードを選択</option> {/* ← 初期値 */}
    {mainKeywords.map((k) => (
      <option key={k.id} value={k.keyword}>
        {k.keyword}（{k.related_keywords?.length || 0}件の関連ワード）
      </option>
    ))}
  </select>
</div>

{/* 関連ワード表示 */}
{relatedKeywords.length > 0 && (
  <div className="mt-3">
    <p className="text-sm text-gray-600 mb-1">関連ワード</p>
    <div className="flex flex-wrap gap-2">
      {relatedKeywords.map((word: string, index: number) => (
        <span
          key={index}
          className="bg-blue-100 text-blue-800 text-sm px-3 py-1 rounded-full"
        >
          {word}
        </span>
      ))}
    </div>
  </div>
)}


            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  投稿時刻
                </label>
                <input
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
  <label className="block text-sm font-medium text-gray-700 mb-2">
    投稿頻度
  </label>
  <select
    value={formData.frequency}
    onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  >
    <option value="毎日">毎日</option>
    <option value="毎週">毎週</option>
    <option value="隔週">隔週</option>
    <option value="月一">月一</option>
  </select>
</div>
<div className="grid grid-cols-2 gap-6">
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">
      サイクル開始日
    </label>
    <input
      type="date"
      value={formData.start_date}
      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    />
  </div>

  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">
      サイクル終了日
    </label>
    <input
      type="date"
      value={formData.end_date}
      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    />
  </div>
</div>

            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="status"
                checked={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="status" className="text-sm font-medium text-gray-700">
                スケジュールを有効化
              </label>
            </div>

            <div className="flex gap-4 pt-4">
              <button
  onClick={handleSave}
  disabled={loading}
  className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
>
  スケジュールを追加
</button>

            </div>
          </div>
        )}
      </div>

      {schedules.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">登録済みのスケジュール</h2>
          <div className="space-y-4">
            {schedules.map((schedule) => (
              <div key={schedule.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold text-gray-800">
                        {schedule.wp_config?.name || 'WordPress設定'}
                      </h3>
                      <span className={`px-3 py-1 text-sm rounded-full ${
                        schedule.status
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {schedule.status ? '有効' : '停止中'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                      <div>
                        <p className="font-medium text-gray-700 mb-1">AI設定</p>
                        <p>{schedule.ai_config?.name || `${schedule.ai_config?.provider} - ${schedule.ai_config?.model}`}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 mb-1">WordPress</p>
                        <p>{schedule.wp_config?.url}</p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 mb-1">投稿時刻</p>
                        <p className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {schedule.time}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-700 mb-1">頻度</p>
                        <p>{schedule.frequency}</p>
                      </div>
                    </div>

                    {schedule.last_run_at && (
                      <p className="text-xs text-gray-400 mt-3">
                        最終実行: {new Date(schedule.last_run_at).toLocaleString('ja-JP')}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleStatus(schedule.id, schedule.status)}
                      className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                        schedule.status
                          ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                          : 'bg-green-50 text-green-700 hover:bg-green-100'
                      }`}
                    >
                      {schedule.status ? (
                        <>
                          <Pause className="w-4 h-4" />
                          停止
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          再開
                        </>
                      )}
                    </button>
                    {/* 今すぐ実行ボタン */}

                    <button
  onClick={async () => {
    setLoading(true); // ← 投稿中フラグON
    showMessage("success", "🕒 投稿を実行中です..."); // ← 即座に表示

    try {
      const res = await fetch("/.netlify/functions/post-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule_id: schedule.id }),
      });

      const data = await res.json();

      if (res.ok) {
        showMessage("success", "✅ 投稿が完了しました！");
      } else {
        showMessage("error", `❌ 投稿エラー: ${data.error || "不明なエラーです"}`);
      }
    } catch (err) {
      console.error(err);
      showMessage("error", "⚠️ 実行中にエラーが発生しました。");
    } finally {
      setLoading(false); // ← 投稿完了後に解除
    }
  }}
  disabled={loading}
  className={`px-4 py-2 border border-gray-300 rounded-lg transition-colors ${
    loading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-green-100"
  }`}
>
  {loading ? "投稿中..." : "今すぐ実行"}
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
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">最近の実行ログ</h3>
        <p className="text-sm text-gray-600">実行ログ機能は準備中です。将来のバージョンで追加予定です。</p>
      </div>
    </div>
  );
}
