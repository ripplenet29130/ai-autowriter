import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { searchConsoleService } from '../../services/searchConsoleService';

export const ConnectGscButton: React.FC = () => {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await searchConsoleService.startOAuth();
    } catch (error) {
      console.error('Failed to start Google Search Console OAuth:', error);
      const message = error instanceof Error
        ? error.message
        : 'Google Search Console連携を開始できませんでした';
      toast.error(message);
      setIsConnecting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={isConnecting}
      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
      title="Google Search Consoleと連携"
    >
      {isConnecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Search className="h-4 w-4" />
      )}
      <span>{isConnecting ? '連携中...' : 'Search Console連携'}</span>
    </button>
  );
};
