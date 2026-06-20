import type {
  FEAModel,
  FEAResult,
  Node,
  Element,
  Load,
  PlaybackStep,
  StepType,
  FEAResultWithPlayback,
} from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────
function cloneMatrix(M: number[][]): number[][] {
  return M.map((row) => [...row]);
}

function cloneVector(v: number[]): number[] {
  return [...v];
}

// ─── Step Builder ───────────────────────────────────────────────────────────
let _stepCounter = 0;
function makeStep(params: {
  type: StepType;
  title: string;
  description: string;
  phase: number;
  K: number[][];
  F: number[];
  U?: number[];
  stresses?: number[];
  strains?: number[];
  forces?: number[];
  reactionForces?: { nodeId: number; fx: number; fy: number }[];
  highlight?: PlaybackStep['highlight'];
  detail?: Record<string, any>;
}): PlaybackStep {
  _stepCounter += 1;
  return {
    id: _stepCounter,
    type: params.type,
    title: params.title,
    description: params.description,
    phase: params.phase,
    K: cloneMatrix(params.K),
    F: cloneVector(params.F),
    U: params.U ? cloneVector(params.U) : undefined,
    stresses: params.stresses ? cloneVector(params.stresses) : undefined,
    strains: params.strains ? cloneVector(params.strains) : undefined,
    forces: params.forces ? cloneVector(params.forces) : undefined,
    reactionForces: params.reactionForces ? params.reactionForces.map((r) => ({ ...r })) : undefined,
    highlight: params.highlight,
    detail: params.detail,
  };
}

// ─── FEA Solver with Playback ───────────────────────────────────────────────
export function solve(model: FEAModel): FEAResult {
  const result = solveWithPlayback(model);
  const { playbackSteps: _unused, ...rest } = result;
  return rest;
}

