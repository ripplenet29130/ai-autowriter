import { BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { AIGenerator } from './components/AIGenerator/index';
import { TrendAnalysis } from './components/TrendAnalysis/index';
import { Scheduler } from './components/Scheduler';
import { WordPressConfigComponent } from './components/WordPressConfig/index';
import { AIConfigComponent } from './components/AIConfig';
import { SettingsComponent } from './components/Settings';
import { ArticlesList } from './components/ArticlesList';
import { KeywordSettings } from './components/KeywordSettings';
import { useAppStore } from './store/useAppStore';

function App() {
  const { activeView, loadFromSupabase } = useAppStore();

  useEffect(() => {
    loadFromSupabase().catch(error => {
      console.error('Failed to load from Supabase:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderContent = () => {
    try {
      switch (activeView) {
        case 'dashboard':
          return <Dashboard />;
        case 'generator':
          return <AIGenerator />;
        case 'articles':
          return <ArticlesList />;
        case 'trends':
          return <TrendAnalysis />;
        case 'scheduler':
          return <Scheduler />;
        case 'wordpress':
          return <WordPressConfigComponent />;
        case 'ai-config':
          return <AIConfigComponent />;
        case 'keywords':
          return <KeywordSettings />;
        case 'settings':
          return <SettingsComponent />;
        default:
          return <Dashboard />;
      }
    } catch (error) {
      console.error('Error rendering content:', error);
      return (
        <div className="p-6 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-bold text-red-600 mb-4">コンテンツの読み込みエラー</h2>
            <p className="text-red-700 mb-4">このページの表示中にエラーが発生しました。</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white font-medium px-6 py-2.5 rounded-lg transition-all duration-200"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      );
    }
  };

  try {
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
          <h1 className="text-2xl font-bold text-red-600 mb-4">アプリケーションエラー</h1>
          <p className="text-gray-600 mb-6">アプリケーションの読み込み中にエラーが発生しました。</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition-all duration-200"
          >
            ページを再読み込み
          </button>
        </div>
      </div>
    );
  }
}

export default App;
