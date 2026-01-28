import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Error boundary component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '20px', 
          textAlign: 'center',
          fontFamily: 'Arial, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#f9fafb'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            maxWidth: '500px',
            width: '100%'
          }}>
            <h1 style={{ 
              color: '#dc2626', 
              marginBottom: '16px',
              fontSize: '24px',
              fontWeight: 'bold'
            }}>
              アプリケーションエラーが発生しました
            </h1>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              申し訳ございません。アプリケーションでエラーが発生しました。<br />
              ページを再読み込みしてください。
            </p>
            <button 
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 24px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
            >
              ページを再読み込み
            </button>
            {this.state.error && (
              <details style={{ marginTop: '20px', textAlign: 'left' }}>
                <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '14px' }}>
                  エラー詳細を表示
                </summary>
                <pre style={{ 
                  marginTop: '10px', 
                  padding: '10px', 
                  backgroundColor: '#f3f4f6', 
                  borderRadius: '4px',
                  fontSize: '12px',
                  overflow: 'auto',
                  color: '#374151'
                }}>
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Initialize the app with proper error handling
function initializeApp() {
  try {
    const rootElement = document.getElementById('root');
    
    if (!rootElement) {
      throw new Error('Root element not found');
    }

    const root = createRoot(rootElement);

    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );

    console.log('Application initialized successfully');
  } catch (error) {
    console.error('Failed to initialize app:', error);
    
    // Fallback error display
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.innerHTML = `
        <div style="padding: 20px; text-align: center; font-family: Arial, sans-serif; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background-color: #f9fafb;">
          <div style="background-color: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); max-width: 500px; width: 100%;">
            <h1 style="color: #dc2626; margin-bottom: 16px; font-size: 24px; font-weight: bold;">アプリケーションの起動に失敗しました</h1>
            <p style="color: #6b7280; margin-bottom: 24px; line-height: 1.5;">申し訳ございません。アプリケーションの起動中にエラーが発生しました。<br />ページを再読み込みしてください。</p>
            <button onclick="window.location.reload()" style="padding: 12px 24px; background-color: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 500;">
              ページを再読み込み
            </button>
          </div>
        </div>
      `;
    }
  }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}