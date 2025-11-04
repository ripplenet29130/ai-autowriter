import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import AISettings from './pages/AISettings';
import WPSettings from './pages/WPSettings';
import Scheduler from './pages/Scheduler';
import TrendAnalysis from './pages/TrendAnalysis';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ai-settings" element={<AISettings />} />
          <Route path="/wp-settings" element={<WPSettings />} />
          <Route path="/scheduler" element={<Scheduler />} />
          <Route path="/trend-analysis" element={<TrendAnalysis />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
