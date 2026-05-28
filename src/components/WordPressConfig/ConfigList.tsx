import React from 'react';
import { Check, Edit, Globe, Trash2, X } from 'lucide-react';
import { WordPressConfig } from '../../types';
import { GscConnectionSummary } from '../SearchConsole/GscConnectionSummary';

interface ConfigListProps {
  configs: WordPressConfig[];
  onSetActive: (configId: string) => void;
  onSetInactive?: (configId: string) => void;
  onDelete: (configId: string) => void;
  onEdit?: (config: WordPressConfig) => void;
  onTestConnection?: (config: WordPressConfig) => void;
}

export const ConfigList: React.FC<ConfigListProps> = ({
  configs,
  onSetActive,
  onSetInactive,
  onDelete,
  onEdit,
  onTestConnection,
}) => {
  if (configs.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-12 text-center">
        <Globe className="mx-auto mb-4 h-16 w-16 text-gray-400" />
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          WordPress設定がありません
        </h3>
        <p className="text-gray-600">
          新しい設定を追加して、WordPressサイトと連携しましょう。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {configs.map((config) => (
        <div
          key={config.id}
          className={`rounded-xl border-2 bg-white p-6 shadow-sm transition-all ${
            config.isActive
              ? 'border-blue-500 ring-2 ring-blue-100'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center space-x-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  {config.name}
                </h3>
                {config.isActive && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                    <Check className="mr-1 h-3 w-3" />
                    アクティブ
                  </span>
                )}
              </div>

              <div className="space-y-1 text-sm text-gray-600">
                <p className="flex items-center space-x-2">
                  <Globe className="h-4 w-4 shrink-0" />
                  <span className="break-all">{config.url}</span>
                </p>
                <p>
                  <span className="font-medium">ユーザー名:</span> {config.username}
                </p>
                {config.category && (
                  <p>
                    <span className="font-medium">カテゴリ:</span> {config.category}
                  </p>
                )}
                {config.scheduleSettings?.isActive && (
                  <p className="mt-2 font-medium text-green-600">
                    スケジュール有効 - {config.scheduleSettings.frequency === 'daily' ? '毎日' :
                      config.scheduleSettings.frequency === 'weekly' ? '毎週' :
                        config.scheduleSettings.frequency === 'biweekly' ? '隔週' : '毎月'}{' '}
                    {config.scheduleSettings.time}
                  </p>
                )}
              </div>
            </div>

            <div className="ml-4 flex shrink-0 items-center space-x-2">
              {config.isActive ? (
                <button
                  type="button"
                  onClick={() => onSetInactive && onSetInactive(config.id)}
                  className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 transition-colors hover:bg-blue-100"
                  title="アクティブ状態を解除"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetActive(config.id)}
                  className="btn-secondary text-sm"
                  title="この設定をアクティブにする"
                >
                  <Check className="h-4 w-4" />
                </button>
              )}

              {onTestConnection && (
                <button
                  type="button"
                  onClick={() => onTestConnection(config)}
                  className="btn-secondary text-sm"
                  title="接続テスト"
                >
                  接続テスト
                </button>
              )}

              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(config)}
                  className="btn-secondary text-sm"
                  title="編集"
                >
                  <Edit className="h-4 w-4" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onDelete(config.id)}
                className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50"
                title="削除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <GscConnectionSummary wordpressConfigId={config.id} />
        </div>
      ))}
    </div>
  );
};
