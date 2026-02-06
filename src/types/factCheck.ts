import { OutlineSection, ArticleOutline } from './index';

export interface SectionGenerationRequest {
    section: OutlineSection;
    outline: ArticleOutline;
    previousSections?: OutlineSection[];
    tone: 'professional' | 'casual' | 'technical' | 'friendly';
    customInstructions?: string;
}

// === ファクトチェック機能の型定義 ===

/**
 * ファクトチェック設定
 */
export interface FactCheckSettings {
    id: string;
    enabled: boolean;
    maxItemsToCheck: number;
    perplexityApiKey: string;
    createdAt?: Date | string;
    updatedAt?: Date | string;
}

/**
 * 検証対象アイテム
 */
export interface FactCheckItem {
    claim: string;
    context: string;
    priority: 'high' | 'normal';
}

/**
 * 検証結果
 */
export interface FactCheckResult {
    claim: string;
    verdict: 'correct' | 'incorrect' | 'partially_correct' | 'unverified';
    confidence: number;
    correctInfo?: string;
    sourceUrl: string;
    explanation: string;
}

/**
 * ファクトチェックレポート
 */
export interface FactCheckReport {
    id: string;
    scheduleId?: string;
    totalChecked: number;
    issuesFound: number;
    criticalIssues: number;
    results: FactCheckResult[];
    createdAt: Date | string;
}

/**
 * LLM統合レスポンス（記事本文 + ファクトリスト）
 */
export interface ArticleWithFactList {
    article_body: string;
    fact_check_list: FactCheckItem[];
}
