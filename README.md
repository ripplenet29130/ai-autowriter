import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Play, Pause, Settings, Zap, FileText, Filter, Globe, RefreshCw, Edit, TrendingUp, Lightbulb, Target, Users, Bug, Trash2, Hash, X } from 'lucide-react';
import { schedulerService } from '../services/schedulerService';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';

export const Scheduler: React.FC = () => {
  const { articles = [], isGenerating, aiConfig, wordPressConfigs = [], updateWordPressConfig } = useAppStore();
  const [isSchedulerActive, setIsSchedulerActive] = useState(false);
  const [testGeneration, setTestGeneration] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [detailedStatus, setDetailedStatus] = useState<any>(null);
  const [testKeywords, setTestKeywords] = useState<string[]>([]);
  const [testKeywordInput, setTestKeywordInput] = useState('');

  const publishedToday = (articles || []).filter(article => 
    article.publishedAt && 
    new Date(article.publishedAt).toDateString() === new Date().toDateString()
  );

  const activeConfigs = (wordPressConfigs || []).filter(config => 
    config.scheduleSettings?.isActive && 
    Array.isArray(config.scheduleSettings.targetKeywords) && 
    config.scheduleSettings.targetKeywords.length > 0
  );

  // Check scheduler status on component mount and periodically
  useEffect(() => {
    const checkStatus = () => {
      try {
        const status = schedulerService.getSchedulerStatus();
        setSchedulerStatus(status);
        setIsSchedulerActive(status.isRunning);
        
        if (debugMode) {
          const detailed = schedulerService.getDetailedStatus();
          setDetailedStatus(detailed);
        }
      } catch (error) {
        console.error('Scheduler status check error:', error);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [debugMode]);

  // Auto-start scheduler if there are active configs
  useEffect(() => {
    if (activeConfigs.length > 0 && !isSchedulerActive && aiConfig) {
      console.log('アクティブな設定が見つかりました。スケジューラーを自動開始します...');
      handleStartScheduler();
    }
  }, [activeConfigs.length, aiConfig]);

  const handleAddTestKeyword = () => {
    if (testKeywordInput.trim() && !testKeywords.includes(testKeywordInput.trim())) {
      setTestKeywords(prev => [...prev, testKeywordInput.trim()]);
      setTestKeywordInput('');
    }
  };

  const handleRemoveTestKeyword = (keyword: string) => {
    setTestKeywords(prev => prev.filter(k => k !== keyword));
  };

  const handleStartScheduler = () => {
    if (!aiConfig) {
      toast.error('AI設定を完了してください');
      return;
    }
    
    if (activeConfigs.length === 0) {
      toast.error('少なくとも1つのWordPress設定でスケジュールを有効にしてください');
      return;
    }

    try {
      schedulerService.start();
      setIsSchedulerActive(true);
      toast.success(`自動投稿を開始しました（${activeConfigs.length}個のWordPress設定）`);
      
      // Save scheduler state
      localStorage.setItem('schedulerWasRunning', 'true');
    } catch (error) {
      toast.error('スケジューラーの開始に失敗しました');
    }
  };

  const handleStopScheduler = () => {
    schedulerService.stop();
    setIsSchedulerActive(false);
    toast.success('自動投稿を停止しました');
    
    // Clear scheduler state
    localStorage.removeItem('schedulerWasRunning');
  };

  const handleTestGeneration = async () => {
    if (!aiConfig) {
      toast.error('AI設定を完了してください');
      return;
    }
    
    const activeWordPress = (wordPressConfigs || []).find(config => config.isActive);
    if (!activeWordPress) {
      toast.error('アクティブなWordPress設定を選択してください');
      return;
    }

    if (testKeywords.length === 0) {
      toast.error('テスト用のキーワードを追加してください');
      return;
    }

    try {
      setTestGeneration(true);
      toast.loading('テスト記事を生成・投稿中...', { duration: 5000 });
      
      await schedulerService.testDailyGeneration(testKeywords);
      toast.success('テスト記事の生成・投稿が完了しました');
    } catch (error) {
      toast.error('テスト生成に失敗しました');
    } finally {
      setTestGeneration(false);
    }
  };

  const toggleConfigSchedule = (configId: string) => {
    const config = (wordPressConfigs || []).find(c => c.id === configId);
    if (!config?.scheduleSettings) return;

    const newIsActive = !config.scheduleSettings.isActive;
    
    updateWordPressConfig(configId, {
      scheduleSettings: {
        ...config.scheduleSettings,
        isActive: newIsActive
      }
    });

    // Restart the specific config scheduler
    schedulerService.restartConfigScheduler(configId);

    toast.success(
      newIsActive 
        ? `${config.name}のスケジュールを有効にしました` 
        : `${config.name}のスケジュールを無効にしました`
    );

    // If this was the last active config and scheduler is running, stop it
    if (!newIsActive && activeConfigs.length === 1 && isSchedulerActive) {
      handleStopScheduler();
    }
    // If this is the first active config and scheduler is not running, start it
    else if (newIsActive && activeConfigs.length === 0 && !isSchedulerActive && aiConfig) {
      setTimeout(() => handleStartScheduler(), 100); // Small delay to ensure state is updated
    }
  };

  const handleRefreshStatus = () => {
    try {
      const status = schedulerService.getSchedulerStatus();
      setSchedulerStatus(status);
      setIsSchedulerActive(status.isRunning);
      
      if (debugMode) {
        const detailed = schedulerService.getDetailedStatus();
        setDetailedStatus(detailed);
      }
      
      toast.success('スケジューラー状態を更新しました');
    } catch (error) {
      console.error('Status refresh error:', error);
      toast.error('状態更新に失敗しました');
    }
  };

  const handleClearExecutionHistory = () => {
    if (window.confirm('実行履歴をクリアしますか？これにより、すべてのスケジュールが再実行される可能性があります。')) {
      schedulerService.clearExecutionHistory();
      toast.success('実行履歴をクリアしました');
      handleRefreshStatus();
    }
  };

  const handleManualTrigger = async () => {
    if (window.confirm('手動で自動投稿を実行しますか？')) {
      try {
        await schedulerService.manualTriggerExecution();
        toast.success('手動実行を開始しました');
      } catch (error) {
        toast.error('手動実行に失敗しました');
      }
    }
  };

  const formatNextExecutionTime = (configId: string, scheduleSettings: any) => {
    if (!schedulerStatus?.lastExecutionTimes) return '未実行';
    
    const lastExecution = schedulerStatus.lastExecutionTimes[configId];
    if (!lastExecution) return '未実行';
    
    const [hours, minutes] = scheduleSettings.time.split(':').map(Number);
    let nextExecution = new Date();
    nextExecution.setHours(hours, minutes, 0, 0);
    
    // Calculate next execution based on frequency
    if (scheduleSettings.frequency === 'daily') {
      nextExecution.setDate(nextExecution.getDate() + 1);
    } else if (scheduleSettings.frequency === 'weekly') {
      nextExecution.setDate(nextExecution.getDate() + 7);
    } else if (scheduleSettings.frequency === 'monthly') {
      nextExecution.setMonth(nextExecution.getMonth() + 1);
    }
    
    return nextExecution.toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPublishStatusText = (publishStatus: string) => {
    return publishStatus === 'publish' ? '公開' : '下書き';
  };

  const getPublishStatusColor = (publishStatus: string) => {
    return publishStatus === 'publish' ? 'text-green-600' : 'text-blue-600';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Calendar className="w-8 h-8 text-purple-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">キーワードベース自動投稿スケジューラー</h2>
            <p className="text-gray-600">設定されたキーワードから毎回トレンド分析を行い、最適なタイトルで記事を自動生成・投稿します</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setDebugMode(!debugMode)}
            className={`btn-secondary flex items-center space-x-2 ${debugMode ? 'bg-orange-100 text-orange-700' : ''}`}
          >
            <Bug className="w-4 h-4" />
            <span>デバッグ</span>
          </button>
          
          <button
            onClick={handleRefreshStatus}
            className="btn-secondary flex items-center space-x-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>状態更新</span>
          </button>
        </div>
      </div>

      {/* Debug Panel */}
      {debugMode && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-orange-900 mb-4 flex items-center space-x-2">
            <Bug className="w-5 h-5" />
            <span>デバッグ情報</span>
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <button
              onClick={handleClearExecutionHistory}
              className="btn-secondary flex items-center justify-center space-x-2 text-red-600 border-red-300 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>実行履歴クリア</span>
            </button>
            
            <button
              onClick={handleManualTrigger}
              className="btn-secondary flex items-center justify-center space-x-2 text-blue-600 border-blue-300 hover:bg-blue-50"
            >
              <Zap className="w-4 h-4" />
              <span>手動実行</span>
            </button>
            
            <button
              onClick={() => console.log('Detailed Status:', schedulerService.getDetailedStatus())}
              className="btn-secondary flex items-center justify-center space-x-2"
            >
              <FileText className="w-4 h-4" />
              <span>ログ出力</span>
            </button>
          </div>
          
          {detailedStatus && (
            <div className="bg-white rounded-lg p-4 border border-orange-200">
              <h4 className="font-semibold text-gray-900 mb-2">詳細ステータス</h4>
              <pre className="text-xs text-gray-600 overflow-auto max-h-40">
                {JSON.stringify(detailedStatus, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">スケジューラー状態</p>
              <p className={`text-2xl font-bold ${isSchedulerActive ? 'text-green-600' : 'text-gray-400'}`}>
                {isSchedulerActive ? 'アクティブ' : '停止中'}
      {/* WordPress Configurations */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">WordPress設定別スケジュール</h3>
          <p className="text-gray-600 text-sm mt-1">各WordPress設定で個別にキーワードベース自動投稿を管理できます</p>
        </div>
        
        <div className="p-6">
          {(wordPressConfigs || []).length === 0 ? (
            <div className="text-center py-8">
              <Globe className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">WordPress設定がありません</p>
              <p className="text-sm text-gray-400">WordPress設定ページで設定を追加してください</p>
            </div>
          ) : (
            <div className="space-y-4">
              {(wordPressConfigs || []).map((config) => {
                const usedKeywordsCount = detailedStatus?.configs?.find((c: any) => c.id === config.id)?.usedKeywordsCount || 0;
                const totalKeywordsCount = Array.isArray(config.scheduleSettings?.targetKeywords) 
                  ? config.scheduleSettings.targetKeywords.length 
                  : 0;
                
                return (
                  <div
                    key={config.id}
                    className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                      config.scheduleSettings?.isActive
                        ? 'border-green-500 bg-green-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
      {/* Global Scheduler Control */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">グローバル制御</h3>
          
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">ブラウザベーススケジューラー</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">AI設定</span>
                  <span className={`text-sm ${aiConfig ? 'text-green-600' : 'text-red-600'}`}>
                    {aiConfig ? '設定済み' : '未設定'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">WordPress設定</span>
                  <span className={`text-sm ${(wordPressConfigs || []).length > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {(wordPressConfigs || []).length}個
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">アクティブスケジュール</span>
                  <span className={`text-sm ${activeConfigs.length > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {activeConfigs.length}個
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">スケジューラー状態</span>
                  <span className={`text-sm ${isSchedulerActive ? 'text-green-600' : 'text-gray-600'}`}>
                    {isSchedulerActive ? '実行中' : '停止中'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                ※ ブラウザを閉じると停止します。常時稼働にはサーバーサイドスケジューラーを使用してください。
              </p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <div className="flex space-x-3">
                {!isSchedulerActive ? (
                  <button
                    onClick={handleStartScheduler}
                    className="btn-primary flex items-center space-x-2"
                    disabled={!aiConfig || activeConfigs.length === 0}
                  >
                    <Play className="w-4 h-4" />
                    <span>全スケジューラー開始</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopScheduler}
                    className="bg-red-600 hover:bg-red-700 text-white font-medium px-6 py-2.5 rounded-lg transition-all duration-200"
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    全スケジューラー停止
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">サーバーサイドスケジューラー制御</h3>
          
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">常時稼働システム</h4>
              <div className="space-y-2 text-sm text-blue-800">
                <p>• 管理画面にアクセスしなくても自動投稿が実行されます</p>
                <p>• Netlify Functionsで24時間365日稼働</p>
                <p>• 外部Cronサービスで正確な時刻に実行</p>
                <p>• 高い可用性と安定性を実現</p>
              </div>
            </div>

            <div className="p-4 bg-green-50 rounded-lg">
              <h4 className="font-medium text-green-900 mb-2">設定の同期</h4>
              <div className="space-y-2 text-sm text-green-800">
                <p>• ブラウザで設定した内容がサーバーサイドでも動作</p>
                <p>• WordPress設定とAI設定を環境変数で管理</p>
                <p>• キーワードベース自動投稿に完全対応</p>
                <p>• 多様性確保機能も含めて実装済み</p>
              </div>
            </div>

            <div className="p-4 bg-yellow-50 rounded-lg">
              <h4 className="font-medium text-yellow-900 mb-2">監視とメンテナンス</h4>
              <div className="space-y-2 text-sm text-yellow-800">
                <p>• Netlify Functionsのログで実行状況を監視</p>
                <p>• エラー発生時の自動通知設定可能</p>
                <p>• 定期的な動作確認を推奨</p>
                <p>• 設定変更時は環境変数の更新が必要</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center space-x-2">
            <Hash className="w-5 h-5 text-orange-500" />
            <span>テスト機能（キーワードベース）</span>
          </h3>
          
          <div className="space-y-4">
            {/* Test Keyword Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                テスト用キーワード追加
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={testKeywordInput}
                  onChange={(e) => setTestKeywordInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTestKeyword()}
                  placeholder="例：AI技術、AGA治療、自伝執筆"
                  className="input-field flex-1"
                />
                <button
                  onClick={handleAddTestKeyword}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <Hash className="w-4 h-4" />
                  <span>追加</span>
                </button>
              </div>
            </div>

            {/* Test Keywords List */}
            {testKeywords.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  テスト用キーワード一覧
                </label>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                  {testKeywords.map((keyword, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center space-x-2">
                        <Hash className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-medium text-gray-900">{keyword}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveTestKeyword(keyword)}
                        className="text-red-600 hover:text-red-800 p-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                
                <p className="text-sm text-gray-500 mt-2">
                  設定中: {testKeywords.length}個のキーワード
                </p>
              </div>
            )}

            {testKeywords.length === 0 && (
              <div className="text-center py-8 border border-gray-200 rounded-lg bg-gray-50">
                <Hash className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">テスト用キーワードを追加してください</p>
              </div>
            )}

            <button
              onClick={handleTestGeneration}
              disabled={testGeneration || !aiConfig || testKeywords.length === 0}
              className="w-full btn-secondary flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {testGeneration ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>テスト中...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>テスト実行（実際にWordPressに投稿）</span>
                </>
              )}
            </button>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h6 className="font-semibold text-blue-900 mb-2">テスト実行の流れ</h6>
              <div className="text-xs text-blue-800 space-y-1">
                <p>1. 設定されたキーワードから1つをランダム選択</p>
                <p>2. 選択されたキーワードでトレンド分析を実行</p>
                <p>3. 最適なタイトルを自動生成・選択</p>
                <p>4. AI記事を生成してWordPressに投稿</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">最近のスケジュール実行</h3>
        </div>
        <div className="p-6">
          {publishedToday.length === 0 ? (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">今日はまだ自動投稿が実行されていません</p>
              <p className="text-sm text-gray-400">
                {isSchedulerActive ? 'スケジュールに従って実行されます' : 'スケジューラーを開始してください'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {publishedToday.map((article) => (
                <div key={article.id} className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-gray-900">{article.title}</h4>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <span>
                        {article.publishedAt && new Date(article.publishedAt).toLocaleTimeString('ja-JP')} に自動投稿
                      </span>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                        {article.category}
                      </span>
                      {article.trendData && (
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs">
                          トレンド活用
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm text-green-600">投稿済み</span>
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