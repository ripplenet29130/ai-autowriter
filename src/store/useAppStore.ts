import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Article, WordPressConfig, AIConfig, PromptSet, KeywordSet } from '../types';
import { supabaseSchedulerService } from '../services/supabaseSchedulerService';
import { articlesService } from '../services/articlesService';

interface AppState {
  articles: Article[];
  wordPressConfigs: WordPressConfig[];
  aiConfig: AIConfig | null;
  aiConfigs: AIConfig[]; // 追加
  promptSets: PromptSet[];
  keywordSets: KeywordSet[];
  activeView: string;
  isGenerating: boolean;
  isLoading: boolean;

  // Actions
  setActiveView: (view: string) => void;
  addArticle: (article: Article) => void;
  updateArticle: (id: string, updates: Partial<Article>) => void;
  deleteArticle: (id: string) => void;
  addWordPressConfig: (config: WordPressConfig) => void;
  updateWordPressConfig: (id: string, updates: Partial<WordPressConfig>) => void;
  deleteWordPressConfig: (id: string) => void;
  // Prompt Set Actions
  addPromptSet: (promptSet: PromptSet) => void;
  updatePromptSet: (id: string, updates: Partial<PromptSet>) => void;
  deletePromptSet: (id: string) => void;
  // Keyword Set Actions
  addKeywordSet: (set: KeywordSet) => void;
  updateKeywordSet: (id: string, updates: Partial<KeywordSet>) => void;
  deleteKeywordSet: (id: string) => void;

  setAIConfig: (config: AIConfig) => void;
  activateAIConfig: (id: string) => Promise<void>; // 追加
  deleteAIConfig: (id: string) => Promise<void>; // 追加
  loadKeywordSets: () => Promise<void>;
  setIsGenerating: (generating: boolean) => void;
  loadFromSupabase: () => Promise<void>;
  syncToSupabase: () => Promise<void>;
  loadArticlesFromSupabase: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      articles: [],
      wordPressConfigs: [],
      aiConfig: null,
      aiConfigs: [],
      promptSets: [],
      keywordSets: [],
      activeView: 'dashboard',
      isGenerating: false,
      isLoading: false,

      setActiveView: (view) => {
        try {
          set({ activeView: view });
        } catch (error) {
          console.error('Error setting active view:', error);
        }
      },

      addArticle: async (article) => {
        try {
          // 既存の記事リストを確認
          const exists = get().articles.some(a => a.id === article.id);

          if (exists) {
            // 既存の場合は何もしない（更新が必要な場合はupdateArticleを使用）
            return;
          }

          // DBに保存
          const savedArticle = await articlesService.createArticle(article);

          if (savedArticle) {
            set((state) => ({
              articles: [savedArticle, ...state.articles]
            }));
          } else {
            // DB保存に失敗した場合はローカルのみ追加（フォールバック）
            set((state) => ({
              articles: [article, ...state.articles]
            }));
          }
        } catch (error) {
          console.error('Error adding article:', error);
        }
      },

      updateArticle: async (id, updates) => {
        try {
          set((state) => ({
            articles: state.articles.map((article) =>
              article.id === id ? { ...article, ...updates } : article
            ),
          }));
          await articlesService.updateArticle(id, updates);
        } catch (error) {
          console.error('Error updating article:', error);
        }
      },

      deleteArticle: async (id) => {
        try {
          set((state) => ({
            articles: state.articles.filter((article) => article.id !== id),
          }));
          await articlesService.deleteArticle(id);
        } catch (error) {
          console.error('Error deleting article:', error);
        }
      },

      addWordPressConfig: async (config) => {
        try {
          set((state) => ({ wordPressConfigs: [...state.wordPressConfigs, config] }));
          await supabaseSchedulerService.saveWordPressConfig(config);
        } catch (error) {
          console.error('Error adding WordPress config:', error);
        }
      },

      updateWordPressConfig: async (id, updates) => {
        try {
          set((state) => ({
            wordPressConfigs: state.wordPressConfigs.map((config) =>
              config.id === id ? { ...config, ...updates } : config
            ),
          }));
          const updatedConfig = get().wordPressConfigs.find(c => c.id === id);
          if (updatedConfig) {
            await supabaseSchedulerService.saveWordPressConfig(updatedConfig);
          }
        } catch (error) {
          console.error('Error updating WordPress config:', error);
        }
      },

      deleteWordPressConfig: async (id) => {
        try {
          set((state) => ({
            wordPressConfigs: state.wordPressConfigs.filter((config) => config.id !== id),
          }));
          await supabaseSchedulerService.deleteWordPressConfig(id);
        } catch (error) {
          console.error('Error deleting WordPress config:', error);
        }
      },

      addPromptSet: (promptSet) => {
        set((state) => ({
          promptSets: [...state.promptSets, promptSet]
        }));
      },

      updatePromptSet: (id, updates) => {
        set((state) => ({
          promptSets: state.promptSets.map((ps) =>
            ps.id === id ? { ...ps, ...updates } : ps
          ),
        }));
      },

