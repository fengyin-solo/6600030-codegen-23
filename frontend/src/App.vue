<script setup lang="ts">
import { onMounted, computed } from 'vue';
import FEACanvas from './components/FEACanvas.vue';
import ElementInfo from './components/ElementInfo.vue';
import MeshControls from './components/MeshControls.vue';
import ProcessPlayback from './components/ProcessPlayback.vue';
import { useFEAStore } from './store/fea';

const store = useFEAStore();

const playbackStatusText = computed(() => {
  if (!store.isPlaybackMode) return null;
  const total = store.playbackSteps.length;
  const cur = store.currentStepIndex + 1;
  const phase = store.phaseProgress;
  return `回放中 ${cur}/${total} · ${phase.phaseName} ${phase.indexInPhase}/${phase.totalInPhase}`;
});

const playbackStatusColor = computed(() => {
  if (!store.currentStep) return 'text-slate-500';
  switch (store.currentStep.phase) {
    case 1: return 'text-blue-400';
    case 2: return 'text-indigo-400';
    case 3: return 'text-purple-400';
    case 4: return 'text-cyan-400';
    case 5: return 'text-emerald-400';
    case 6: return 'text-amber-400';
    case 7: return 'text-green-400';
    default: return 'text-slate-400';
  }
});

onMounted(() => {
  store.loadPreset('cantilever');
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- Header -->
    <header
      :class="[
        'border-b px-6 py-3 flex items-center justify-between transition-colors',
        store.isPlaybackMode
          ? 'bg-gradient-to-r from-indigo-950 via-purple-950 to-pink-950 border-purple-800'
          : 'bg-slate-900 border-slate-800',
      ]"
    >
      <div class="flex items-center gap-3">
        <h1
          :class="[
            'text-lg font-bold',
            store.isPlaybackMode ? 'text-purple-300' : 'text-purple-400',
          ]"
        >
          {{ store.isPlaybackMode ? '🎬 计算过程回放模式' : '🔬 有限元应力热力图可视化' }}
        </h1>
        <span
          v-if="store.isPlaybackMode"
          class="text-[10px] px-2 py-0.5 rounded-full bg-purple-700 text-purple-100 font-medium animate-pulse"
        >
          {{ store.isPlaying ? '▶ 自动播放中' : '⏸ 手动步进' }}
        </span>
      </div>
      <div class="text-xs text-slate-500">
        节点: {{ store.model.nodes.length }} |
        单元: {{ store.model.elements.length }}
        <span v-if="playbackStatusText" class="ml-3 font-mono" :class="playbackStatusColor">
          {{ playbackStatusText }}
        </span>
      </div>
    </header>

    <!-- Main content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Canvas area -->
      <div
        :class="[
          'flex-1 p-3 transition-all',
          store.isPlaybackMode ? 'w-[55%]' : 'w-[75%]',
        ]"
      >
        <FEACanvas />
      </div>

      <!-- Right sidebar -->
      <div
        :class="[
          'border-l p-3 flex flex-col gap-3 overflow-y-auto transition-all',
          store.isPlaybackMode
            ? 'w-[45%] min-w-[480px] bg-gradient-to-b from-indigo-950/40 to-slate-900 border-indigo-900/50'
            : 'w-[25%] min-w-[260px] bg-slate-900 border-slate-800',
        ]"
      >
        <ProcessPlayback v-if="store.isPlaybackMode" />
        <MeshControls />
        <ElementInfo />
      </div>
    </div>

    <!-- Bottom status bar -->
    <footer
      :class="[
        'border-t px-6 py-2 flex items-center gap-6 text-xs transition-colors',
        store.isPlaybackMode
          ? 'bg-gradient-to-r from-indigo-950/60 via-purple-950/60 to-slate-900 border-purple-900/50 text-slate-300'
          : 'bg-slate-900 border-slate-800 text-slate-400',
      ]"
    >
      <span>
        最大应力:
        <span class="text-red-400 font-bold">
          {{ store.result ? (store.maxStress / 1e6).toFixed(2) + ' MPa' : '—' }}
        </span>
      </span>
      <span>
        最大位移:
        <span class="text-amber-400 font-bold">
          {{ store.result ? (store.maxDisplacement * 1000).toFixed(3) + ' mm' : '—' }}
        </span>
      </span>
      <span>
        节点数: <span class="text-slate-200">{{ store.model.nodes.length }}</span>
      </span>
      <span>
        单元数: <span class="text-slate-200">{{ store.model.elements.length }}</span>
      </span>
      <span v-if="store.isPlaybackMode">
        回放阶段:
        <span class="font-mono" :class="playbackStatusColor">
          {{ store.phaseProgress.phaseName }}
        </span>
        <span class="text-slate-500 ml-1">
          ({{ store.phaseProgress.indexInPhase }}/{{ store.phaseProgress.totalInPhase }})
        </span>
      </span>
      <span class="ml-auto text-slate-600">
        热力图: {{ store.heatmapMode }}
      </span>
    </footer>
  </div>
</template>
