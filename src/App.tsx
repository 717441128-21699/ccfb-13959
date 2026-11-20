import { useState } from 'react';
import { AppProvider } from './state/AppContext';
import { AnalysisTab } from './ui/AnalysisTab';
import { SyntheticTab } from './ui/SyntheticTab';
import { HerbLibraryTab } from './ui/HerbLibraryTab';
import { SettingsTab } from './ui/SettingsTab';

const TABS = [
  { id: 'analysis', label: '样品鉴别' },
  { id: 'synthetic', label: '合成测试 / 准确率' },
  { id: 'library', label: '药典特征库' },
  { id: 'settings', label: '设置' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('analysis');
  return (
    <AppProvider>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-title">
            <span className="logo">微</span>
            <div>
              <h1>中药粉末显微鉴别系统</h1>
              <p>GPU 结构识别 · 形态学规则分类 · 药典特征比对(原型 v0.1)</p>
            </div>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>
        <main className="app-main">
          {tab === 'analysis' && <AnalysisTab />}
          {tab === 'synthetic' && <SyntheticTab />}
          {tab === 'library' && <HerbLibraryTab />}
          {tab === 'settings' && <SettingsTab />}
        </main>
      </div>
    </AppProvider>
  );
}
