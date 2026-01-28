import { useState, useCallback } from 'react';
import { WordPressConfig } from '../types';
import { useAppStore } from '../store/useAppStore';
import { WordPressService } from '../services/wordPressService';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const wpLogger = logger.createLogger('WordPressConfig');

/**
 * WordPress設定管理のカスタムフック
 */
export function useWordPressConfig() {
    const { wordPressConfigs, addWordPressConfig, updateWordPressConfig, deleteWordPressConfig } = useAppStore();
    const [isTestingConnection, setIsTestingConnection] = useState(false);

    /**
     * 接続テスト
     */
    const testConnection = useCallback(async (config: WordPressConfig): Promise<boolean> => {
        setIsTestingConnection(true);
        wpLogger.info(`接続テスト開始: ${config.name}`);

        try {
            const service = new WordPressService(config);
            const isValid = await service.testConnection();

            if (isValid) {
                toast.success(`${config.name}への接続に成功しました`);
                wpLogger.info(`接続成功: ${config.name}`);
                return true;
            } else {
                toast.error(`${config.name}への接続に失敗しました`);
                wpLogger.warn(`接続失敗: ${config.name}`);
                return false;
            }
        } catch (error) {
            handleError(error, 'WordPressConnection');
            toast.error('接続テスト中にエラーが発生しました');
            return false;
        } finally {
            setIsTestingConnection(false);
        }
    }, []);

    /**
     * 設定をアクティブにする
     */
    const setActive = useCallback((configId: string) => {
        // 選択した設定をアクティブにする（他の設定は変更しない）
        updateWordPressConfig(configId, { isActive: true });
        toast.success('アクティブな設定を追加しました');
        wpLogger.info(`設定をアクティブ化: ${configId}`);
    }, [updateWordPressConfig]);

    /**
     * アクティブ状態を解除する
     */
    const setInactive = useCallback((configId: string) => {
        updateWordPressConfig(configId, { isActive: false });
        toast.success('アクティブ状態を解除しました');
        wpLogger.info(`設定を非アクティブ化: ${configId}`);
    }, [updateWordPressConfig]);

    /**
     * 設定を削除
     */
    const deleteConfig = useCallback((configId: string) => {
        const config = wordPressConfigs.find(c => c.id === configId);
        if (config && window.confirm(`${config.name}を削除してもよろしいですか？`)) {
            deleteWordPressConfig(configId);
            toast.success('設定を削除しました');
            wpLogger.info(`設定を削除: ${configId}`);
        }
    }, [wordPressConfigs, deleteWordPressConfig]);

    /**
     * 設定を追加
     */
    const addConfig = useCallback((config: Omit<WordPressConfig, 'id'>) => {
        const newConfig: WordPressConfig = {
            ...config,
            id: `wp-${Date.now()}`,
            isActive: wordPressConfigs.length === 0, // 最初の設定は自動的にアクティブ
        };

        addWordPressConfig(newConfig);
        toast.success('WordPress設定を追加しました');
        wpLogger.info(`設定を追加: ${newConfig.name}`);

        return newConfig;
    }, [wordPressConfigs.length, addWordPressConfig]);

    return {
        configs: wordPressConfigs,
        isTestingConnection,
        testConnection,
        setActive,
        setInactive,
        deleteConfig,
        addConfig,
        updateConfig: updateWordPressConfig,
    };
}
