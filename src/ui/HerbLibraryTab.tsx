import { useState } from 'react';
import { useApp } from '../state/AppContext';
import { STRUCTURE_LABELS, VESSEL_KIND_LABELS, type HerbProfile } from '../types';

export function HerbLibraryTab() {
  const { profiles, setProfiles } = useApp();
  const [activeId, setActiveId] = useState(profiles[0]?.id ?? '');
  const active = profiles.find((p) => p.id === activeId);
  const [draft, setDraft] = useState<HerbProfile | null>(null);

  const edit = draft ?? active;

  const update = (next: HerbProfile) => setDraft(next);

  const save = () => {
    if (!draft) return;
    setProfiles(profiles.map((p) => (p.id === draft.id ? draft : p)));
    setDraft(null);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'herb-profiles.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as HerbProfile[];
        if (!Array.isArray(parsed)) throw new Error('格式应为数组');
        setProfiles(parsed);
        setActiveId(parsed[0]?.id ?? '');
        setDraft(null);
      } catch (e) {
        alert('导入失败: ' + (e as Error).message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="tab-body two-col">
      <section className="card">
        <h2>药材列表({profiles.length} 味)</h2>
        <div className="herb-list">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`herb-item ${p.id === activeId ? 'active' : ''}`}
              onClick={() => { setActiveId(p.id); setDraft(null); }}
            >
              <b>{p.name}</b>
              <span>{p.latinName}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={exportJson}>导出 JSON</button>
          <label className="btn file-btn">
            导入 JSON
            <input
              type="file" accept="application/json" hidden
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
        </div>
        <p className="hint">
          数值范围为像素占位初值,投产前须用标定标本逐味校准;校准结果以 JSON 导入即可全量替换。
        </p>
      </section>

      {edit && (
        <section className="card">
          <h2>{edit.name} · 特征表编辑</h2>
          <div className="form-grid">
            <label>中文名
              <input value={edit.name} onChange={(e) => update({ ...edit, name: e.target.value })} />
            </label>
            <label>拉丁名
              <input value={edit.latinName} onChange={(e) => update({ ...edit, latinName: e.target.value })} />
            </label>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>结构类型</th><th>标志特征</th><th>直径范围(px)</th>
                <th>锐度范围</th><th>纹孔密度</th><th>导管纹式</th><th>描述</th>
              </tr>
            </thead>
            <tbody>
              {edit.features.map((f, i) => (
                <tr key={i}>
                  <td>{STRUCTURE_LABELS[f.type]}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={f.hallmark}
                      onChange={(e) => {
                        const features = edit.features.slice();
                        features[i] = { ...f, hallmark: e.target.checked };
                        update({ ...edit, features });
                      }}
                    />
                  </td>
                  <td>
                    <RangeInput
                      value={f.diameterRange}
                      onChange={(v) => {
                        const features = edit.features.slice();
                        features[i] = { ...f, diameterRange: v };
                        update({ ...edit, features });
                      }}
                    />
                  </td>
                  <td>
                    <RangeInput
                      value={f.sharpnessRange}
                      step={0.05}
                      onChange={(v) => {
                        const features = edit.features.slice();
                        features[i] = { ...f, sharpnessRange: v };
                        update({ ...edit, features });
                      }}
                    />
                  </td>
                  <td>
                    <RangeInput
                      value={f.pitDensityRange}
                      step={0.05}
                      onChange={(v) => {
                        const features = edit.features.slice();
                        features[i] = { ...f, pitDensityRange: v };
                        update({ ...edit, features });
                      }}
                    />
                  </td>
                  <td>{f.vesselKinds?.map((k) => VESSEL_KIND_LABELS[k]).join('/') ?? '—'}</td>
                  <td>
                    <textarea
                      value={f.description}
                      rows={3}
                      onChange={(e) => {
                        const features = edit.features.slice();
                        features[i] = { ...f, description: e.target.value };
                        update({ ...edit, features });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {draft && (
            <div className="row">
              <button className="btn primary" onClick={save}>保存修改</button>
              <button className="btn ghost" onClick={() => setDraft(null)}>放弃</button>
            </div>
          )}
          <p className="hint">来源:{edit.source}</p>
        </section>
      )}
    </div>
  );
}

function RangeInput({
  value,
  onChange,
  step = 1,
}: {
  value?: [number, number];
  onChange: (v: [number, number] | undefined) => void;
  step?: number;
}) {
  return (
    <div className="range-input">
      <input
        type="number"
        step={step}
        value={value?.[0] ?? ''}
        placeholder="—"
        onChange={(e) => {
          const lo = Number(e.target.value);
          onChange(Number.isFinite(lo) ? [lo, value?.[1] ?? lo] : undefined);
        }}
      />
      <span>~</span>
      <input
        type="number"
        step={step}
        value={value?.[1] ?? ''}
        placeholder="—"
        onChange={(e) => {
          const hi = Number(e.target.value);
          onChange(Number.isFinite(hi) ? [value?.[0] ?? hi, hi] : undefined);
        }}
      />
    </div>
  );
}
