import { supabase } from '../services/supabaseClient';
import { logger } from './logger';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabaseクエリのレスポンス型
 */
interface SupabaseResponse<T> {
    data: T | null;
    error: Error | null;
}

/**
 * Supabaseヘルパー関数
 */
export class SupabaseHelpers {
    /**
     * Supabaseクライアントが利用可能かチェック
     */
    static isAvailable(): boolean {
        return supabase !== null;
    }

    /**
     * Supabaseクライアントを取得（エラーハンドリング付き）
     */
    static getClient(): SupabaseClient {
        if (!supabase) {
            throw new Error('Supabase client is not initialized. Please check your environment variables.');
        }
        return supabase;
    }

    /**
     * クエリ結果をチェックしてエラーをスロー
     */
    static checkError<T>(result: SupabaseResponse<T>): T {
        if (result.error) {
            logger.error('Supabase query error:', result.error);
            throw result.error;
        }
        if (result.data === null) {
            throw new Error('Supabase query returned null data');
        }
        return result.data;
    }

    /**
     * 安全にデータを取得
     */
    static async safeQuery<T>(
        queryFn: (client: SupabaseClient) => Promise<SupabaseResponse<T>>,
        defaultValue: T
    ): Promise<T> {
        try {
            if (!this.isAvailable()) {
                logger.warn('Supabase client not available, returning default value');
                return defaultValue;
            }

            const client = this.getClient();
            const result = await queryFn(client);

            if (result.error) {
                logger.error('Supabase query error:', result.error);
                return defaultValue;
            }

            return result.data ?? defaultValue;
        } catch (error) {
            logger.error('Supabase query exception:', error);
            return defaultValue;
        }
    }

    /**
     * テーブルからすべてのレコードを取得
     */
    static async fetchAll<T>(tableName: string): Promise<T[]> {
        return this.safeQuery<T[]>(
            async (client) => await client.from(tableName).select('*'),
            []
        );
    }

    /**
     * IDでレコードを取得
     */
    static async fetchById<T>(tableName: string, id: string): Promise<T | null> {
        return this.safeQuery<T | null>(
            async (client) => {
                const { data, error } = await client
                    .from(tableName)
                    .select('*')
                    .eq('id', id)
                    .single();
                return { data, error };
            },
            null
        );
    }

    /**
     * レコードを挿入
     */
    static async insert<T>(tableName: string, data: Partial<T>): Promise<T | null> {
        try {
            const client = this.getClient();
            const { data: result, error } = await client
                .from(tableName)
                .insert(data)
                .select()
                .single();

            if (error) {
                logger.error(`Failed to insert into ${tableName}:`, error);
                return null;
            }

            return result as T;
        } catch (error) {
            logger.error(`Insert exception for ${tableName}:`, error);
            return null;
        }
    }

    /**
     * レコードを更新
     */
    static async update<T>(
        tableName: string,
        id: string,
        updates: Partial<T>
    ): Promise<T | null> {
        try {
            const client = this.getClient();
            const { data, error } = await client
                .from(tableName)
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) {
                logger.error(`Failed to update ${tableName}:`, error);
                return null;
            }

            return data as T;
        } catch (error) {
            logger.error(`Update exception for ${tableName}:`, error);
            return null;
        }
    }

    /**
     * レコードを削除
     */
    static async delete(tableName: string, id: string): Promise<boolean> {
        try {
            const client = this.getClient();
            const { error } = await client
                .from(tableName)
                .delete()
                .eq('id', id);

            if (error) {
                logger.error(`Failed to delete from ${tableName}:`, error);
                return false;
            }

            return true;
        } catch (error) {
            logger.error(`Delete exception for ${tableName}:`, error);
            return false;
        }
    }

    /**
     * 条件に一致するレコードを取得
     */
    static async fetchWhere<T>(
        tableName: string,
        column: string,
        value: any
    ): Promise<T[]> {
        return this.safeQuery<T[]>(
            async (client) => await client
                .from(tableName)
                .select('*')
                .eq(column, value),
            []
        );
    }

    /**
     * レコード数を取得
     */
    static async count(tableName: string): Promise<number> {
        try {
            const client = this.getClient();
            const { count, error } = await client
                .from(tableName)
                .select('*', { count: 'exact', head: true });

            if (error) {
                logger.error(`Failed to count ${tableName}:`, error);
                return 0;
            }

            return count ?? 0;
        } catch (error) {
            logger.error(`Count exception for ${tableName}:`, error);
            return 0;
        }
    }
}
