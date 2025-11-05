import { useState, useEffect } from 'react';
import { supabase, AIConfig } from '../lib/supabase';
import { TrendingUp, Search, Save, Trash2, Sparkles, Brain, Globe } from 'lucide-react';
import Toast from '../components/Toast';

interface TrendKeyword {
  id: string;
  keyword: string;
  related_keywords: string[];
  ai_config_id?: string;
  rising_keywords?: string[];
  source: string;
  created_at: string;
}

interface GoogleTrendData {
  timeline: { time: string; value: number }[];
  rising: string[];
  trend_score: any;
}

export default function TrendAnalysis() {
  const [keyword, setKeyword] = useState('');
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [selectedAiConfigId, setSelectedAiConfigId] = useState('');
  const [activeTab, setActiveTab] = useState<'ai' | 'google'>('ai');

  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [googleTrendData, setGoogleTrendData] = useState<GoogleTrendData | null>(null);
  const [savedKeywords, setSavedKeywords] = useState<TrendKeyword[]>([]);
  
  const [googleTrends, setGoogleTrends] = useState<any[]>([]);

  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadAiConfigs();
    loadSavedKeywords();
  }, []);

  // ✅ Supabaseからトレンドデータを取得
useEffect(() => {
  const loadTrends = async () => {
    const { data, error } = await supabase
      .from("trend_keywords")
      .select("keyword, trend_score, rising_keywords, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (!error && data) {
      setGoogleTrends(data);
    } else {
      console.error("トレンドデータ取得エラー:", error?.message);
    }
  };

  loadTrends();
}, []);


  /** 🔹 AI設定一覧を読み込み */
  const loadAiConfigs = async () => {
    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      setAiConfigs(data);
      const activeConfig = data.find((c) => c.provider === 'Gemini') || data[0];
      setSelectedAiConfigId(activeConfig.id);
    }
  };

  /** 🔹 保存済みキーワードを読み込み */
  const loadSavedKeywords = async () => {
    const { data, error } = await supabase
      .from('trend_keywords')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) setSavedKeywords(data);
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /** 🔹 AI分析 */
  const handleAnalyzeAI = async () => {
    if (!keyword.trim()) return showMessage('error', 'キーワードを入力してください');
    if (!selectedAiConfigId) return showMessage('error', 'AI設定を選択してください');

    setAnalyzing(true);
    setRelatedKeywords([]);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // ✅ 修正版：Netlify Functionsを直接呼ぶ
      const response = await fetch("/.netlify/functions/ai-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      keyword: keyword.trim(),
      ai_config_id: selectedAiConfigId,
      }),
    });

      if (!response.ok) throw new Error('AI分析に失敗しました');

      const result = await response.json();
      setRelatedKeywords(result.related_keywords || []);
      showMessage('success', `${result.related_keywords?.length || 0}件のキーワードを抽出しました`);
    } catch (error) {
      console.error('AI分析エラー:', error);
      showMessage('error', 'AI分析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  /** 🔹 Googleトレンド分析 */
  const handleAnalyzeGoogle = async () => {
    if (!keyword.trim()) return showMessage('error', 'キーワードを入力してください');

    setAnalyzing(true);
    setGoogleTrendData(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/google-trends`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          keyword: keyword.trim(),
          timeRange: 'now 7-d',
          geo: 'JP',
        }),
      });

      if (!response.ok) throw new Error('Googleトレンド分析に失敗しました');

      const result = await response.json();
      setGoogleTrendData({
        timeline: result.timeline,
        rising: result.rising,
        trend_score: result.trend_score,
      });
      showMessage('success', 'Googleトレンドデータを取得しました');
    } catch (error) {
      console.error('Googleトレンド分析エラー:', error);
      showMessage('error', 'Googleトレンド分析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  /** 🔹 タブ切り替え */
  const handleAnalyze = () => (activeTab === 'ai' ? handleAnalyzeAI() : handleAnalyzeGoogle());

  /** 🔹 保存 */

const handleSave = async () => {
  if (relatedKeywords.length === 0) {
    showMessage("error", "保存するデータがありません");
    return;
  }

  setLoading(true);

  try {
    const keywordTrimmed = keyword.trim();
    if (!keywordTrimmed) {
      showMessage("error", "キーワードを入力してください");
      setLoading(false);
      return;
    }

    const saveData = {
      keyword: keywordTrimmed,
      related_keywords: relatedKeywords,
      ai_config_id: selectedAiConfigId,
      source: "ai",
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("trend_keywords")
      .insert(saveData)
      .select();

    // ✅ Supabaseでは「errorがnull」なら成功扱いでOK
    if (error) {
      console.error("Supabase保存エラー:", error.message);
      showMessage("error", "キーワードの保存に失敗しました");
      return;
    }

    // ✅ dataが空でも成功（returning: minimalの場合あり）
    showMessage("success", "キーワードを保存しました 🎉");

    // 保存後にGoogleトレンド分析を非同期で実行
    fetch(`${import.meta.env.VITE_NETLIFY_BASE_URL}/.netlify/functions/google-trends`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: keywordTrimmed }),
    }).catch((err) => {
      console.warn("Googleトレンド分析呼び出しエラー（非致命）:", err);
    });

    // 入力と状態をリセット
    setKeyword("");
    setRelatedKeywords([]);
    setGoogleTrendData(null);
  } catch (e) {
    console.error("保存処理中に例外発生:", e);
    // ❌ ここは“実際の例外”のみを捕捉
    showMessage("error", "保存中に予期せぬエラーが発生しました");
  } finally {
    setLoading(false);
  }
};



  /** 🔹 削除 */
  const handleDelete = async (id: string) => {
    if (!confirm('このキーワードを削除してもよろしいですか？')) return;

    const { error } = await supabase.from('trend_keywords').delete().eq('id', id);
    if (error) return showMessage('error', '削除に失敗しました');

    showMessage('success', 'キーワードを削除しました');
    loadSavedKeywords();
  };

  const selectedAiConfig = aiConfigs.find((c) => c.id === selectedAiConfigId);

  return (
    <div>
      {message && (
        <Toast type={message.type} message={message.text} onClose={() => setMessage(null)} />
      )}

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-800">トレンド分析</h1>
        </div>
        <p className="text-gray-600">
          AI × Googleトレンドでデータドリブンなキーワード戦略を構築
        </p>
      </div>

      {aiConfigs.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <div className="flex-shrink-0 text-yellow-600 mt-0.5">⚠️</div>
          <div>
            <p className="text-yellow-800 font-medium mb-1">AI設定が未登録です</p>
            <p className="text-yellow-700 text-sm">
              トレンド分析を使用するには、AI設定ページでGemini APIキーを登録してください。
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">キーワード分析</h2>

        <div className="space-y-6">
          {/* 🔸 AI設定セレクト */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">AI設定</label>
            <select
              value={selectedAiConfigId}
              onChange={(e) => setSelectedAiConfigId(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={aiConfigs.length === 0}
            >
              {aiConfigs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name || `${config.provider} - ${config.model}`}
                </option>
              ))}
            </select>
            {selectedAiConfig && (
              <p className="text-xs text-gray-500 mt-1">
                Temperature: {selectedAiConfig.temperature}, Max Tokens:{' '}
                {selectedAiConfig.max_tokens}
              </p>
            )}
          </div>

          {/* 🔸 キーワード入力 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              分析したいキーワード
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAnalyze()}
                placeholder="例: AGA治療"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={analyzing}
              />
              <button
                onClick={handleAnalyze}
                disabled={analyzing || aiConfigs.length === 0}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Search className="w-5 h-5" />
                {analyzing ? '分析中...' : '分析開始'}
              </button>
            </div>
          </div>

          {/* 🔸 タブ */}
          <div className="border-b border-gray-200">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('ai')}
                className={`px-4 py-3 font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === 'ai'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Brain className="w-5 h-5" />
                AI分析結果
              </button>
              <button
                onClick={() => setActiveTab('google')}
                className={`px-4 py-3 font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === 'google'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Globe className="w-5 h-5" />
                Googleトレンド
              </button>
            </div>
          </div>


          {/* 🔸 AI結果 */}
          {activeTab === 'ai' && relatedKeywords.length > 0 && (
            <div className="mt-6 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  AIが提案する関連キーワード
                </h3>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  保存
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {relatedKeywords.map((kw, index) => (
                  <div
                    key={index}
                    className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between"
                  >
                    <span className="text-gray-800 font-medium">{kw}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 🔸 Google結果 */}
          {activeTab === 'google' && (
  <div className="mt-6 pt-6">
    {googleTrends.length === 0 ? (
      <p className="text-gray-500">まだトレンドデータがありません。</p>
    ) : (
      googleTrends.map((trend, index) => (
        <div
          key={index}
          className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm"
        >
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {trend.keyword}
          </h3>

          {trend.trend_score?.timeline && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">人気度推移</p>
              <div className="space-y-2">
                {trend.trend_score.timeline.map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20">{item.time}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-blue-600 h-4 rounded-full"
                        style={{ width: `${item.value}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-700">{item.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                平均スコア: {trend.trend_score.average}
              </p>
            </div>
          )}

          {trend.rising_keywords?.length > 0 && (
            <div>
              <p className="text-sm text-gray-600 mb-2">上昇キーワード</p>
              <div className="flex flex-wrap gap-2">
                {trend.rising_keywords.slice(0, 10).map((kw: string, i: number) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-green-50 border border-green-200 rounded-full text-sm text-green-800"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))
    )}
  </div>
)}
            


      {/* 🔸 保存済みキーワード一覧 */}
      {savedKeywords.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">保存済みキーワード</h2>

          <div className="space-y-4">
            {savedKeywords.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-gray-800">{item.keyword}</h3>
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                        {item.source}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {item.related_keywords?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">AI提案キーワード</p>
                    <div className="flex flex-wrap gap-2">
                      {item.related_keywords.map((kw, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm border border-gray-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {item.rising_keywords && item.rising_keywords.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">上昇トレンド</p>
                    <div className="flex flex-wrap gap-2">
                      {item.rising_keywords.slice(0, 5).map((kw, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm border border-green-200"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🔸 初期表示メッセージ */}
      {savedKeywords.length === 0 &&
        relatedKeywords.length === 0 &&
        !googleTrendData && (
          <div className="bg-gray-50 rounded-lg p-12 text-center">
            <TrendingUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">まだキーワードが登録されていません</p>
            <p className="text-sm text-gray-500">
              上のフォームからキーワードを入力して分析を開始してください
            </p>
          </div>
        )}
    </div>
  );
}

// ===== 追加ここから（TrendAnalysis.tsx に追記） =====
const handleAnalyzeGoogleAfterSave = async (kw: string) => {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/google-trends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        keyword: kw,
        timeRange: 'now 7-d', // 直近7日間
        geo: 'JP',
      }),
    });

    if (!response.ok) throw new Error('Googleトレンド分析に失敗しました');

    const result = await response.json();

    // trend_keywords にトレンド情報を追記更新（keyword で対象行を特定）
    const { error } = await supabase
      .from('trend_keywords')
      .update({
        trend_score: result.trend_score,
        rising_keywords: result.rising,
        source: 'hybrid', // AI保存+Google追記の意
      })
      .eq('keyword', kw);

    if (error) throw error;

    // 画面にも即反映
    await loadSavedKeywords();
    setGoogleTrendData({
      timeline: result.timeline,
      rising: result.rising,
      trend_score: result.trend_score,
    });

    // 自動で「Googleトレンド」タブに切り替えたい場合は下行をON
    setActiveTab('google');

    showMessage('success', 'Googleトレンドを自動分析して保存しました');
  } catch (err) {
    console.error('Googleトレンド自動分析エラー:', err);
    showMessage('error', 'Googleトレンドの自動分析に失敗しました');
  }
};

