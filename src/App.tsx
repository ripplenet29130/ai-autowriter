import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { AIGenerator } from './components/AIGenerator/index';
import { Scheduler } from './components/Scheduler';
import { WordPressConfigComponent } from './components/WordPressConfig/index';
import { AIConfigComponent } from './components/AIConfig';
import { SettingsComponent } from './components/Settings';
import { ArticlesList } from './components/ArticlesList';
import { KeywordSettings } from './components/KeywordSettings';
import { TitleSettings } from './components/TitleSettings';
import { useAppStore } from './store/useAppStore';
import { useAuthStore } from './store/useAuthStore';
import { Login } from './components/Login';
import { AdminDashboard } from './components/AdminDashboard';
import { supabase } from './services/supabaseClient';

function App() {
  const { activeView, loadFromSupabase } = useAppStore();
  const { isLoading, user, profile, account, isAdmin, isClient, loadAuth } = useAuthStore();
  const featureFlags = account?.feature_flags ?? {};
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() =>
    new URLSearchParams(window.location.search).get('auth') === 'recovery' ||
    window.location.hash.includes('type=recovery')
  );

  const unavailableFeature = (
    <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">この機能は現在利用できません</h2>
      <p className="text-gray-600">必要な場合は管理者にお問い合わせください。</p>
    </div>
  );

  useEffect(() => {
    loadAuth().catch(error => {
      console.error('Failed to load auth state:', error);
    });
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isClient && account?.status === 'active') {
      loadFromSupabase().catch(error => {
        console.error('Failed to load from Supabase:', error);
      });
    }
  }, [isClient, account?.id, account?.status]);

  const renderContent = () => {
    try {
      switch (activeView) {
        case 'dashboard':
          return <Dashboard />;
        case 'generator':
          return <AIGenerator />;
        case 'articles':
          return <ArticlesList />;

        case 'scheduler':
          if (featureFlags.scheduler === false) return unavailableFeature;
          return <Scheduler />;
        case 'wordpress':
          if (featureFlags.wordpress_publish === false) return unavailableFeature;
          return <WordPressConfigComponent />;
        case 'ai-config':
          return <AIConfigComponent />;
        case 'keywords':
          return <KeywordSettings />;
        case 'titles':
          return <TitleSettings />;
        case 'settings':
          if (featureFlags.fact_check === false) return unavailableFeature;
          return <SettingsComponent />;
        default:
          return <Dashboard />;
      }
    } catch (error) {
      console.error('Error rendering content:', error);
      return (
        <div className="p-6 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-bold text-red-600 mb-4">繧ｳ繝ｳ繝・Φ繝・・隱ｭ縺ｿ霎ｼ縺ｿ繧ｨ繝ｩ繝ｼ</h2>
            <p className="text-red-700 mb-4">このページの表示中にエラーが発生しました。</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white font-medium px-6 py-2.5 rounded-lg transition-all duration-200"
            >
              繝壹・繧ｸ繧貞・隱ｭ縺ｿ霎ｼ縺ｿ
            </button>
          </div>
        </div>
      );
    }
  };

  try {
    if (isLoading) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-4 text-gray-600">
            読み込み中です
          </div>
        </div>
      );
    }

    if (isPasswordRecovery) {
      return (
        <Router>
          <Login initialMode="update-password" onPasswordUpdated={() => setIsPasswordRecovery(false)} />
          <Toaster position="top-right" />
        </Router>
      );
    }

    if (!user) {
      return (
        <Router>
          <Login />
          <Toaster position="top-right" />
        </Router>
      );
    }

    if (!profile) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-md w-full text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-3">アカウント設定が未完了です</h1>
            <p className="text-gray-600">
              管理者に連絡して、このユーザーに権限を設定してください。
            </p>
          </div>
        </div>
      );
    }

    if (isAdmin) {
      return (
        <Router>
          <AdminDashboard />
          <Toaster position="top-right" />
        </Router>
      );
    }

    if (!isClient || !account) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-md w-full text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-3">利用できないアカウントです</h1>
            <p className="text-gray-600">
              clientアカウントの紐づけを確認してください。
            </p>
          </div>
        </div>
      );
    }

    if (account.status !== 'active') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-md w-full text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-3">現在利用停止中です</h1>
            <p className="text-gray-600">
              利用再開については管理者にお問い合わせください。
            </p>
          </div>
        </div>
      );
    }

    return (
      <Router>
        <div className="App min-h-screen bg-gray-50">
          <Layout>
            {renderContent()}
          </Layout>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#363636',
                color: '#fff',
              },
              success: {
                style: {
                  background: '#10B981',
                },
              },
              error: {
                style: {
                  background: '#EF4444',
                },
              },
            }}
          />
        </div>
      </Router>
    );
  } catch (error) {
    console.error('App render error:', error);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">繧｢繝励Μ繧ｱ繝ｼ繧ｷ繝ｧ繝ｳ繧ｨ繝ｩ繝ｼ</h1>
          <p className="text-gray-600 mb-6">アプリケーションの読み込み中にエラーが発生しました。</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition-all duration-200"
          >
            繝壹・繧ｸ繧貞・隱ｭ縺ｿ霎ｼ縺ｿ
          </button>
        </div>
      </div>
    );
  }
}

export default App;


