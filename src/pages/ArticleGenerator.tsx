import { useState, useEffect } from 'react';
import { supabase, AIConfig, WPConfig } from '../lib/supabase';
import { FileText, Sparkles, Send, Loader } from 'lucide-react';
import Toast from '../components/Toast';

interface TrendKeyword {
  id: string;
  keyword: string;
  related_keywords: string[];
  source: string;
}

interface GeneratedArticle {
  title: string;
  content: string;
  keyword: string;
}

export default function ArticleGenerator() {
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [wpConfigs, setWpConfigs] = useState<WPConfig[]>([]);
  const [trendKeywords, setTrendKeywords] = useState<TrendKeyword[]>([]);

  const [selectedAiConfigId, setSelectedAiConfigId] = useState('');
  const [selectedWpConfigId, setSelectedWpConfigId] = useState('');
  const [selectedKeywordId, setSelectedKeywordId] = useState('');

  const [generatedArticle, setGeneratedArticle] = useState<GeneratedArticle | null>(null);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    const [aiResult, wpResult, keywordsResult] = await Promise.all([
      supabase.from('ai_configs').select('*').order('created_at', { ascending: false }),
      supabase.from('wp_configs').select('*').order('created_at', { ascending: false }),
      supabase.from('trend_keywords').select('*').order('created_at', { ascending: false }),
    ]);

    if (aiResult.data && aiResult.data.length > 0) {
      setAiConfigs(aiResult.data);
      setSelectedAiConfigId(aiResult.data[0].id);
    }

    if (wpResult.data && wpResult.data.length > 0) {
      setWpConfigs(wpResult.data);
      const activeWp = wpResult.data.find(w => w.is_active) || wpResult.data[0];
      setSelectedWpConfigId(activeWp.id);
    }

    if (keywordsResult.data && keywordsResult.data.length > 0) {
      setTrendKeywords(keywordsResult.data);
      setSelectedKeywordId(keywordsResult.data[0].id);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  /**
   * ✅ 記事生成ボタン押下時の処理
   * 現時点ではAI接続を行わず、サンプル記事を生成して表示します。
   */
  const handleGenerateArticle = async () => {
    if (!selectedAiConfigId || !selectedKeywordId) {
      showMessage('error', 'AI設定とキーワードを選択してください');
      return;
    }

    setGenerating(true);
    setGeneratedArticle(null);

    try {
      // 選択キーワードを取得
      const selectedKeyword = trendKeywords.find(k => k.id === selectedKeywordId);

      // 仮のサンプル記事を生成
      const sampleTitle = selectedKeyword
        ? `${selectedKeyword.keyword} の最新トレンドを徹底解説`
        : 'サンプル記事タイトル';

      const sampleBody = `
<h2>導入：${selectedKeyword?.keyword} の注目度が高まる理由</h2>
<p>近年、${selectedKeyword?.keyword} に関する検索が急増しています。この記事では、その背景と最新の動向をわかりやすく解説します。</p>

<h2>主要な関連トピック</h2>
<p>${selectedKeyword?.related_keywords?.slice(0, 3).join('、') || '関連キーワード'} に注目が集まっています。これらのテーマがどのように影響し合うのかを整理してみましょう。</p>

<h2>まとめ：次の一歩を踏み出すために</h2>
<p>${selectedKeyword?.keyword} の情報は日々進化しています。最新情報をキャッチし、自分に合ったアクションを取ることが大切です。</p>
`;

      const sampleArticle: GeneratedArticle = {
        title: sampleTitle,
        content: sampleBody,
        keyword: selectedKeyword?.keyword || 'サンプルキーワード',
      };

      // 記事を画面に反映
      setGeneratedArticle(sampleArticle);
      showMessage('success', 'サンプル記事を生成しました');
    } catch (error) {
      console.error('サンプル生成エラー:', error);
      showMessage('error', '記事生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  };

  /**
   * ✅ WordPress投稿処理（そのまま）
   * 現状ではAI出力をそのまま投稿できます。
   */
  const handlePostToWordPress = async () => {
  if (!generatedArticle || !selectedWpConfigId) {
    showMessage('error', '記事とWordPress設定を確認してください');
    return;
  }

  setPosting(true);

  try {
    const wpConfig = wpConfigs.find((w) => w.id === selectedWpConfigId);
    if (!wpConfig) throw new Error('WordPress設定が見つかりません');

    // ✅ URL整形
    const wpUrl = wpConfig.url.replace(/\/$/, '');

    // ✅ Basic認証
    const authHeader = 'Basic ' + btoa(`${wpConfig.username}:${wpConfig.app_password}`);

    // ✅ Gutenberg対応＋カテゴリ型安全
const payload: any = {
  title: generatedArticle.title,
  content: {
    raw: generatedArticle.content,
  },
  status: 'publish',
};

// ✅ カテゴリ処理の修正版（確実に整数化）
if (wpConfig.default_category) {
  const catId = Number(wpConfig.default_category);
  if (!isNaN(catId)) {
    payload.categories = [catId];
  } else {
    console.warn('⚠ default_category が整数ではありません:', wpConfig.default_category);
  }
}


    const response = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('WordPress投稿エラー詳細:', errorText);
      throw new Error('WordPressへの投稿に失敗しました');
    }

    const postData = await response.json();
    const postedUrl = postData.link || `${wpUrl}/?p=${postData.id}`;

    // ✅ Supabaseへ保存
    const { error: saveError } = await supabase.from('articles').insert({
      ai_config_id: selectedAiConfigId,
      wp_config_id: selectedWpConfigId,
      keyword: generatedArticle.keyword,
      title: generatedArticle.title,
      content: generatedArticle.content,
      wp_url: postedUrl,
    });

    if (saveError) console.error('記事履歴の保存エラー:', saveError);

    showMessage('success', `WordPressに投稿しました: ${postedUrl}`);
    setGeneratedArticle(null);
  } catch (error) {
    console.error('WordPress投稿エラー:', error);
    showMessage(
      'error',
      error instanceof Error ? error.message : 'WordPress投稿に失敗しました'
    );
  } finally {
    setPosting(false);
  }
};

  const selectedAiConfig = aiConfigs.find(c => c.id === selectedAiConfigId);
  const selectedKeyword = trendKeywords.find(k => k.id === selectedKeywordId);

  // === JSX部は変更不要 ===
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
        <FileText className="w-8 h-8 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-800">記事生成</h1>
      </div>
      <p className="text-gray-600">
        AI × トレンドキーワードで自動記事生成・WordPress投稿
      </p>
    </div>

    {(aiConfigs.length === 0 || wpConfigs.length === 0 || trendKeywords.length === 0) && (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 flex items-start gap-3">
        <div className="flex-shrink-0 w-5 h-5 text-yellow-600 mt-0.5">⚠️</div>
        <div>
          <p className="text-yellow-800 font-medium mb-1">
            必要な設定が不足しています
          </p>
          <ul className="text-yellow-700 text-sm list-disc ml-4">
            {aiConfigs.length === 0 && <li>AI設定を登録してください</li>}
            {wpConfigs.length === 0 && <li>WordPress設定を登録してください</li>}
            {trendKeywords.length === 0 && <li>トレンド分析でキーワードを保存してください</li>}
          </ul>
        </div>
      </div>
    )}

    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">記事生成設定</h2>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            AI設定
          </label>
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
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            WordPress設定
          </label>
          <select
            value={selectedWpConfigId}
            onChange={(e) => setSelectedWpConfigId(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={wpConfigs.length === 0}
          >
            {wpConfigs.map((config) => (
              <option key={config.id} value={config.id}>
                {config.name} ({config.url})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            キーワード
          </label>
          <select
            value={selectedKeywordId}
            onChange={(e) => setSelectedKeywordId(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={trendKeywords.length === 0}
          >
            {trendKeywords.map((keyword) => (
              <option key={keyword.id} value={keyword.id}>
                {keyword.keyword} ({keyword.related_keywords.length}件の関連ワード)
              </option>
            ))}
          </select>

          {selectedKeyword && selectedKeyword.related_keywords.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedKeyword.related_keywords.slice(0, 5).map((kw, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full"
                >
                  {kw}
                </span>
              ))}
              {selectedKeyword.related_keywords.length > 5 && (
                <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                  +{selectedKeyword.related_keywords.length - 5}件
                </span>
              )}
            </div>
          )}
        </div>

        {selectedAiConfig && (
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              現在のAI設定
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 mb-1">トーン</p>
                <p className="font-medium text-gray-800">{selectedAiConfig.tone}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 mb-1">スタイル</p>
                <p className="font-medium text-gray-800">{selectedAiConfig.style}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-gray-500 mb-1">ボリューム</p>
                <p className="font-medium text-gray-800">
                  {selectedAiConfig.article_length}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <button
            onClick={handleGenerateArticle}
            disabled={generating || aiConfigs.length === 0 || trendKeywords.length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                記事生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>

    {generatedArticle && (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800">生成結果プレビュー</h2>
          <button
            onClick={handlePostToWordPress}
            disabled={posting || !selectedWpConfigId}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {posting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                投稿中...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                WordPressに投稿
              </>
            )}
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-bold text-gray-800 mb-4">
              {generatedArticle.title}
            </h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
                キーワード: {generatedArticle.keyword}
              </span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <div
              className="prose max-w-none text-gray-700"
              dangerouslySetInnerHTML={{ __html: generatedArticle.content }}
            />
          </div>
        </div>
      </div>
    )}

    {!generatedArticle && !generating && (
      <div className="bg-gray-50 rounded-lg p-12 text-center">
        <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-600 mb-2">まだ記事が生成されていません</p>
        <p className="text-sm text-gray-500">
          上のフォームから設定を選択して記事を生成してください
        </p>
      </div>
    )}
  </div>
);
}