      deletePromptSet: (id) => {
        set((state) => ({
          promptSets: state.promptSets.filter((ps) => ps.id !== id),
        }));
      },

      addKeywordSet: (keywordSet) => {
        set((state: AppState) => ({ keywordSets: [keywordSet, ...state.keywordSets] }));
      },

      updateKeywordSet: (id, updates) => {
        set((state: AppState) => ({
          keywordSets: state.keywordSets.map((ks) =>
            ks.id === id ? { ...ks, ...updates } : ks
          ),
        }));
      },

      deleteKeywordSet: (id) => {
        set((state: AppState) => ({
          keywordSets: state.keywordSets.filter((ks) => ks.id !== id),
        }));
      },

      setAIConfig: async (config) => {
        try {
          // DB保存 (IDが返る)
          const id = await supabaseSchedulerService.saveAIConfig(config);
          const savedConfig = { ...config, id };

          set((state) => {
            // 既存にあれば更新、なければ追加
            const existingIndex = state.aiConfigs.findIndex(c => c.id === id);
            let newConfigs;
            if (existingIndex >= 0) {
              newConfigs = [...state.aiConfigs];
              newConfigs[existingIndex] = savedConfig;
            } else {
              newConfigs = [savedConfig, ...state.aiConfigs];
            }

            // もしこれが最初、あるいはアクティブなら aiConfig も更新
            const isActive = savedConfig.isActive || newConfigs.length === 1;

            return {
              aiConfig: isActive ? savedConfig : state.aiConfig,
              aiConfigs: newConfigs
            };
          });
        } catch (error) {
          console.error('Error setting AI config:', error);
        }
      },

      activateAIConfig: async (id) => {
        try {
          await supabaseSchedulerService.activateAIConfig(id);
          set((state) => ({
            aiConfigs: state.aiConfigs.map(c => ({
              ...c,
              isActive: c.id === id
            })),
            aiConfig: state.aiConfigs.find(c => c.id === id) || state.aiConfig
          }));
        } catch (error) {
          console.error('Error activating AI config:', error);
          throw error;
        }
      },

      deleteAIConfig: async (id) => {
        try {
          await supabaseSchedulerService.deleteAIConfig(id);
          set((state) => ({
            aiConfigs: state.aiConfigs.filter(c => c.id !== id),
            aiConfig: state.aiConfig?.id === id ? (state.aiConfigs.find(c => c.id !== id) || null) : state.aiConfig
          }));
        } catch (error) {
          console.error('Error deleting AI config:', error);
        }
      },

      loadKeywordSets: async () => {
        try {
          const { keywordSetService } = await import('../services/keywordSetService');
          const sets = await keywordSetService.getKeywordSets();
          set({ keywordSets: sets });
        } catch (error) {
          console.error('Error loading keyword sets:', error);
        }
      },

      setIsGenerating: (generating) => {
        try {
          set({ isGenerating: generating });
        } catch (error) {
          console.error('Error setting generating state:', error);
        }
      },

      loadFromSupabase: async () => {
        try {
          set({ isLoading: true });
          const [wpConfigs, aiConfigs, articles, kSets] = await Promise.all([
            supabaseSchedulerService.loadWordPressConfigs(),
            supabaseSchedulerService.loadAIConfigs(),
            articlesService.getAllArticles(),
            import('../services/keywordSetService').then(m => m.keywordSetService.getKeywordSets())
          ]);
          set({
            wordPressConfigs: wpConfigs,
            aiConfigs: aiConfigs,
            aiConfig: aiConfigs.find(c => c.isActive) || (aiConfigs.length > 0 ? aiConfigs[0] : null),
            articles: articles,
            keywordSets: kSets,
            isLoading: false
          });
        } catch (error) {
          console.error('Error loading from Supabase:', error);
          set({ isLoading: false });
        }
      },

      loadArticlesFromSupabase: async () => {
        try {
          const articles = await articlesService.getAllArticles();
          set({ articles });
        } catch (error) {
          console.error('Error loading articles from Supabase:', error);
        }
      },

      syncToSupabase: async () => {
        try {
          const { wordPressConfigs, aiConfigs } = get();
          for (const config of aiConfigs) {
            await supabaseSchedulerService.saveAIConfig(config);
          }
          for (const config of wordPressConfigs) {
            await supabaseSchedulerService.saveWordPressConfig(config);
          }
        } catch (error) {
          console.error('Error syncing to Supabase:', error);
        }
      }
    }),
    {
      name: 'ai-wordpress-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('Store rehydrated successfully');
        }
      },
      partialize: (state) => ({
        // aiConfigsも永続化対象に含めるか、loadFromSupabaseで読み込むなら不要だが、オフラインも考慮して入れておく
        wordPressConfigs: state.wordPressConfigs,
        aiConfigs: state.aiConfigs,
        aiConfig: state.aiConfig,
        articles: state.articles,
        promptSets: state.promptSets
      }),
    }
  )
);