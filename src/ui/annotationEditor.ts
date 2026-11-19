import type { DetectedObject, StructureType } from '../core/types';
import { ALL_STRUCTURE_TYPES, STRUCTURE_LABEL } from '../core/types';

export const TYPE_COLORS: Record<StructureType, string> = {
  cluster_crystal: '#e85d75',
  prism_crystal: '#f08a3c',
  stone_cell: '#8b5cf6',
  vessel: '#2f9e44',
  fiber: '#1c92b5',
  crystal_fiber: '#0ca678',
  starch: '#e9b949',
  pollen: '#d63384',
  bubble: '#9aa5b1',
  debris: '#7b8794',
};

export interface EditOp {
  description: string;
  apply: (objects: DetectedObject[]) => DetectedObject[];
  invert: (objects: DetectedObject[]) => DetectedObject[];
}

let nextId = 10000;

/** 修改类别（含亚型清空），可批量 */
export function changeTypeOp(ids: number[], to: StructureType): EditOp {
  const before = new Map<number, DetectedObject>();
  return {
    description: `改判为「${STRUCTURE_LABEL[to]}」×${ids.length}`,
    apply: (objects) => {
      return objects.map((o) => {
        if (!ids.includes(o.id)) return o;
        before.set(o.id, { ...o });
        return {
          ...o,
          type: to,
          edited: true,
          subtype: to === 'vessel' ? o.subtype : undefined,
          confidence: 1,
        };
      });
    },
    invert: (objects) =>
      objects.map((o) => {
        const old = before.get(o.id);
        return old ? { ...old } : o;
      }),
  };
}

/** 删除（隐藏）目标 */
export function deleteObjectsOp(ids: number[]): EditOp {
  const before = new Map<number, boolean>();
  return {
    description: `删除标注 ×${ids.length}`,
    apply: (objects) =>
      objects.map((o) => {
        if (!ids.includes(o.id)) return o;
        before.set(o.id, o.hidden);
        return { ...o, hidden: true, edited: true };
      }),
    invert: (objects) =>
      objects.map((o) => (before.has(o.id) ? { ...o, hidden: before.get(o.id)! } : o)),
  };
}

/** 手工新增目标（在屏幕坐标点绘制多边形，类别由调用方给） */
export function addObjectOp(obj: Omit<DetectedObject, 'id' | 'edited'>): EditOp {
  const id = nextId++;
  const full: DetectedObject = { ...obj, id, edited: true };
  return {
    description: `新增「${STRUCTURE_LABEL[obj.type]}」`,
    apply: (objects) => [...objects, full],
    invert: (objects) => objects.filter((o) => o.id !== id),
  };
}

/** 拖动多边形顶点 */
export function moveVertexOp(
  id: number,
  vertexIndex: number,
  to: { x: number; y: number },
): EditOp {
  let from: { x: number; y: number } | null = null;
  return {
    description: '调整轮廓顶点',
    apply: (objects) =>
      objects.map((o) => {
        if (o.id !== id) return o;
        from = { ...o.polygon[vertexIndex] };
        const polygon = o.polygon.map((p, i) => (i === vertexIndex ? { ...to } : p));
        return { ...o, polygon, edited: true };
      }),
    invert: (objects) =>
      objects.map((o) => {
        if (o.id !== id || !from) return o;
        const polygon = o.polygon.map((p, i) => (i === vertexIndex ? { ...from! } : p));
        return { ...o, polygon };
      }),
  };
}

/** 撤销/重做栈 */
export class EditHistory {
  private undoStack: EditOp[] = [];
  private redoStack: EditOp[] = [];

  push(op: EditOp, current: DetectedObject[]): DetectedObject[] {
    this.undoStack.push(op);
    this.redoStack = [];
    return op.apply(current.map((o) => ({ ...o })));
  }

  undo(current: DetectedObject[]): DetectedObject[] {
    const op = this.undoStack.pop();
    if (!op) return current;
    this.redoStack.push(op);
    return op.invert(current.map((o) => ({ ...o })));
  }

  redo(current: DetectedObject[]): DetectedObject[] {
    const op = this.redoStack.pop();
    if (!op) return current;
    this.undoStack.push(op);
    return op.apply(current.map((o) => ({ ...o })));
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export function editableTypes(): StructureType[] {
  return ALL_STRUCTURE_TYPES.filter((t) => t !== 'debris');
}
