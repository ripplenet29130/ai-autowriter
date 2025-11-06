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
      const wpConfig = wpConfigs.find(w => w.id === selectedWpConfigId);
      if (!wpConfig) throw new Error('WordPress設定が見つかりません');

      const authHeader = 'Basic ' + btoa(`${wpConfig.username}:${wpConfig.app_password}`);

      const response = await fetch(`${wpConfig.url}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          title: generatedArticle.title,
          content: generatedArticle.content,
          status: 'publish',
          categories: wpConfig.default_category ? [parseInt(wpConfig.default_category)] : [],
        }),
      });

      if (!response.ok) throw new Error('WordPressへの投稿に失敗しました');

      showMessage('success', 'WordPressに投稿しました');
      setGeneratedArticle(null);
    } catch (error) {
      console.error('WordPress投稿エラー:', error);
      showMessage('error', error instanceof Error ? error.message : 'WordPressへの投稿に失敗しました');
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

      {/* …中略：既存のJSX部分はそのままでOK（最後まで同じ） … */}
    </div>
  );
}
