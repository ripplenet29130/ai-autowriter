export interface Article {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  keywords: string[];
  category: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  tone?: 'professional' | 'casual' | 'technical' | 'friendly';
  length?: 'short' | 'medium' | 'long';
  aiProvider?: string;
  aiModel?: string;
  scheduledAt?: Date | string;
  publishedAt?: Date | string;
  generatedAt?: Date | string;
  updatedAt?: Date | string;
  createdAt?: Date | string;
  wordPressPostId?: string;
  wordPressConfigId?: string;
  wordPressId?: number;
  isPublished?: boolean;
  wordPressUrl?: string;
  seoScore?: number;
  readingTime?: number;
  wordCount?: number;
  trendData?: TrendAnalysisResult;
}

export interface WordPressConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  applicationPassword: string;
  isActive: boolean;
  defaultCategory?: string;
  category?: string;
  postType?: string;
  scheduleSettings?: ScheduleSettings;
}

export interface AIConfig {
  id?: string;
  name?: string; // 表示用（DBにカラムがない場合はフロントエンドで生成）
  provider: 'openai' | 'claude' | 'gemini';
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  imageGenerationEnabled?: boolean;
  imageProvider?: 'dalle3' | 'midjourney' | 'stable-diffusion';
  isActive?: boolean;
  createdAt?: string;
}

export interface ArticleTopic {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultKeywords: string[];
  icon: string;
}

export interface GenerationPrompt {
  topicId?: string;
  topic: string;
  keywords: string[];
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  length: 'short' | 'medium' | 'long';
  includeIntroduction: boolean;
  includeConclusion: boolean;
  includeSources: boolean;
  generateImages?: boolean;
  useTrendData?: boolean;
  trendAnalysis?: TrendAnalysisResult;
  trendData?: TrendAnalysisResult;
  selectedTitleSuggestion?: TitleSuggestion;
  selectedTitle?: string;
  keywordPreferences?: Record<string, KeywordPreference>;
  // === セクション別生成用の追加フィールド ===
  generationType?: 'full_article' | 'section';
  sectionTitle?: string;
  articleTitle?: string;
  previousContentSummary?: string;
  targetWordCount?: number;
  totalOutline?: string;
  previousContent?: string;
  isLead?: boolean;
  customInstructions?: string;
}

export interface PromptSet {
  id: string;
  name: string;
  description?: string;
  customInstructions: string;
  isDefault?: boolean;
  createdAt: Date | string;
}

export interface KeywordSet {
  id: string;
  name: string;
  keywords: string[];
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface ScheduleSettings {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  time: string;
  daysOfWeek?: number[];
  timezone: string;
  isActive: boolean;
  targetKeywords: string[];
  publishStatus: 'publish' | 'draft';
  titleGenerationCount?: number;
  promptSetId?: string; // Prompt Set ID
}

export interface ScheduleSetting {
  id?: string;
  ai_config_id: string;
  wp_config_id: string;
  post_time: string;
  frequency: string;
  status: boolean;
  keyword: string;
  related_keywords?: string[];
  post_status: 'draft' | 'publish';
  start_date?: string;
  end_date?: string;
  chatwork_room_id?: string;
  created_at?: string;
  updated_at?: string;
  prompt_set_id?: string; // DB column name
}

export interface TitleSuggestion {
  id: string;
  title: string;
  keyword: string;
  description: string;
  trendScore: number;
  searchVolume: number;
  competition: 'low' | 'medium' | 'high';
  seoScore: number;
  clickPotential: number;
  targetAudience: string;
  contentAngle: string;
  relatedKeywords: string[];
  trendAnalysis?: TrendAnalysisResult;
}

export interface TrendTopic {
  id: string;
  keyword: string;
  name: string;
  description: string;
  trendScore: number;
  searchVolume: number;
  competition: 'low' | 'medium' | 'high';
  type: 'main' | 'related' | 'suggestion';
  relatedKeywords?: string[];
  seoData?: {
    difficulty: number;
    opportunity: number;
  };
}

export interface TrendAnalysisResult {
  keyword: string;
  trendScore: number;
  searchVolume: number;
  competition: 'low' | 'medium' | 'high';
  relatedKeywords: string[];
  hotTopics: string[];
  seoData: {
    difficulty: number;
    opportunity: number;
    suggestions: string[];
  };
  competitorAnalysis: {
    topArticles: CompetitorArticle[];
    averageLength: number;
    commonTopics: string[];
  };
  userInterest: {
    risingQueries: string[];
    breakoutQueries: string[];
    geographicData: GeographicTrend[];
  };
  timestamp: Date;
}

export interface CompetitorArticle {
  title: string;
  url: string;
  domain: string;
  wordCount: number;
  headings: string[];
  metaDescription: string;
  publishDate?: Date;
}

export interface GeographicTrend {
  region: string;
  value: number;
  formattedValue: string;
}

export interface KeywordSuggestion {
  keyword: string;
  searchVolume: number;
  competition: 'low' | 'medium' | 'high';
  cpc: number;
  trend: 'rising' | 'stable' | 'declining';
}

export interface TrendConfig {
  enableTrendAnalysis: boolean;
  updateFrequency: 'hourly' | 'daily' | 'weekly';
  regions: string[];
  languages: string[];
  competitorDomains: string[];
}

// === マルチステップ記事生成用の型定義 ===

export type KeywordPreference = 'default' | 'ng' | 'essential';

/**
 * 記事のアウトライン（見出し構成）
 */
export interface ArticleOutline {
  id: string;
  title: string;
  keyword: string;
  sections: OutlineSection[];
  trendData?: TrendAnalysisResult;
  estimatedWordCount: number;
  keywordPreferences?: Record<string, KeywordPreference>;
  createdAt: Date;
}

/**
 * アウトラインのセクション（見出し）
 */
export interface OutlineSection {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  description?: string;
  keywords?: string[];
  estimatedWordCount: number;
  order: number;
  content?: string;
  isGenerated?: boolean;
  isLead?: boolean;
}

export type GenerationMode = 'interactive' | 'auto';
export type GenerationStep = 1 | 2 | 3 | 4;

export interface StepResult {
  step: GenerationStep;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  data?: any;
  error?: string;
  timestamp: Date;
}

/**
 * マルチステップ生成の状態
 */
export interface MultiStepGenerationState {
  mode: GenerationMode;
  currentStep: GenerationStep;
  stepResults: StepResult[];
  trendData?: TrendAnalysisResult;
  titles?: TitleSuggestion[];
  outline?: ArticleOutline;
  article?: Article;
  isGenerating: boolean;
  error?: string;
  keywordPreferences: Record<string, KeywordPreference>;
}

/**
 * アウトライン生成のリクエスト
 */
export interface OutlineGenerationRequest {
  keywords: string[];
  trendData: TrendAnalysisResult;
  targetLength: 'short' | 'medium' | 'long';
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  focusTopics?: string[];
  keywordPreferences?: Record<string, KeywordPreference>;
  selectedTitle?: string; // ここに追加
  customInstructions?: string;
}

/**
 * セクション生成のリクエスト
 */
export interface SectionGenerationRequest {
  section: OutlineSection;
  outline: ArticleOutline;
  previousSections?: OutlineSection[];
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  customInstructions?: string;
}