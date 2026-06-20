import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { FEAModel, FEAResult, PlaybackStep } from '../types';
import {
  solve as feaSolve,
  solveWithPlayback,
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  jetColormap,
} from '../utils/fea-solver';

const PHASE_NAMES: Record<number, string> = {
  1: '刚度矩阵组装',
  2: '载荷组装',
  3: '约束处理',
  4: '求解方程组',
  5: '应力应变计算',
  6: '反力计算',
  7: '完成',
};

export const useFEAStore = defineStore('fea', () => {
  const model = ref<FEAModel>({ nodes: [], elements: [], loads: [] });
  const result = ref<FEAResult | null>(null);
  const selectedPreset = ref<string>('cantilever');
  const showDeformed = ref(false);
  const deformationScale = ref(10);
  const selectedElement = ref<number | null>(null);
  const heatmapMode = ref<'stress' | 'strain' | 'force'>('stress');

  const playbackSteps = ref<PlaybackStep[]>([]);
  const currentStepIndex = ref(-1);
  const isPlaying = ref(false);
  const playbackSpeed = ref(1000);
  let playTimer: ReturnType<typeof setTimeout> | null = null;

  const currentStep = computed<PlaybackStep | null>(() => {
    if (currentStepIndex.value < 0 || currentStepIndex.value >= playbackSteps.value.length) {
      return null;
    }
    return playbackSteps.value[currentStepIndex.value];
  });

  const isPlaybackMode = computed(() => playbackSteps.value.length > 0 && currentStepIndex.value >= 0);

  const playbackProgress = computed(() => {
    if (playbackSteps.value.length === 0) return 0;
    return (currentStepIndex.value + 1) / playbackSteps.value.length;
  });

  const phaseProgress = computed(() => {
    if (!currentStep.value) return { phase: 0, phaseName: '就绪', totalInPhase: 0, indexInPhase: 0 };
    const phase = currentStep.value.phase;
    const phaseName = PHASE_NAMES[phase] || '未知';
    const phaseSteps = playbackSteps.value.filter((s) => s.phase === phase);
    const indexInPhase = phaseSteps.findIndex((s) => s.id === currentStep.value!.id) + 1;
    return { phase, phaseName, totalInPhase: phaseSteps.length, indexInPhase };
  });

  const playbackElementColors = computed(() => {
    const colors = new Map<number, string>();
    const step = currentStep.value;
    if (!step) return colors;

    const hl = step.highlight;
    const hlElementIds = new Set(hl?.elementIds || []);
    const hlNodeIds = new Set(hl?.nodeIds || []);
    const hlDofs = new Set(hl?.dofs || []);
    const hlLoadNodeIds = new Set(hl?.loadNodeIds || []);

    for (const el of model.value.elements) {
      let color = '#334155';
      if (step.stresses && step.stresses[el.id] !== undefined) {
        const values = step.type === 'compute_stress' || step.phase >= 5
          ? step.stresses.map(Math.abs)
          : [];
        if (values.length > 0) {
          const min = Math.min(...values);
          const max = Math.max(...values);
          const s = Math.abs(step.stresses[el.id]);
          color = jetColormap(s, min, max);
        }
      }
      if (hlElementIds.has(el.id)) {
        color = '#facc15';
      }
      colors.set(el.id, color);
    }
    return { colors, hlElementIds, hlNodeIds, hlDofs, hlLoadNodeIds };
  });

  function clearPlayTimer() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  function resetPlayback() {
    stopPlayback();
    playbackSteps.value = [];
    currentStepIndex.value = -1;
  }

  function solveWithSteps() {
    resetPlayback();
    const fullResult = solveWithPlayback(model.value);
    const { playbackSteps: steps, ...rest } = fullResult;
    result.value = rest;
    playbackSteps.value = steps;
    currentStepIndex.value = 0;
  }

  function solve() {
    result.value = feaSolve(model.value);
    resetPlayback();
  }

  function nextStep() {
    if (currentStepIndex.value < playbackSteps.value.length - 1) {
      currentStepIndex.value += 1;
    } else {
      stopPlayback();
    }
  }

  function prevStep() {
    if (currentStepIndex.value > 0) {
      currentStepIndex.value -= 1;
    }
  }

  function goToStep(index: number) {
    currentStepIndex.value = Math.max(0, Math.min(playbackSteps.value.length - 1, index));
  }

  function goToPhase(phase: number) {
    const idx = playbackSteps.value.findIndex((s) => s.phase === phase);
    if (idx >= 0) currentStepIndex.value = idx;
  }

  function startPlayback() {
    if (playbackSteps.value.length === 0) return;
    if (currentStepIndex.value < 0) currentStepIndex.value = 0;
    if (currentStepIndex.value >= playbackSteps.value.length - 1) {
      currentStepIndex.value = 0;
    }
    isPlaying.value = true;
    scheduleNext();
  }

  function scheduleNext() {
    clearPlayTimer();
    if (!isPlaying.value) return;
    playTimer = setTimeout(() => {
      if (currentStepIndex.value < playbackSteps.value.length - 1) {
        currentStepIndex.value += 1;
        scheduleNext();
      } else {
        isPlaying.value = false;
      }
    }, playbackSpeed.value);
  }

  function stopPlayback() {
    isPlaying.value = false;
    clearPlayTimer();
  }

  function togglePlayback() {
    if (isPlaying.value) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function exitPlayback() {
    stopPlayback();
    currentStepIndex.value = -1;
  }

  function setPlaybackSpeed(ms: number) {
    playbackSpeed.value = Math.max(100, Math.min(5000, ms));
    if (isPlaying.value) scheduleNext();
  }

  watch(
    () => [isPlaying.value, playbackSpeed.value],
    () => {
      if (isPlaying.value) scheduleNext();
    }
  );

  // ─── Actions ──────────────────────────────────────────────────────────────
  function loadPreset(name: string) {
    selectedPreset.value = name;
    result.value = null;
    selectedElement.value = null;
    resetPlayback();
    switch (name) {
      case 'cantilever':
        model.value = presetCantileverBeam();
        break;
      case 'bridge':
        model.value = presetBridgeTruss();
        break;
      case 'frame':
        model.value = presetSimpleFrame();
        break;
      default:
        model.value = presetCantileverBeam();
    }
  }

  function toggleDeformed() {
    showDeformed.value = !showDeformed.value;
  }

  function selectElement(id: number | null) {
    selectedElement.value = id;
  }

  function setHeatmapMode(mode: 'stress' | 'strain' | 'force') {
    heatmapMode.value = mode;
  }

  function addLoad(nodeId: number, fx: number, fy: number) {
    model.value.loads.push({ nodeId, fx, fy });
  }

  function toggleFixed(nodeId: number) {
    const node = model.value.nodes.find((n) => n.id === nodeId);
    if (node) node.fixed = !node.fixed;
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const maxStress = computed(() => {
    if (!result.value) return 0;
    return result.value.maxStress;
  });

  const maxDisplacement = computed(() => {
    if (!result.value) return 0;
    return result.value.maxDisplacement;
  });

  const elementColors = computed(() => {
    const colors = new Map<number, string>();
    if (!result.value || model.value.elements.length === 0) {
      for (const el of model.value.elements) {
        colors.set(el.id, '#6b7280');
      }
      return colors;
    }

    let values: number[];
    switch (heatmapMode.value) {
      case 'stress':
        values = result.value.stresses.map(Math.abs);
        break;
      case 'strain':
        values = result.value.strains.map(Math.abs);
        break;
      case 'force':
        values = model.value.elements.map((e) => Math.abs(e.force));
        break;
      default:
        values = result.value.stresses.map(Math.abs);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    for (let i = 0; i < model.value.elements.length; i++) {
      colors.set(
        model.value.elements[i].id,
        jetColormap(values[i], min, max)
      );
    }
    return colors;
  });

  return {
    model,
    result,
    selectedPreset,
    showDeformed,
    deformationScale,
    selectedElement,
    heatmapMode,
    playbackSteps,
    currentStepIndex,
    isPlaying,
    playbackSpeed,
    currentStep,
    isPlaybackMode,
    playbackProgress,
    phaseProgress,
    playbackElementColors,
    maxStress,
    maxDisplacement,
    elementColors,
    loadPreset,
    solve,
    solveWithSteps,
    toggleDeformed,
    selectElement,
    setHeatmapMode,
    addLoad,
    toggleFixed,
    nextStep,
    prevStep,
    goToStep,
    goToPhase,
    startPlayback,
    stopPlayback,
    togglePlayback,
    exitPlayback,
    setPlaybackSpeed,
    resetPlayback,
  };
});