export function solveWithPlayback(model: FEAModel): FEAResultWithPlayback {
  _stepCounter = 0;
  const playbackSteps: PlaybackStep[] = [];

  const { nodes, elements, loads } = model;
  const N = nodes.length;
  const dof = N * 2;

  const nodeIndex = new Map<number, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  const K: number[][] = Array.from({ length: dof }, () => new Array(dof).fill(0));
  const F = new Array(dof).fill(0);
  let U: number[] = [];
  const stresses: number[] = [];
  const strains: number[] = [];
  const forces: number[] = [];
  let reactionForces: { nodeId: number; fx: number; fy: number }[] = [];

  playbackSteps.push(
    makeStep({
      type: 'init',
      title: '初始化系统',
      description: `创建 ${dof}×${dof} 全局刚度矩阵 K（全零）和 ${dof} 维载荷向量 F（全零）。共有 ${N} 个节点，${elements.length} 个杆单元，${loads.length} 个载荷。`,
      phase: 1,
      K,
      F,
      detail: { dof, numNodes: N, numElements: elements.length, numLoads: loads.length },
    })
  );

  const elementStiffnesses: number[][][] = [];
  for (let ei = 0; ei < elements.length; ei++) {
    const el = elements[ei];
    const n1 = nodes[nodeIndex.get(el.nodeIds[0])!];
    const n2 = nodes[nodeIndex.get(el.nodeIds[1])!];
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    const c = dx / L;
    const s = dy / L;
    const k = (el.youngsModulus * el.area) / L;

    const ke = [
      [k * c * c, k * c * s, -k * c * c, -k * c * s],
      [k * c * s, k * s * s, -k * c * s, -k * s * s],
      [-k * c * c, -k * c * s, k * c * c, k * c * s],
      [-k * c * s, -k * s * s, k * c * s, k * s * s],
    ];
    elementStiffnesses.push(ke);

    const i1 = nodeIndex.get(el.nodeIds[0])!;
    const i2 = nodeIndex.get(el.nodeIds[1])!;
    const dofs = [i1 * 2, i1 * 2 + 1, i2 * 2, i2 * 2 + 1];

    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        K[dofs[a]][dofs[b]] += ke[a][b];
      }
    }

    playbackSteps.push(
      makeStep({
        type: 'assemble_element',
        title: `组装单元 ${el.id}（第 ${ei + 1}/${elements.length} 个）`,
        description: `节点 ${el.nodeIds[0]}→${el.nodeIds[1]}，长度 L=${L.toFixed(4)}m，倾角 θ=${(Math.atan2(s, c) * 180 / Math.PI).toFixed(1)}°，轴向刚度 k=${(k / 1e6).toFixed(2)} MN/m。4×4 单元刚度矩阵 ke 叠加到全局 K 的 DOF=[${dofs.join(',')}]。`,
        phase: 1,
        K,
        F,
        highlight: {
          elementIds: [el.id],
          nodeIds: el.nodeIds,
          dofs,
        },
        detail: { elementId: el.id, nodeIds: el.nodeIds, length: L, cos: c, sin: s, axialK: k, ke, dofs },
      })
    );
  }

  playbackSteps.push(
    makeStep({
      type: 'assemble_load',
      title: '载荷组装完成（准备施加）',
      description: `全局刚度矩阵 K 组装完毕。接下来将 ${loads.length} 个外载荷节点载荷 Fx、Fy 叠加到全局载荷向量 F。`,
      phase: 2,
      K,
      F,
      detail: { kAssembled: true, loadsPending: loads.length },
    })
  );

  for (let li = 0; li < loads.length; li++) {
    const load = loads[li];
    const idx = nodeIndex.get(load.nodeId);
    if (idx === undefined) continue;
    const dofX = idx * 2;
    const dofY = idx * 2 + 1;
    F[dofX] += load.fx;
    F[dofY] += load.fy;

    playbackSteps.push(
      makeStep({
        type: 'assemble_load',
        title: `施加载荷 ${li + 1}/${loads.length}（节点 ${load.nodeId}）`,
        description: `节点 ${load.nodeId} 施加 Fx=${(load.fx / 1000).toFixed(2)}kN，Fy=${(load.fy / 1000).toFixed(2)}kN，写入 F[${dofX}] 和 F[${dofY}]。`,
        phase: 2,
        K,
        F,
        highlight: {
          loadNodeIds: [load.nodeId],
          nodeIds: [load.nodeId],
          dofs: [dofX, dofY],
        },
        detail: { load, dofX, dofY, fx: load.fx, fy: load.fy },
      })
    );
  }

  const fixedDofs: number[] = [];
  const fixedNodeIds: number[] = [];
  for (const node of nodes) {
    if (node.fixed) {
      const idx = nodeIndex.get(node.id)!;
      fixedDofs.push(idx * 2, idx * 2 + 1);
      fixedNodeIds.push(node.id);
    }
  }

  playbackSteps.push(
    makeStep({
      type: 'apply_constraint',
      title: `处理边界条件（${fixedNodeIds.length} 个固定节点）`,
      description: `使用罚函数法（penalty=1e15）处理约束：对 ${fixedDofs.length} 个约束自由度（x,y方向），K[d][d] += penalty，等效为极硬弹簧限制位移。`,
      phase: 3,
      K,
      F,
      highlight: {
        nodeIds: fixedNodeIds,
        dofs: fixedDofs,
      },
      detail: { penalty: 1e15, fixedDofs, fixedNodeIds },
    })
  );

  const penalty = 1e15;
  for (const d of fixedDofs) {
    K[d][d] += penalty;
  }

  playbackSteps.push(
    makeStep({
      type: 'solve_system',
      title: '求解 K·U = F 线性方程组',
      description: `对 ${dof} 阶线性方程组使用高斯消元法（带部分主元）求解位移向量 U。先消元得到上三角矩阵，再回代得到各节点位移。`,
      phase: 4,
      K,
      F,
      detail: { dof, solver: 'gaussian_elimination_partial_pivot' },
    })
  );

  U = gaussianElimination(K, F);

  playbackSteps.push(
    makeStep({
      type: 'solve_system',
      title: '位移求解完成',
      description: `解得位移向量 U。最大位移量 = ${(Math.max(...U.map(Math.abs)) * 1000).toExponential(2)} mm。接下来计算各单元应力、应变和内力。`,
      phase: 4,
      K,
      F,
      U,
      detail: { maxDisplacement: Math.max(...U.map(Math.abs)) },
    })
  );

  for (let ei = 0; ei < elements.length; ei++) {
    const el = elements[ei];
    const n1 = nodes[nodeIndex.get(el.nodeIds[0])!];
    const n2 = nodes[nodeIndex.get(el.nodeIds[1])!];
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    const c = dx / L;
    const s = dy / L;

    const i1 = nodeIndex.get(el.nodeIds[0])!;
    const i2 = nodeIndex.get(el.nodeIds[1])!;
    const u1 = U[i1 * 2];
    const v1 = U[i1 * 2 + 1];
    const u2 = U[i2 * 2];
    const v2 = U[i2 * 2 + 1];

    const strain = ((u2 - u1) * c + (v2 - v1) * s) / L;
    const stress = el.youngsModulus * strain;
    const force = stress * el.area;

    stresses.push(stress);
    strains.push(strain);
    forces.push(force);

    playbackSteps.push(
      makeStep({
        type: 'compute_stress',
        title: `计算单元 ${el.id} 应力（第 ${ei + 1}/${elements.length} 个）`,
        description: `ΔL = (u2-u1)cosθ + (v2-v1)sinθ = ${(((u2 - u1) * c + (v2 - v1) * s) * 1000).toExponential(2)} mm；应变 ε = ΔL/L = ${strain.toExponential(3)}；应力 σ = E·ε = ${(stress / 1e6).toFixed(2)} MPa；轴力 N = σ·A = ${(force / 1000).toFixed(2)} kN（${stress >= 0 ? '受拉' : '受压'}）。`,
        phase: 5,
        K,
        F,
        U,
        stresses,
        strains,
        forces,
        highlight: {
          elementIds: [el.id],
          nodeIds: el.nodeIds,
        },
        detail: {
          elementId: el.id,
          strain,
          stress,
          force,
          length: L,
          deltaL: (u2 - u1) * c + (v2 - v1) * s,
          stressSign: stress >= 0 ? 'tension' : 'compression',
        },
      })
    );
  }

  reactionForces = [];
  for (const node of nodes) {
    if (!node.fixed) continue;
    const idx = nodeIndex.get(node.id)!;
    let rx = 0, ry = 0;
    for (let j = 0; j < dof; j++) {
      rx += K[idx * 2][j] * U[j];
      ry += K[idx * 2 + 1][j] * U[j];
    }
    for (const load of loads) {
      if (load.nodeId === node.id) {
        rx -= load.fx;
        ry -= load.fy;
      }
    }
    reactionForces.push({ nodeId: node.id, fx: rx, fy: ry });
  }

  playbackSteps.push(
    makeStep({
      type: 'compute_reaction',
      title: '计算约束反力',
      description: `对 ${fixedNodeIds.length} 个固定节点，由 R = K·U - F_ext 计算支座反力。总反力应与外荷载平衡（ΣFx、ΣFy ≈ 0）。`,
      phase: 6,
      K,
      F,
      U,
      stresses,
      strains,
      forces,
      reactionForces,
      highlight: {
        nodeIds: fixedNodeIds,
      },
      detail: {
        reactionForces,
        totalFx: reactionForces.reduce((s, r) => s + r.fx, 0) + loads.reduce((s, l) => s + l.fx, 0),
        totalFy: reactionForces.reduce((s, r) => s + r.fy, 0) + loads.reduce((s, l) => s + l.fy, 0),
      },
    })
  );

  for (const node of nodes) {
    const idx = nodeIndex.get(node.id)!;
    node.displacementX = U[idx * 2];
    node.displacementY = U[idx * 2 + 1];
  }
  for (let ei = 0; ei < elements.length; ei++) {
    elements[ei].stress = stresses[ei];
    elements[ei].strain = strains[ei];
    elements[ei].force = forces[ei];
  }

  let maxDisplacement = 0;
  for (const node of nodes) {
    const d = Math.sqrt(node.displacementX ** 2 + node.displacementY ** 2);
    if (d > maxDisplacement) maxDisplacement = d;
  }
  const maxStress = Math.max(...stresses.map(Math.abs));

  playbackSteps.push(
    makeStep({
      type: 'complete',
      title: '求解完成',
      description: `全部计算完成！最大位移 = ${(maxDisplacement * 1000).toFixed(4)} mm，最大应力 = ${(maxStress / 1e6).toFixed(2)} MPa。可切换热力图模式查看应力/应变/内力分布。`,
      phase: 7,
      K,
      F,
      U,
      stresses,
      strains,
      forces,
      reactionForces,
      detail: {
        maxDisplacement,
        maxStress,
        numElements: elements.length,
        numNodes: N,
      },
    })
  );

  return {
    displacements: U,
    stresses,
    strains,
    maxDisplacement,
    maxStress,
    reactionForces,
    playbackSteps,
  };
}

