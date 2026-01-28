export const API_CONFIG = {
  // Google APIs
  googleTrends: {
    apiKey: import.meta.env.VITE_GOOGLE_TRENDS_API_KEY,
    baseUrl: 'https://trends.googleapis.com/trends/api'
  },
  
  customSearch: {
    apiKey: import.meta.env.VITE_GOOGLE_CUSTOM_SEARCH_API_KEY,
    engineId: import.meta.env.VITE_GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
    baseUrl: 'https://www.googleapis.com/customsearch/v1'
  },
  
  // 代替API
  serpApi: {
    apiKey: import.meta.env.VITE_SERPAPI_KEY,
    baseUrl: 'https://serpapi.com/search'
  }
};

export const validateApiConfig = () => {
  const requiredKeys = [
    'VITE_GOOGLE_CUSTOM_SEARCH_API_KEY',
    'VITE_GOOGLE_CUSTOM_SEARCH_ENGINE_ID'
  ];
  
  const missingKeys = requiredKeys.filter(key => !import.meta.env[key]);
  
  if (missingKeys.length > 0) {
    console.warn('Missing API keys:', missingKeys);
    return false;
  }
  
  return true;
};