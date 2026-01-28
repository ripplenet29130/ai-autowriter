import { validateApiConfig } from '../config/apiConfig';

export class ApiKeyManager {
  private static instance: ApiKeyManager;
  private apiKeys: Map<string, string> = new Map();

  private constructor() {
    this.loadApiKeys();
  }

  static getInstance(): ApiKeyManager {
    if (!ApiKeyManager.instance) {
      ApiKeyManager.instance = new ApiKeyManager();
    }
    return ApiKeyManager.instance;
  }

  private loadApiKeys() {
    const keys = {
      'google_custom_search': import.meta.env.VITE_GOOGLE_CUSTOM_SEARCH_API_KEY,
      'google_custom_search_engine_id': import.meta.env.VITE_GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
      'serpapi': import.meta.env.VITE_SERPAPI_KEY
    };

    // 1. まずローカルストレージから読み込み
    Object.keys(keys).forEach(service => {
      const storedKey = localStorage.getItem(`api_key_${service}`);
      if (storedKey) {
        this.apiKeys.set(service, storedKey);
      }
    });

    // 2. 環境変数があれば上書き（環境変数を優先）
    Object.entries(keys).forEach(([key, value]) => {
      if (value && value !== '既に設定したGoogle API Key' && value.length > 10) {
        this.apiKeys.set(key, value);
      }
    });
  }

  getApiKey(service: string): string | null {
    return this.apiKeys.get(service) || null;
  }

  setApiKey(service: string, key: string): void {
    this.apiKeys.set(service, key);
    // セキュアな方法で保存（実際の実装では暗号化を検討）
    localStorage.setItem(`api_key_${service}`, key);
  }

  hasApiKey(service: string): boolean {
    return this.apiKeys.has(service) && !!this.apiKeys.get(service);
  }

  validateConfiguration(): {
    isValid: boolean;
    missingServices: string[];
    availableServices: string[];
  } {
    const requiredServices = ['google_custom_search', 'google_custom_search_engine_id'];
    const optionalServices = ['serpapi'];

    const missingServices = requiredServices.filter(service => !this.hasApiKey(service));
    const availableServices = [...requiredServices, ...optionalServices]
      .filter(service => this.hasApiKey(service));

    return {
      isValid: missingServices.length === 0,
      missingServices,
      availableServices
    };
  }

  // 新形式のSearch Engine IDかどうかを検証
  validateSearchEngineId(id: string): boolean {
    // 新形式: 短い英数字のみ（例: 73c70ae8e1c314d0f）
    const newFormatPattern = /^[a-f0-9]{10,20}$/i;

    // 旧形式: 数字:英数字（例: 017576662512468239146:omuauf_lfve）
    const oldFormatPattern = /^\d+:[a-zA-Z0-9_]+$/;

    if (newFormatPattern.test(id)) {
      return true; // 新形式
    } else if (oldFormatPattern.test(id)) {
      console.warn('旧形式のSearch Engine IDが検出されました。新形式への更新を推奨します。');
      return true; // 旧形式も一応受け入れる
    }

    return false; // 無効な形式
  }
}

export const apiKeyManager = ApiKeyManager.getInstance();