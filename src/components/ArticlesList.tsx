import React, { useState, useEffect } from 'react';
import { FileText, Search, Filter, Calendar, Tag, TrendingUp, Trash2, Edit, Eye, ExternalLink, RefreshCw, Save, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Article } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { articlesService, ArticleFilters, ArticleSortOptions } from '../services/articlesService';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useWordPressPublish } from '../hooks/useWordPressPublish';
import { useWordPressConfig } from '../hooks/useWordPressConfig';
import { Globe, Send, X as CloseIcon, ShieldCheck } from 'lucide-react';
import { FactCheckResult } from '../types/factCheck';
import { factCheckService } from '../services/factCheckService';
import { FactCheckResultsDisplay } from './FactCheckResultsDisplay';

export const ArticlesList: React.FC = () => {
  const { deleteArticle } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [publishedFilter, setPublishedFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'created_at' | 'updated_at' | 'title' | 'seo_score'>('created_at');
  const [sortAscending, setSortAscending] = useState(false);
  const [localArticles, setLocalArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [publishingArticle, setPublishingArticle] = useState<Article | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [publishStatus, setPublishStatus] = useState<'publish' | 'draft' | 'future'>('publish');
  const [scheduledDate, setScheduledDate] = useState<string>('');

  // ファクトチェック用のstate
  const [factCheckResults, setFactCheckResults] = useState<FactCheckResult[]>([]);
  const [isFactChecking, setIsFactChecking] = useState(false);

  // 編集モード用のstate
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<{ title: string; content: string }>({ title: '', content: '' });

  const { publishToWordPress, isPublishing } = useWordPressPublish();
  const { configs } = useWordPressConfig();
  const activeConfigs = configs.filter(c => c.isActive);

  useEffect(() => {
    if (activeConfigs.length > 0 && !selectedConfigId) {
      setSelectedConfigId(activeConfigs[0].id);
    }
  }, [activeConfigs, selectedConfigId]);

  useEffect(() => {
    loadArticles();
  }, [statusFilter, categoryFilter, publishedFilter, sortField, sortAscending, searchTerm]);

  const loadArticles = async () => {
    try {
      setIsLoading(true);

      const filters: ArticleFilters = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (categoryFilter !== 'all') filters.category = categoryFilter;
      if (searchTerm) filters.searchTerm = searchTerm;

      const sortOptions: ArticleSortOptions = {
        field: sortField,
        ascending: sortAscending
      };

      let fetchedArticles = await articlesService.getAllArticles(filters, sortOptions, 100);

      if (publishedFilter !== 'all') {
        fetchedArticles = fetchedArticles.filter(article => {
          if (publishedFilter === 'published') return article.isPublished === true;
          if (publishedFilter === 'unpublished') return article.isPublished !== true;
          return true;
        });
      }

      setLocalArticles(fetchedArticles);
    } catch (error) {
      console.error('記事の読み込みエラー:', error);
      toast.error('記事の読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteArticle = async (id: string, title: string) => {
    if (!confirm(`「${title}」を削除しますか？`)) return;

    try {
      const success = await articlesService.deleteArticle(id);
      if (success) {
        deleteArticle(id);
        setLocalArticles(prev => prev.filter(a => a.id !== id));
        toast.success('記事を削除しました');
      } else {
        toast.error('記事の削除に失敗しました');
      }
    } catch (error) {
      console.error('削除エラー:', error);
      toast.error('削除中にエラーが発生しました');
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-800', label: '下書き' },
      scheduled: { color: 'bg-blue-100 text-blue-800', label: '予約済み' },
      published: { color: 'bg-green-100 text-green-800', label: '公開済み' },
      failed: { color: 'bg-red-100 text-red-800', label: '失敗' }
    };

    const badge = badges[status] || badges.draft;
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  const handleFactCheck = async () => {
    if (!selectedArticle) return;

    setIsFactChecking(true);
    setFactCheckResults([]);

    try {
      const items = factCheckService.extractFacts(selectedArticle.content);
      if (items.length === 0) {
        toast('検証する事実情報が見つかりませんでした', { icon: 'ℹ️' });
        setIsFactChecking(false);
        return;
      }

      const keyword = selectedArticle.keywords && selectedArticle.keywords.length > 0
        ? selectedArticle.keywords[0]
        : selectedArticle.title;

      const results = await factCheckService.verifyFacts(items, keyword);
      setFactCheckResults(results);

      if (results.length > 0) {
        toast.success(`ファクトチェック完了: ${results.length}件を検証しました`);
      } else {
        toast.error('ファクトチェックに失敗したか、検証可能な項目がありませんでした');
      }
    } catch (error) {
      console.error('Fact check error:', error);
      toast.error('ファクトチェック中にエラーが発生しました');
    } finally {
      setIsFactChecking(false);
    }
  };

  const handleStartEdit = () => {
    if (!selectedArticle) return;
    setEditValues({
      title: selectedArticle.title,
      content: selectedArticle.content
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedArticle) return;
    if (!editValues.title.trim() || !editValues.content.trim()) {
      toast.error('タイトルと本文は必須です');
      return;
    }

    try {
      const updatedArticle = await articlesService.updateArticle(selectedArticle.id, {
        title: editValues.title,
        content: editValues.content
      });

      if (updatedArticle) {
        // ローカルの状態を更新
        setLocalArticles(prev => prev.map(a =>
          a.id === selectedArticle.id ? updatedArticle : a
        ));
        setSelectedArticle(updatedArticle);
        setIsEditing(false);
        toast.success('記事を更新しました');
      } else {
        toast.error('記事の更新に失敗しました');
      }
    } catch (error) {
      console.error('更新エラー:', error);
      toast.error('更新中にエラーが発生しました');
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const categories = Array.from(new Set(localArticles.map(a => a.category).filter(Boolean)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-blue-600" />
            記事一覧
          </h2>
          <p className="text-gray-600 mt-1">
            生成された記事の管理と閲覧
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={loadArticles}
            className="btn-secondary flex items-center gap-2"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            更新
          </button>
          <div className="text-sm text-gray-600">
            合計: <span className="font-semibold text-gray-900">{localArticles.length}</span> 件
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="記事を検索..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">すべてのステータス</option>
            <option value="draft">下書き</option>
            <option value="scheduled">予約済み</option>
            <option value="published">公開済み</option>
            <option value="failed">失敗</option>
          </select>

          <select
            value={publishedFilter}
            onChange={(e) => setPublishedFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">すべて</option>
            <option value="published">WordPress投稿済み</option>
            <option value="unpublished">未投稿</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">すべてのカテゴリ</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={`${sortField}-${sortAscending}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortField(field as any);
              setSortAscending(order === 'true');
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="created_at-false">新しい順</option>
            <option value="created_at-true">古い順</option>
            <option value="updated_at-false">更新日（新）</option>
            <option value="title-true">タイトル（A-Z）</option>
          </select>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">記事を読み込み中...</p>
          </div>
        ) : localArticles.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">記事がありません</h3>
            <p className="text-gray-600">AI記事生成から新しい記事を作成してください</p>
          </div>
        ) : (
          <div className="space-y-4">
            {localArticles.map(article => (
              <div
                key={article.id}
                onClick={() => {
                  setSelectedArticle(article);
                  setFactCheckResults([]); // Reset fact check results
                  setIsEditing(false); // Reset editing state when opening
                }}
                className="article-card"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-start gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 flex-1">
                        {article.title}
                      </h3>
                      <div className="flex gap-2">
                        {getStatusBadge(article.status)}
                        {article.isPublished && (
                          <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            WordPress投稿済み
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                      {article.excerpt || article.content.substring(0, 150) + '...'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                      {article.category && (
                        <div className="flex items-center gap-1">
                          <Tag className="w-4 h-4" />
                          <span>{article.category}</span>
                        </div>
                      )}

                      {article.generatedAt && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{format(new Date(article.generatedAt), 'yyyy/MM/dd HH:mm')}</span>
                        </div>
                      )}

                      {article.wordCount !== undefined && (
                        <span>{article.wordCount.toLocaleString()}文字</span>
                      )}

                      {article.isPublished && article.wordPressUrl && (
                        <a
                          href={article.wordPressUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          WordPressで表示
                        </a>
                      )}
                    </div>

                    <div className="flex items-end justify-between mt-4">
                      <div className="flex flex-wrap gap-2">
                        {article.keywords && article.keywords.slice(0, 5).map((keyword, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>

                      {!article.isPublished && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPublishingArticle(article);
                            setPublishStatus('publish');
                            setScheduledDate('');
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm font-bold shadow-sm whitespace-nowrap"
                        >
                          <Globe className="w-4 h-4" />
                          <span>WordPressに投稿</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteArticle(article.id, article.title);
                      }}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {
        selectedArticle && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">記事プレビュー</h3>
                <button
                  onClick={() => setSelectedArticle(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="p-6">
                {isEditing ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">タイトル</label>
                      <input
                        type="text"
                        value={editValues.title}
                        onChange={(e) => setEditValues(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xl font-bold"
                      />
                    </div>
                    <div className="flex justify-end gap-2 mb-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 font-bold"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-bold flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mb-4">
                    <div className="flex items-start justify-between gap-4">
                      <h1 className="text-3xl font-bold text-gray-900 mb-2 flex-1">
                        {selectedArticle.title}
                      </h1>

                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={handleFactCheck}
                          disabled={isFactChecking}
                          className={`p-2.5 rounded-lg transition-all border ${isFactChecking
                            ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-white border-green-200 text-green-600 hover:bg-green-50 hover:border-green-300 hover:shadow-sm'
                            }`}
                          title={isFactChecking ? '確認中...' : 'ファクトチェックを実行'}
                        >
                          <ShieldCheck className={`w-5 h-5 ${isFactChecking ? 'animate-pulse' : ''}`} />
                        </button>
                        <button
                          onClick={handleStartEdit}
                          className="p-2.5 bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-300 rounded-lg hover:shadow-sm transition-all"
                          title="編集"
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      {getStatusBadge(selectedArticle.status)}
                      {selectedArticle.isPublished && (
                        <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                          WordPress投稿済み
                        </span>
                      )}
                      <span>{selectedArticle.category}</span>
                      {selectedArticle.generatedAt && (
                        <span>{format(new Date(selectedArticle.generatedAt), 'yyyy/MM/dd HH:mm')}</span>
                      )}
                      {selectedArticle.isPublished && selectedArticle.wordPressUrl && (
                        <a
                          href={selectedArticle.wordPressUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-4 h-4" />
                          WordPressで表示
                        </a>
                      )}
                    </div>

                    <div className="mt-4">
                      <FactCheckResultsDisplay results={factCheckResults} />
                    </div>
                  </div>
                )}

                {!isEditing && selectedArticle.excerpt && (
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <p className="text-gray-700 italic">{selectedArticle.excerpt}</p>
                  </div>
                )}

                {isEditing ? (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">本文 (Markdown)</label>
                    <textarea
                      value={editValues.content}
                      onChange={(e) => setEditValues(prev => ({ ...prev, content: e.target.value }))}
                      className="w-full h-[60vh] px-4 py-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-base resize-none"
                    />
                  </div>
                ) : (
                  <div className="article-prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedArticle.content}
                    </ReactMarkdown>
                  </div>
                )}

                {selectedArticle.keywords && selectedArticle.keywords.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-2">キーワード:</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedArticle.keywords.map((keyword, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }
      {/* 投稿先選択モーダル */}
      {
        publishingArticle && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-blue-50">
                <h3 className="font-bold text-blue-900 flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  投稿先を選択
                </h3>
                <button
                  onClick={() => setPublishingArticle(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-600">
                  「{publishingArticle.title}」を以下のサイトに投稿します。
                </p>

                {activeConfigs.length > 0 ? (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                      WordPressサイト
                    </label>
                    <select
                      value={selectedConfigId}
                      onChange={(e) => setSelectedConfigId(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {activeConfigs.map(config => (
                        <option key={config.id} value={config.id}>
                          {config.name} ({config.url})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-yellow-800">
                    有効な（アクティブな）WordPress設定がありません。設定画面で有効にしてください。
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                    公開設定
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="publishStatus"
                        value="publish"
                        checked={publishStatus === 'publish'}
                        onChange={(e) => setPublishStatus('publish' as any)}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">今すぐ公開</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="publishStatus"
                        value="draft"
                        checked={publishStatus === 'draft'}
                        onChange={(e) => setPublishStatus('draft' as any)}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">下書き</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="publishStatus"
                        value="future"
                        checked={publishStatus === 'future'}
                        onChange={(e) => setPublishStatus('future' as any)}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">予約投稿</span>
                    </label>
                  </div>
                </div>

                {publishStatus === 'future' && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                      予約日時
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      ※ 過去の日時を指定すると即時公開されます
                    </p>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setPublishingArticle(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  onClick={async () => {
                    if (!selectedConfigId) {
                      toast.error('投稿先を選択してください');
                      return;
                    }
                    if (publishStatus === 'future' && !scheduledDate) {
                      toast.error('予約日時を設定してください');
                      return;
                    }

                    const date = publishStatus === 'future' ? new Date(scheduledDate) : undefined;
                    const success = await publishToWordPress(publishingArticle, selectedConfigId, undefined, publishStatus, date);

                    if (success) {
                      setPublishingArticle(null);
                      loadArticles();
                    }
                  }}
                  disabled={isPublishing || activeConfigs.length === 0}
                  className="btn-primary px-6 py-2 flex items-center gap-2"
                >
                  {isPublishing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      投稿中...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      投稿を実行
                    </>
                  )}
                </button>
              </div>
            </div>
          </div >
        )
      }
    </div >
  );
};
