import { createContext, useContext, useState, type ReactNode } from 'react';
import type { HerbProfile, Annotation } from '../types';
import { HERB_PROFILES } from '../data/herbs';

export interface ImageEntry {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface Settings {
  /** μm/px 标定系数(仅影响结果展示换算) */
  umPerPx: number;
  /** GPU 自适应阈值灵敏度 */
  thresholdC: number;
  /** 单样品图片张数预算 */
  imageBudget: number;
  /** 时间预算 ms */
  timeBudgetMs: number;
}

interface AppState {
  images: ImageEntry[];
  setImages: (v: ImageEntry[]) => void;
  profiles: HerbProfile[];
  setProfiles: (v: HerbProfile[]) => void;
  settings: Settings;
  setSettings: (v: Settings) => void;
  /** 人工标注覆盖层:key = imageId */
  manualEdits: Record<string, Annotation[]>;
  setManualEdits: (imageId: string, anns: Annotation[]) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [profiles, setProfiles] = useState<HerbProfile[]>(HERB_PROFILES);
  const [settings, setSettings] = useState<Settings>({
    umPerPx: 0.25,
    thresholdC: 0.08,
    imageBudget: 30,
    timeBudgetMs: 120_000,
  });
  const [manualEdits, setEdits] = useState<Record<string, Annotation[]>>({});

  const setManualEdits = (imageId: string, anns: Annotation[]) => {
    setEdits((prev) => ({ ...prev, [imageId]: anns }));
  };

  return (
    <Ctx.Provider value={{
      images, setImages,
      profiles, setProfiles,
      settings, setSettings,
      manualEdits, setManualEdits,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用');
  return v;
}
