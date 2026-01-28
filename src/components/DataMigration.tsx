import React, { useState, useEffect } from 'react';
import { Database, Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { articlesService } from '../services/articlesService';
import { Article } from '../types';
import toast from 'react-hot-toast';

export const DataMigration: React.FC = () => {
  const [localStorageArticles, setLocalStorageArticles] = useState<Article[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationComplete, setMigrationComplete] = useState(false);
  const [migrationStats, setMigrationStats] = useState({ success: 0, failed: 0 });

  useEffect(() => {
    checkLocalStorageArticles();
  }, []);

  const checkLocalStorageArticles = () => {
    try {
      const stored = localStorage.getItem('ai-wordpress-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        const articles = parsed?.state?.articles || [];

        if (articles.length > 0) {
          setLocalStorageArticles(articles);
          console.log(`Found ${articles.length} articles in localStorage`);
        }
      }
    } catch (error) {
      console.error('Error reading localStorage:', error);
    }
  };

  const handleMigration = async () => {
    if (localStorageArticles.length === 0) {
      toast.error('移行する記事がありません');
      return;
    }

    if (!confirm(`${localStorageArticles.length}件の記事をSupabaseに移行しますか？`)) {
      return;
    }

    setIsMigrating(true);
    let success = 0;
    let failed = 0;

    for (const article of localStorageArticles) {
      try {
        const existing = await articlesService.getArticle(article.id);

        if (!existing) {
          await articlesService.createArticle({
            id: article.id,
            title: article.title,
            content: article.content,
            excerpt: article.excerpt || '',
            keywords: article.keywords || [],
            category: article.category || '',
            status: article.status || 'draft',
            tone: article.tone,
            length: article.length,
            aiProvider: article.aiProvider,
            aiModel: article.aiModel,
            scheduledAt: article.scheduledAt,
            publishedAt: article.publishedAt,
            wordPressPostId: article.wordPressPostId,
            wordPressConfigId: article.wordPressConfigId,
            isPublished: article.isPublished || false,
            wordPressUrl: article.wordPressUrl,
            seoScore: article.seoScore,
            readingTime: article.readingTime,
            wordCount: article.wordCount,
            trendData: article.trendData
          });
          success++;
          console.log(`✓ Migrated: ${article.title}`);
        } else {
          console.log(`⊘ Skipped (exists): ${article.title}`);
        }
      } catch (error) {
        console.error(`✗ Failed to migrate: ${article.title}`, error);
        failed++;
      }
    }

    setMigrationStats({ success, failed });
    setMigrationComplete(true);
    setIsMigrating(false);

    if (success > 0) {
      toast.success(`${success}件の記事を移行しました`);
    }
    if (failed > 0) {
      toast.error(`${failed}件の記事の移行に失敗しました`);
    }
  };

  if (localStorageArticles.length === 0 && !migrationComplete) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-green-900">移行不要</h4>
            <p className="text-sm text-green-700 mt-1">
              ローカルストレージに移行が必要な記事はありません
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (migrationComplete) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-blue-900">移行完了</h4>
            <p className="text-sm text-blue-700 mt-1">
              成功: {migrationStats.success}件 / 失敗: {migrationStats.failed}件
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 btn-primary text-sm"
            >
              ページを更新して確認
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-yellow-900">データ移行が必要です</h4>
          <p className="text-sm text-yellow-700 mt-1">
            ローカルストレージに{localStorageArticles.length}件の記事が見つかりました。
            これらの記事をSupabaseデータベースに移行することをお勧めします。
          </p>
          <button
            onClick={handleMigration}
            disabled={isMigrating}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isMigrating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                移行中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Supabaseに移行する
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
