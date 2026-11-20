import { useEffect, useRef, useState } from 'react';
import type { Annotation, StructureType } from '../types';
import { STRUCTURE_LABELS } from '../types';

const TYPE_COLORS: Record<StructureType, string> = {
  calcium_cluster: '#ff7a45',
  calcium_needle: '#ffa940',
  stone_cell: '#722ed1',
  vessel: '#1677ff',
  fiber: '#13c2c2',
  starch: '#a0d911',
  pollen: '#eb2f96',
};

export const ALL_TYPES: StructureType[] = [
  'calcium_cluster', 'calcium_needle', 'stone_cell',
  'vessel', 'fiber', 'starch', 'pollen',
];

interface Props {
  image: CanvasImageSource & { width: number; height: number };
  annotations: Annotation[];
  onChange: (anns: Annotation[]) => void;
  /** 叠加显示的置信度等信息 */
  readOnly?: boolean;
}

/**
 * 图像标注画布:机器标注可选中改类别/删除,也可框选新增。
 * 坐标系按显示比例与图像像素互转。
 */
export function AnnotationCanvas({ image, annotations, onChange, readOnly = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<StructureType>('calcium_cluster');
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      setScale(Math.min(1, (wrap.clientWidth - 8) / image.width));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [image.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    for (const a of annotations) {
      const color = TYPE_COLORS[a.type];
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '22';
      ctx.fillRect(a.bbox.x, a.bbox.y, a.bbox.w, a.bbox.h);
      ctx.strokeRect(a.bbox.x, a.bbox.y, a.bbox.w, a.bbox.h);
      if (a.id === selected) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(a.bbox.x - 2, a.bbox.y - 2, a.bbox.w + 4, a.bbox.h + 4);
      }
      const label = `${STRUCTURE_LABELS[a.type]}${a.source === 'auto' ? ` ${(a.confidence * 100).toFixed(0)}%` : ' 人工'}`;
      ctx.font = '14px sans-serif';
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(a.bbox.x, Math.max(0, a.bbox.y - 20), tw, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, a.bbox.x + 4, Math.max(14, a.bbox.y - 6));
    }
    if (drag) {
      ctx.strokeStyle = '#ffd666';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1),
        Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0),
      );
      ctx.setLineDash([]);
    }
  }, [image, annotations, selected, drag]);

  const toImagePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const hitTest = (x: number, y: number): Annotation | null => {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const b = annotations[i].bbox;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return annotations[i];
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    const p = toImagePos(e);
    const hit = hitTest(p.x, p.y);
    if (hit) {
      setSelected(hit.id);
    } else {
      setSelected(null);
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const p = toImagePos(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };

  const onMouseUp = () => {
    if (!drag) return;
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    if (w > 8 && h > 8) {
      const bbox = {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w,
        h,
      };
      const ann: Annotation = {
        id: `human-${Date.now()}-${annotations.length}`,
        type: tool,
        cx: bbox.x + bbox.w / 2,
        cy: bbox.y + bbox.h / 2,
        bbox,
        source: 'human',
        confidence: 1,
      };
      onChange([...annotations, ann]);
    }
    setDrag(null);
  };

  const changeType = (type: StructureType) => {
    if (!selected) return;
    onChange(annotations.map((a) => a.id === selected
      ? { ...a, type, source: 'human' as const, confidence: 1 }
      : a));
  };

  const deleteSelected = () => {
    if (!selected) return;
    onChange(annotations.filter((a) => a.id !== selected));
    setSelected(null);
  };

  const sel = annotations.find((a) => a.id === selected);

  return (
    <div ref={wrapRef} className="canvas-wrap">
      {!readOnly && (
        <div className="canvas-toolbar">
          <span className="toolbar-label">新增标注类别:</span>
          <select value={tool} onChange={(e) => setTool(e.target.value as StructureType)}>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{STRUCTURE_LABELS[t]}</option>)}
          </select>
          {sel && (
            <>
              <span className="toolbar-label">选中项改类:</span>
              <select
                value={sel.type}
                onChange={(e) => changeType(e.target.value as StructureType)}
              >
                {ALL_TYPES.map((t) => <option key={t} value={t}>{STRUCTURE_LABELS[t]}</option>)}
              </select>
              <button className="btn danger" onClick={deleteSelected}>删除选中</button>
            </>
          )}
          <span className="toolbar-hint">空白处拖拽框选 = 新增;点框 = 选中</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="annot-canvas"
        style={{ width: image.width * scale, height: image.height * scale, cursor: readOnly ? 'default' : 'crosshair' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => setDrag(null)}
      />
    </div>
  );
}
