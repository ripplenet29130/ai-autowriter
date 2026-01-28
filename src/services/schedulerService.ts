interface ScheduleSettings {
  isActive: boolean;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  time: string;
  targetKeywords: string[];
  publishStatus: 'publish' | 'draft';
}

interface WordPressConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  category: string;
  isActive: boolean;
  scheduleSettings?: ScheduleSettings;
}

interface AIConfig {
  provider: string;
  apiKey: string;
  model: string;
}

interface SchedulerStatus {
  isRunning: boolean;
  lastExecutionTimes: Record<string, string>;
  nextExecutionTimes: Record<string, string>;
  activeConfigs: string[];
}

interface SchedulerDetailedStatus {
  isRunning: boolean;
  activeTimers: number;
  lastExecutionTimes: Record<string, string>;
  usedKeywords: Record<string, string[]>;
  configs: Array<{ id: string; name: string; nextExecution?: string; usedKeywordsCount: number }>;
}

class SchedulerService {
  private static instance: SchedulerService;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isRunning = false;
  private lastExecutionTimes: Record<string, string> = {};
  private usedKeywords: Record<string, Set<string>> = {};
  private configs: WordPressConfig[] = [];

  constructor() {
    this.loadState();
    this.initializeScheduler();
  }

  static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  private loadState(): void {
    try {
      const savedState = localStorage.getItem('schedulerState');
      if (savedState) {
        const state = JSON.parse(savedState) as {
          lastExecutionTimes?: Record<string, string>;
          usedKeywords?: Record<string, string[]>;
        };
        this.lastExecutionTimes = state.lastExecutionTimes || {};
        this.usedKeywords = {};

        // Convert usedKeywords arrays back to Sets
        if (state.usedKeywords) {
          Object.keys(state.usedKeywords).forEach(configId => {
            const keywordsArray = state.usedKeywords![configId];
            if (Array.isArray(keywordsArray)) {
              this.usedKeywords[configId] = new Set(keywordsArray);
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to load scheduler state:', error);
    }
  }

  private saveState(): void {
    try {
      const state = {
        lastExecutionTimes: this.lastExecutionTimes,
        usedKeywords: Object.fromEntries(
          Object.entries(this.usedKeywords).map(([key, value]) => [key, Array.from(value)])
        )
      };
      localStorage.setItem('schedulerState', JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save scheduler state:', error);
    }
  }

  private initializeScheduler(): void {
    // Check if scheduler was running before page reload
    const wasRunning = localStorage.getItem('schedulerWasRunning') === 'true';
    if (wasRunning) {
      // Auto-start will be handled by the component when configs are available
      console.log('Scheduler was running before reload, will auto-start when configs are available');
    }
  }

  start(): void {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    localStorage.setItem('schedulerWasRunning', 'true');
    this.scheduleAllConfigs();
    console.log('Scheduler started');
  }

  stop(): void {
    this.isRunning = false;
    localStorage.setItem('schedulerWasRunning', 'false');
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    console.log('Scheduler stopped');
  }

  private scheduleAllConfigs(): void {
    console.log('Scheduling all active configurations');

    // Clear existing timers
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();

    // Schedule each active config
    this.configs.forEach(config => {
      if (config.isActive && config.scheduleSettings?.isActive) {
        this.scheduleConfig(config.id);
      }
    });
  }

  setConfigs(configs: WordPressConfig[]): void {
    this.configs = configs;
    if (this.isRunning) {
      this.scheduleAllConfigs();
    }
  }

  restartConfigScheduler(configId: string): void {
    // Clear existing timer for this config
    const existingTimer = this.timers.get(configId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(configId);
    }

    // Reschedule if scheduler is running
    if (this.isRunning) {
      this.scheduleConfig(configId);
    }
  }

  private scheduleConfig(configId: string): void {
    const config = this.configs.find(c => c.id === configId);
    if (!config || !config.scheduleSettings) {
      console.warn(`Config ${configId} not found or has no schedule settings`);
      return;
    }

    const { time, frequency } = config.scheduleSettings;
    const nextExecution = this.calculateNextExecution(time, frequency);
    const now = new Date();
    const delay = nextExecution.getTime() - now.getTime();

    if (delay > 0) {
      const timer = setTimeout(() => {
        this.executeScheduledTask(configId);
      }, delay);

      this.timers.set(configId, timer);
      console.log(`Scheduled config ${configId} to run at ${nextExecution.toISOString()}`);
    } else {
      console.warn(`Next execution time ${nextExecution.toISOString()} is in the past for config ${configId}`);
    }
  }

  private calculateNextExecution(time: string, frequency: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const next = new Date();

    next.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, move to next occurrence
    if (next <= now) {
      switch (frequency) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          break;
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'biweekly':
          next.setDate(next.getDate() + 14);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
      }
    }

    return next;
  }

  private async executeScheduledTask(configId: string): Promise<void> {
    console.log(`Executing scheduled task for config: ${configId}`);

    try {
      const config = this.configs.find(c => c.id === configId);
      if (!config || !config.scheduleSettings) {
        console.error(`Config ${configId} not found`);
        return;
      }

      // Record execution time
      this.lastExecutionTimes[configId] = new Date().toISOString();
      this.saveState();

      // Here you would trigger the article generation and publishing
      // This would integrate with AIService and WordPressService
      console.log(`Task executed for ${config.name}`);

      // Reschedule for next occurrence
      this.scheduleConfig(configId);
    } catch (error) {
      console.error(`Error executing task for config ${configId}:`, error);
      // Reschedule even if there's an error
      this.scheduleConfig(configId);
    }
  }

  getSchedulerStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      lastExecutionTimes: this.lastExecutionTimes,
      nextExecutionTimes: this.calculateNextExecutionTimes(),
      activeConfigs: Array.from(this.timers.keys())
    };
  }

  private calculateNextExecutionTimes(): Record<string, string> {
    const nextTimes: Record<string, string> = {};

    this.configs.forEach(config => {
      if (config.isActive && config.scheduleSettings?.isActive) {
        const { time, frequency } = config.scheduleSettings;
        const nextExecution = this.calculateNextExecution(time, frequency);
        nextTimes[config.id] = nextExecution.toISOString();
      }
    });

    return nextTimes;
  }

  getDetailedStatus(): SchedulerDetailedStatus {
    return {
      isRunning: this.isRunning,
      activeTimers: this.timers.size,
      lastExecutionTimes: this.lastExecutionTimes,
      usedKeywords: Object.fromEntries(
        Object.entries(this.usedKeywords).map(([key, value]) => [key, Array.from(value)])
      ),
      configs: []
    };
  }

  clearExecutionHistory(): void {
    this.lastExecutionTimes = {};
    this.usedKeywords = {};
    this.saveState();
    console.log('Execution history cleared');
  }

  async manualTriggerExecution(configId?: string): Promise<void> {
    console.log('Manual execution triggered', configId ? `for config: ${configId}` : 'for all configs');

    try {
      if (configId) {
        // Execute specific config
        await this.executeScheduledTask(configId);
      } else {
        // Execute all active configs
        const activeConfigs = this.configs.filter(c => c.isActive && c.scheduleSettings?.isActive);
        for (const config of activeConfigs) {
          await this.executeScheduledTask(config.id);
        }
      }
      console.log('Manual execution completed');
    } catch (error) {
      console.error('Manual execution failed:', error);
      throw error;
    }
  }

  async testDailyGeneration(keywords: string[]): Promise<void> {
    console.log('Test generation with keywords:', keywords);

    if (!keywords || keywords.length === 0) {
      throw new Error('No keywords provided for test generation');
    }

    try {
      // This would integrate with AIService to generate test articles
      console.log(`Testing generation with ${keywords.length} keywords:`, keywords);

      // Simulate article generation for each keyword
      for (const keyword of keywords) {
        console.log(`Generating test article for keyword: ${keyword}`);
        // In a real implementation, this would call:
        // await aiService.generateArticle({ topic: keyword, ... });
      }

      console.log('Test generation completed successfully');
    } catch (error) {
      console.error('Test generation failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const schedulerService = SchedulerService.getInstance();