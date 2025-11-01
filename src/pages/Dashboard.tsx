import { Brain, Globe, Calendar, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">ダッシュボード</h1>
        <p className="text-gray-600">AI WordPress Systemの概要</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Brain className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">AI設定</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-lg">
              <Globe className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">WordPress設定</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-100 rounded-lg">
              <Calendar className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">有効なスケジュール</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-lg">
              <TrendingUp className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">今月の投稿数</p>
              <p className="text-2xl font-bold text-gray-800">-</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">最近の投稿</h2>
          <p className="text-gray-600 text-sm">投稿履歴機能は準備中です</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">システムステータス</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">データベース接続</span>
              <span className="px-3 py-1 bg-green-100 text-green-700 text-xs rounded-full">正常</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">スケジューラー</span>
              <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">準備中</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">今後の拡張予定</h3>
        <ul className="space-y-2 text-sm text-gray-700">
          <li>• トレンド分析機能</li>
          <li>• AI記事生成インターフェース</li>
          <li>• 実行ログとレポート機能</li>
          <li>• 統計とダッシュボードの充実</li>
        </ul>
      </div>
    </div>
  );
}
