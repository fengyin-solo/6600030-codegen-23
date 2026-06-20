export interface Node {
  id: number;
  x: number;
  y: number;
  fixed: boolean;       // boundary condition
  displacementX: number;
  displacementY: number;
}

export interface Element {
  id: number;
  nodeIds: [number, number];  // 2-node truss element
  area: number;               // cross-section area (m²)
  youngsModulus: number;      // Pa
  stress: number;             // computed
  strain: number;             // computed
  force: number;              // computed
}

export interface Load {
  nodeId: number;
  fx: number;   // force X component (N)
  fy: number;   // force Y component (N)
}

export interface FEAModel {
  nodes: Node[];
  elements: Element[];
  loads: Load[];
}

export interface FEAResult {
  displacements: number[];    // global displacement vector
  stresses: number[];          // per-element stress
  strains: number[];           // per-element strain
  maxDisplacement: number;
  maxStress: number;
  reactionForces: { nodeId: number; fx: number; fy: number }[];
}

export type StepType =
  | 'init'
  | 'assemble_element'
  | 'assemble_load'
  | 'apply_constraint'
  | 'solve_system'
  | 'compute_stress'
  | 'compute_reaction'
  | 'complete';

export interface PlaybackStep {
  id: number;
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
  highlight?: {
    elementIds?: number[];
    nodeIds?: number[];
    dofs?: number[];
    loadNodeIds?: number[];
  };
  detail?: Record<string, any>;
}

export interface FEAResultWithPlayback extends FEAResult {
  playbackSteps: PlaybackStep[];
}
