import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingUp, Search, Save, Trash2, Sparkles } from 'lucide-react';
import Toast from '../components/Toast';

interface TrendKeyword {
  id: string;
  keyword: string;
  related_keywords: string[];
  source: string;
  created_at: string;
}

export default function TrendAnalysis() {
  const [keyword, setKeyword] = useState('');
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<TrendKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    checkApiKey();
    loadSavedKeywords();
  }, []);

  const checkApiKey = async () => {
    const { data, error } = await supabase
      .from('ai_configs')
      .select('api_key')
      .eq('provider', 'Gemini')
      .maybeSingle();

    setHasApiKey(!error && data && data.api_key);
  };

  const loadSavedKeywords = async () => {
    const { data, error } = await supabase
      .from('trend_keywords')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSavedKeywords(data);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAnalyze = async () => {
    if (!keyword.trim()) {
      showMessage('error', 'キーワードを入力してください');
      return;
    }

    if (!hasApiKey) {
      showMessage('error', 'AI設定でGemini APIキーを登録してください');
      return;
    }

    setAnalyzing(true);
    setRelatedKeywords([]);

    try {
      const { data: aiConfig } = await supabase
        .from('ai_configs')
        .select('api_key, model')
        .eq('provider', 'Gemini')
        .maybeSingle();

      if (!aiConfig) {
        throw new Error('AI設定が見つかりません');
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/gemini-trends`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          keyword: keyword.trim(),
          api_key: aiConfig.api_key,
          model: aiConfig.model,
        }),
      });

      if (!response.ok) {
        throw new Error('トレンド分析に失敗しました');
      }

      const result = await response.json();
      setRelatedKeywords(result.related_keywords || []);
      showMessage('success', `${result.related_keywords?.length || 0}件のキーワードを抽出しました`);
    } catch (error) {
      console.error('分析エラー:', error);
      showMessage('error', 'トレンド分析に失敗しました');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (relatedKeywords.length === 0) {
      showMessage('error', '保存するキーワードがありません');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('trend_keywords')
        .insert({
          keyword: keyword.trim(),
          related_keywords: relatedKeywords,
          source: 'gemini',
        });

      if (error) throw error;

      showMessage('success', 'キーワードを保存しました');
      setKeyword('');
      setRelatedKeywords([]);
      loadSavedKeywords();
    } catch (error) {
      console.error('保存エラー:', error);
      showMessage('error', 'キーワードの保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このキーワードを削除してもよろしいですか？')) return;

    const { error } = await supabase
      .from('trend_keywords')
      .delete()
      .eq('id', id);

    if (error) {
      showMessage('error', '削除に失敗しました');
    } else {
      showMessage('success', 'キーワードを削除しました');
      loadSavedKeywords();
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
        <div className="flex items-center gap-3 mb-2">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-800">トレンド分析</h1>
        </div>
        <p className="text-gray-600">リアルタイムトレンドデータで記事の話題性を最大化</p>
      </div>

      {!hasApiKey && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <div className="flex-shrink-0 w-5 h-5 text-yellow-600 mt-0.5">⚠️</div>
          <div>
            <p className="text-yellow-800 font-medium mb-1">APIキーが未設定です</p>
            <p className="text-yellow-700 text-sm">
              トレンド分析を使用するには、AI設定ページでGemini APIキーを登録してください。
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">キーワード分析</h2>

        <div className="space-y-4">
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
                disabled={analyzing || !hasApiKey}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Search className="w-5 h-5" />
                {analyzing ? '分析中...' : '分析開始'}
              </button>
            </div>
          </div>

          {relatedKeywords.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
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
                  すべて保存
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {relatedKeywords.map((kw, index) => (
                  <div
                    key={index}
                    className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between group hover:bg-blue-100 transition-colors"
                  >
                    <span className="text-gray-800 font-medium">{kw}</span>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-xs px-3 py-1 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                        title="このキーワードで記事を生成（将来実装）"
                      >
                        🧠 AI記事生成
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {savedKeywords.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">保存済みキーワード</h2>

          <div className="space-y-4">
            {savedKeywords.map((item) => (
              <div key={item.id} className="border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-1">{item.keyword}</h3>
                    <p className="text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleString('ja-JP')} • {item.source}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

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
            ))}
          </div>
        </div>
      )}

      {savedKeywords.length === 0 && relatedKeywords.length === 0 && (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <TrendingUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600 mb-2">まだキーワードが登録されていません</p>
          <p className="text-sm text-gray-500">上のフォームからキーワードを入力して分析を開始してください</p>
        </div>
      )}
    </div>
  );
}