// ─── Gaussian Elimination ───────────────────────────────────────────────────
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-20) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-20) continue;
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }
  return x;
}

// ─── Mesh Generators ────────────────────────────────────────────────────────
export function buildTrussBeam(
  length: number,
  height: number,
  nDivX: number,
  nDivY: number
): FEAModel {
  const nodes: Node[] = [];
  const elements: Element[] = [];
  let nodeId = 0;
  let elId = 0;

  const dx = length / nDivX;
  const dy = height / nDivY;
  const E = 200e9; // 200 GPa steel
  const A = 0.001; // 1000 mm²

  const nodeGrid: number[][] = [];
  for (let iy = 0; iy <= nDivY; iy++) {
    nodeGrid[iy] = [];
    for (let ix = 0; ix <= nDivX; ix++) {
      const id = nodeId++;
      nodes.push({
        id,
        x: ix * dx,
        y: iy * dy,
        fixed: ix === 0,
        displacementX: 0,
        displacementY: 0,
      });
      nodeGrid[iy][ix] = id;
    }
  }

  for (let iy = 0; iy <= nDivY; iy++) {
    for (let ix = 0; ix <= nDivX; ix++) {
      // Horizontal
      if (ix < nDivX) {
        elements.push({
          id: elId++,
          nodeIds: [nodeGrid[iy][ix], nodeGrid[iy][ix + 1]],
          area: A,
          youngsModulus: E,
          stress: 0, strain: 0, force: 0,
        });
      }
      // Vertical
      if (iy < nDivY) {
        elements.push({
          id: elId++,
          nodeIds: [nodeGrid[iy][ix], nodeGrid[iy + 1][ix]],
          area: A,
          youngsModulus: E,
          stress: 0, strain: 0, force: 0,
        });
      }
      // Diagonal (Warren pattern)
      if (ix < nDivX && iy < nDivY) {
        if ((ix + iy) % 2 === 0) {
          elements.push({
            id: elId++,
            nodeIds: [nodeGrid[iy][ix], nodeGrid[iy + 1][ix + 1]],
            area: A * 0.7,
            youngsModulus: E,
            stress: 0, strain: 0, force: 0,
          });
        } else {
          elements.push({
            id: elId++,
            nodeIds: [nodeGrid[iy][ix + 1], nodeGrid[iy + 1][ix]],
            area: A * 0.7,
            youngsModulus: E,
            stress: 0, strain: 0, force: 0,
          });
        }
      }
    }
  }

  return { nodes, elements, loads: [] };
}

