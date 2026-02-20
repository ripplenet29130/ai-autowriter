import { FactCheckResult } from './factCheck';
export type { FactCheckResult };

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
  targetWordCount?: number;
  trendData?: TrendAnalysisResult;
  factCheckResults?: FactCheckResult[];
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
  name?: string; // 陦ｨ遉ｺ逕ｨ・・B縺ｫ繧ｫ繝ｩ繝縺後↑縺・ｴ蜷医・繝輔Ο繝ｳ繝医お繝ｳ繝峨〒逕滓・・・
  provider: 'openai' | 'claude' | 'gemini';
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  imageGenerationEnabled?: boolean;
  imageProvider?: 'nanobanana' | 'dalle3' | 'midjourney' | 'stable-diffusion' | 'unsplash';
  imagesPerArticle?: number; // 險倅ｺ九≠縺溘ｊ縺ｮ逕ｻ蜒冗函謌先椢謨ｰ・・=辟｡蜉ｹ縲・-10=譫壽焚・・
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
  // === 繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ蛻･逕滓・逕ｨ縺ｮ霑ｽ蜉繝輔ぅ繝ｼ繝ｫ繝・===
  generationType?: 'full_article' | 'section';
  sectionTitle?: string;
  articleTitle?: string;
  previousContentSummary?: string;
  targetWordCount?: number;
  totalOutline?: string;
  previousContent?: string;
  isLead?: boolean;
  customInstructions?: string;
  imagesPerArticle?: number; // 險倅ｺ九≠縺溘ｊ縺ｮ逕ｻ蜒冗函謌先椢謨ｰ
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

export interface TitleSet {
  id: string;
  name: string;
  titles: string[];
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
  ai_provider_override?: string;
  ai_model_override?: string;
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
  chatwork_message_template?: string;
  target_word_count?: number;
  writing_tone?: string;
  created_at?: string;
  updated_at?: string;
  prompt_set_id?: string; // DB column name
  keyword_set_id?: string;
  title_set_id?: string;
  generation_mode?: 'keyword' | 'title' | 'both';
  enable_fact_check?: boolean; // 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け譛牙柑蛹・
  fact_check_note?: string; // [[]]縺ｧ蝗ｲ繧繝√ぉ繝・け蜆ｪ蜈育ｮ・園
  image_generation_enabled?: boolean;
  images_per_article?: number;
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
  trend?: 'rising' | 'stable' | 'declining';
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

// === 繝槭Ν繝√せ繝・ャ繝苓ｨ倅ｺ狗函謌千畑縺ｮ蝙句ｮ夂ｾｩ ===

export type KeywordPreference = 'default' | 'ng' | 'essential';

/**
 * 險倅ｺ九・繧｢繧ｦ繝医Λ繧､繝ｳ・郁ｦ句・縺玲ｧ区・・・
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
 * 繧｢繧ｦ繝医Λ繧､繝ｳ縺ｮ繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ・郁ｦ句・縺暦ｼ・
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
 * 繝槭Ν繝√せ繝・ャ繝礼函謌舌・迥ｶ諷・
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
 * 繧｢繧ｦ繝医Λ繧､繝ｳ逕滓・縺ｮ繝ｪ繧ｯ繧ｨ繧ｹ繝・
 */
export interface OutlineGenerationRequest {
  keywords: string[];
  trendData: TrendAnalysisResult;
  targetLength: 'short' | 'medium' | 'long';
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  focusTopics?: string[];
  keywordPreferences?: Record<string, KeywordPreference>;
  selectedTitle?: string; // 縺薙％縺ｫ霑ｽ蜉
  customInstructions?: string;
  targetWordCount?: number; // 逶ｮ讓呎枚蟄玲焚・域焚蛟､・・
}

/**
 * 繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ逕滓・縺ｮ繝ｪ繧ｯ繧ｨ繧ｹ繝・
 */
export interface SectionGenerationRequest {
  section: OutlineSection;
  outline: ArticleOutline;
  previousSections?: OutlineSection[];
  tone: 'professional' | 'casual' | 'technical' | 'friendly';
  customInstructions?: string;
}
