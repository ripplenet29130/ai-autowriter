import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
    const { wordPressConfigs, addWordPressConfig, updateWordPressConfig, deleteWordPressConfig, activateWordPressConfig } = useAppStore();
    const [isTestingConnection, setIsTestingConnection] = useState(false);

    /**
     * 接続テスト
     */
    const testConnection = useCallback(async (config: WordPressConfig): Promise<boolean> => {
        setIsTestingConnection(true);
        wpLogger.info(`接続テスト開始: ${config.name}`);

        try {
            const service = new WordPressService(config);
            const result = await service.testConnection();

            if (result.success) {
                toast.success(`${config.name}への接続に成功しました`);
                wpLogger.info(`接続成功: ${config.name}`);
                return true;
            } else {
                toast.error(result.message, { duration: 10000 });
                wpLogger.warn(`接続失敗: ${config.name}`, {
                    status: result.status,
                    code: result.code,
                    details: result.details,
                });
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
        // 他の設定を非アクティブにし、この設定をアクティブにする
        activateWordPressConfig(configId);
        toast.success('設定をアクティブにしました');
        wpLogger.info(`設定をアクティブ化: ${configId}`);
    }, [activateWordPressConfig]);

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
    const addConfig = useCallback(async (config: Omit<WordPressConfig, 'id'>) => {
        const newConfig: WordPressConfig = {
            ...config,
            id: uuidv4(),
            isActive: true, // 全ての設定をデフォルトでアクティブにする
        };

        await addWordPressConfig(newConfig);
        toast.success('WordPress設定を追加しました');
        wpLogger.info(`設定を追加: ${newConfig.name}`);

        return newConfig;
    }, [addWordPressConfig]);

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
