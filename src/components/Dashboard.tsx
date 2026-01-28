import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  FileText,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  Bot,
  ExternalLink
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { articlesService } from '../services/articlesService';
import { Article } from '../types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

export const Dashboard: React.FC = () => {
  const { isGenerating } = useAppStore();
  const [stats, setStats] = useState({
    totalArticles: 0,
    publishedToday: 0,
    draftArticles: 0,
    wordPressPublished: 0
  });
  const [recentArticles, setRecentArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSupabaseStats();
  }, []);

  const loadSupabaseStats = async () => {
    try {
      setIsLoading(true);

      const allArticles = await articlesService.getAllArticles(undefined, { field: 'created_at', ascending: false }, 100);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const publishedToday = allArticles.filter(article =>
        article.publishedAt && new Date(article.publishedAt) >= today
      ).length;

      const draftArticles = allArticles.filter(article =>
        article.status === 'draft'
      ).length;

      const wordPressPublished = allArticles.filter(article =>
        article.isPublished === true
      ).length;

      setStats({
        totalArticles: allArticles.length,
        publishedToday,
        draftArticles,
        wordPressPublished
      });

      setRecentArticles(allArticles.slice(0, 5));
    } catch (error) {
      console.error('Supabase統計取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'text-green-600 bg-green-100';
      case 'scheduled': return 'text-blue-600 bg-blue-100';
      case 'draft': return 'text-yellow-600 bg-yellow-100';
      case 'failed': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'published': return '投稿済み';
      case 'scheduled': return '予約投稿';
      case 'draft': return '下書き';
      case 'failed': return '投稿失敗';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">総記事数</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalArticles}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">今日の投稿</p>
              <p className="text-3xl font-bold text-green-600">{stats.publishedToday}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">下書き</p>
              <p className="text-3xl font-bold text-yellow-600">{stats.draftArticles}</p>
            </div>
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">WordPress投稿済み</p>
              <p className="text-3xl font-bold text-blue-600">{stats.wordPressPublished}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">システム状態</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Bot className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">AI記事生成</span>
              </div>
              <div className="flex items-center space-x-2">
                {isGenerating ? (
                  <>
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                    <span className="text-sm text-yellow-600">実行中</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm text-green-600">待機中</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Calendar className="w-5 h-5 text-purple-600" />
                <span className="text-sm font-medium text-gray-700">自動スケジューラー</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-green-600">有効</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">次回実行予定</span>
              </div>
              <span className="text-sm text-gray-600">明日 09:00</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">WordPress統計</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">総記事数</span>
              <span className="text-sm text-gray-600">{stats.totalArticles}記事</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">公開済み</span>
              <span className="text-sm text-green-600">{stats.totalArticles - stats.draftArticles}記事</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">下書き</span>
              <span className="text-sm text-yellow-600">{stats.draftArticles}記事</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">WordPress投稿済み</span>
              <span className="text-sm text-blue-600">{stats.wordPressPublished}記事</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Articles */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">最近の記事</h3>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">読み込み中...</p>
            </div>
          ) : recentArticles.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">記事がまだありません</p>
              <p className="text-sm text-gray-400">AI生成で最初の記事を作成しましょう</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentArticles.map((article) => (
                <div key={article.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900 mb-1">{article.title}</h4>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      {article.generatedAt && (
                        <span>{format(new Date(article.generatedAt), 'yyyy/MM/dd HH:mm', { locale: ja })}</span>
                      )}
                      <span>{article.category}</span>
                      {article.isPublished && article.wordPressUrl && (
                        <a
                          href={article.wordPressUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          WordPressで表示
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {article.isPublished && (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        WordPress投稿済み
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      article.status === 'published' ? 'text-green-600 bg-green-100' :
                      article.status === 'draft' ? 'text-yellow-600 bg-yellow-100' :
                      article.status === 'scheduled' ? 'text-blue-600 bg-blue-100' :
                      article.status === 'failed' ? 'text-red-600 bg-red-100' :
                      'text-gray-600 bg-gray-100'
                    }`}>
                      {article.status === 'published' ? '公開済み' :
                       article.status === 'draft' ? '下書き' :
                       article.status === 'scheduled' ? '予約済み' :
                       article.status === 'failed' ? '失敗' : article.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};