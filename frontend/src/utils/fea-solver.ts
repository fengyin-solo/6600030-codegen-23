import type { FEAModel, FEAResult, Node, Element, Load } from '../types';

// ─── FEA Solver ─────────────────────────────────────────────────────────────
export function solve(model: FEAModel): FEAResult {
  const { nodes, elements, loads } = model;
  const N = nodes.length;
  const dof = N * 2;

  // Build node id -> index map
  const nodeIndex = new Map<number, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));

  // Initialize global stiffness matrix K and force vector F
  const K: number[][] = Array.from({ length: dof }, () => new Array(dof).fill(0));
  const F = new Array(dof).fill(0);

  // Assemble element stiffness matrices
  const elementStiffnesses: number[][][] = [];
  for (const el of elements) {
    const n1 = nodes[nodeIndex.get(el.nodeIds[0])!];
    const n2 = nodes[nodeIndex.get(el.nodeIds[1])!];
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    const c = dx / L;
    const s = dy / L;
    const k = (el.youngsModulus * el.area) / L;

    // 4x4 element stiffness matrix
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
  }

  // Build force vector
  for (const load of loads) {
    const idx = nodeIndex.get(load.nodeId);
    if (idx === undefined) continue;
    F[idx * 2] += load.fx;
    F[idx * 2 + 1] += load.fy;
  }

  // Apply boundary conditions using penalty method
  const penalty = 1e15;
  const fixedDofs: number[] = [];
  for (const node of nodes) {
    if (node.fixed) {
      const idx = nodeIndex.get(node.id)!;
      fixedDofs.push(idx * 2, idx * 2 + 1);
    }
  }
  for (const d of fixedDofs) {
    K[d][d] += penalty;
  }

  // Solve K * U = F using Gaussian elimination
  const U = gaussianElimination(K, F);

  // Compute element stresses, strains, forces
  const stresses: number[] = [];
  const strains: number[] = [];
  const forces: number[] = [];

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

    el.stress = stress;
    el.strain = strain;
    el.force = force;
  }

  // Update node displacements
  for (const node of nodes) {
    const idx = nodeIndex.get(node.id)!;
    node.displacementX = U[idx * 2];
    node.displacementY = U[idx * 2 + 1];
  }

  // Compute max values
  let maxDisplacement = 0;
  for (const node of nodes) {
    const d = Math.sqrt(node.displacementX ** 2 + node.displacementY ** 2);
    if (d > maxDisplacement) maxDisplacement = d;
  }
  const maxStress = Math.max(...stresses.map(Math.abs));

  // Compute reaction forces at fixed nodes
  const reactionForces: { nodeId: number; fx: number; fy: number }[] = [];
  for (const node of nodes) {
    if (!node.fixed) continue;
    const idx = nodeIndex.get(node.id)!;
    let rx = 0, ry = 0;
    for (let j = 0; j < dof; j++) {
      rx += K[idx * 2][j] * U[j];
      ry += K[idx * 2 + 1][j] * U[j];
    }
    // subtract applied loads
    for (const load of loads) {
      if (load.nodeId === node.id) {
        rx -= load.fx;
        ry -= load.fy;
      }
    }
    reactionForces.push({ nodeId: node.id, fx: rx, fy: ry });
  }

  return {
    displacements: U,
    stresses,
    strains,
    maxDisplacement,
    maxStress,
    reactionForces,
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