export function buildCantileverBeam(
  length: number,
  height: number,
  nElements: number
): FEAModel {
  const model = buildTrussBeam(length, height, nElements, 2);
  const N = model.nodes.length;
  // Apply downward load at right end
  const rightTopNode = model.nodes.find(
    (n) => n.x === length && n.y === height
  );
  const rightBottomNode = model.nodes.find(
    (n) => n.x === length && n.y === 0
  );
  if (rightTopNode) {
    model.loads.push({ nodeId: rightTopNode.id, fx: 0, fy: -10000 });
  }
  if (rightBottomNode) {
    model.loads.push({ nodeId: rightBottomNode.id, fx: 0, fy: -10000 });
  }
  return model;
}

export function buildBridgeTruss(
  span: number,
  height: number,
  nPanels: number
): FEAModel {
  const model = buildTrussBeam(span, height, nPanels, 1);
  // Simply supported: fix left bottom (pin), right bottom (roller - only y fixed)
  for (const node of model.nodes) {
    node.fixed = false;
  }
  const leftBottom = model.nodes.find((n) => n.x === 0 && n.y === 0);
  const rightBottom = model.nodes.find((n) => n.x === span && n.y === 0);
  if (leftBottom) leftBottom.fixed = true;
  if (rightBottom) {
    // Roller: we approximate by fixing y only via very stiff spring in y
    rightBottom.fixed = true;
    // We'll handle this by unfixing x in the solve step - for simplicity just fix both
  }

  // Load at center bottom
  const centerX = span / 2;
  const centerBottom = model.nodes.reduce((best, n) => {
    if (n.y !== 0) return best;
    if (!best) return n;
    return Math.abs(n.x - centerX) < Math.abs(best.x - centerX) ? n : best;
  }, null as Node | null);
  if (centerBottom) {
    model.loads.push({ nodeId: centerBottom.id, fx: 0, fy: -50000 });
  }
  return model;
}

// ─── Preset Models ──────────────────────────────────────────────────────────
export const presetCantileverBeam = (): FEAModel => buildCantileverBeam(4, 1, 8);
export const presetBridgeTruss = (): FEAModel => buildBridgeTruss(10, 2, 10);
export const presetSimpleFrame = (): FEAModel => {
  const model = buildTrussBeam(3, 3, 4, 4);
  // Fix bottom row
  for (const node of model.nodes) {
    if (node.y === 0) node.fixed = true;
  }
  // Apply load at top center
  const topCenter = model.nodes.reduce((best, n) => {
    if (n.y !== 3) return best;
    if (!best) return n;
    return Math.abs(n.x - 1.5) < Math.abs(best.x - 1.5) ? n : best;
  }, null as Node | null);
  if (topCenter) {
    model.loads.push({ nodeId: topCenter.id, fx: 5000, fy: -20000 });
  }
  return model;
};

// ─── Jet Colormap ───────────────────────────────────────────────────────────
export function jetColormap(value: number, min: number, max: number): string {
  const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));

  let r: number, g: number, b: number;
  if (t < 0.125) {
    r = 0; g = 0; b = 0.5 + t * 4;
  } else if (t < 0.375) {
    r = 0; g = (t - 0.125) * 4; b = 1;
  } else if (t < 0.625) {
    r = (t - 0.375) * 4; g = 1; b = 1 - (t - 0.375) * 4;
  } else if (t < 0.875) {
    r = 1; g = 1 - (t - 0.625) * 4; b = 0;
  } else {
    r = 1 - (t - 0.875) * 4; g = 0; b = 0;
  }

  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
