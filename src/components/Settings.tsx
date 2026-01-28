import React from 'react';
import { Settings, Database, Key } from 'lucide-react';
import { DataMigration } from './DataMigration';
import { ApiKeySettings } from './ApiKeySettings';

export const SettingsComponent: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Settings className="w-8 h-8 text-gray-600" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">設定</h2>
          <p className="text-gray-600">システム設定を管理します</p>
        </div>
      </div>

      {/* API設定 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">API設定</h3>
        </div>
        <ApiKeySettings />
      </div>

      {/* データ移行 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">データ移行</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          ローカルストレージからSupabaseデータベースへの記事移行
        </p>
        <DataMigration />
      </div>
    </div>
  );
};