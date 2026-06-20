<script setup lang="ts">
import { computed } from 'vue';
import { useFEAStore } from '../store/fea';

const store = useFEAStore();

const PHASES = [
  { id: 1, name: '刚度矩阵组装', icon: '🧩', color: 'bg-blue-600' },
  { id: 2, name: '载荷组装', icon: '📥', color: 'bg-indigo-600' },
  { id: 3, name: '约束处理', icon: '🔒', color: 'bg-purple-600' },
  { id: 4, name: '求解方程组', icon: '🧮', color: 'bg-cyan-600' },
  { id: 5, name: '应力计算', icon: '📊', color: 'bg-emerald-600' },
  { id: 6, name: '反力计算', icon: '⚖️', color: 'bg-amber-600' },
  { id: 7, name: '完成', icon: '✅', color: 'bg-green-600' },
];

const stepTypeLabel: Record<string, string> = {
  init: '初始化',
  assemble_element: '单元组装',
  assemble_load: '载荷施加',
  apply_constraint: '约束处理',
  solve_system: '方程求解',
  compute_stress: '应力计算',
  compute_reaction: '反力计算',
  complete: '完成',
};

const currentPhase = computed(() => store.phaseProgress.phase);
const phaseName = computed(() => store.phaseProgress.phaseName);
const phaseIndex = computed(() => store.phaseProgress.indexInPhase);
const phaseTotal = computed(() => store.phaseProgress.totalInPhase);

const stepNumber = computed(() => store.currentStepIndex + 1);
const totalSteps = computed(() => store.playbackSteps.length);

const displayStressAt = computed(() => {
  const s = store.currentStep;
  if (!s?.stresses) return [];
  return s.stresses.slice(0, Math.min(6, s.stresses.length));
});

const displayU = computed(() => {
  const s = store.currentStep;
  if (!s?.U) return [];
  return s.U.slice(0, Math.min(8, s.U.length));
});

const displayF = computed(() => {
  const s = store.currentStep;
  if (!s) return [];
  return s.F.slice(0, Math.min(8, s.F.length));
});

const nonZeroK = computed(() => {
  const s = store.currentStep;
  if (!s) return { count: 0, total: 0 };
  let count = 0;
  for (const row of s.K) {
    for (const v of row) {
      if (Math.abs(v) > 1e-12) count += 1;
    }
  }
  return { count, total: s.K.length * s.K.length };
});

function onSliderChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  store.goToStep(val - 1);
}

function onSpeedChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  store.setPlaybackSpeed(val);
}

const speedLabel = computed(() => {
  const ms = store.playbackSpeed;
  if (ms <= 200) return '极快';
  if (ms <= 500) return '快速';
  if (ms <= 1000) return '正常';
  if (ms <= 2000) return '慢速';
  return '极慢';
});
</script>

<template>
  <div class="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
    <!-- Header -->
    <div class="bg-gradient-to-r from-indigo-900 via-purple-900 to-pink-900 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xl">🎬</span>
        <div>
          <h3 class="text-sm font-bold text-white">计算过程回放</h3>
          <div class="text-[10px] text-indigo-200">
            分步展示 FEA 求解全流程
          </div>
        </div>
      </div>
      <button
        @click="store.exitPlayback()"
        class="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
      >
        退出回放
      </button>
    </div>

    <!-- Phase timeline -->
    <div class="bg-slate-900 px-3 py-2 border-b border-slate-700">
      <div class="flex items-center gap-1 overflow-x-auto pb-1">
        <button
          v-for="p in PHASES"
          :key="p.id"
          @click="store.goToPhase(p.id)"
          :class="[
            'flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition',
            currentPhase >= p.id
              ? p.color + ' text-white'
              : 'bg-slate-800 text-slate-500 hover:bg-slate-700',
          ]"
        >
          <span>{{ p.icon }}</span>
          <span>{{ p.name }}</span>
        </button>
      </div>
    </div>

    <div class="p-3 space-y-3">
      <!-- Step progress -->
      <div>
        <div class="flex justify-between items-center mb-1">
          <div class="text-xs text-slate-400">
            步骤 <span class="text-white font-mono font-bold">{{ stepNumber }}</span>
            / {{ totalSteps }}
            <span class="text-slate-500 ml-2">
              · {{ phaseName }} {{ phaseIndex }}/{{ phaseTotal }}
            </span>
          </div>
          <div class="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
            {{ stepTypeLabel[store.currentStep?.type || 'init'] }}
          </div>
        </div>
        <input
          type="range"
          :min="1"
          :max="totalSteps"
          :value="stepNumber"
          @input="onSliderChange"
          class="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
      </div>

      <!-- Step title & description -->
      <div class="bg-slate-900 rounded-lg p-3 border-l-4 border-indigo-500">
        <h4 class="text-sm font-bold text-indigo-300 mb-1">
          {{ store.currentStep?.title }}
        </h4>
        <p class="text-[11px] text-slate-400 leading-relaxed">
          {{ store.currentStep?.description }}
        </p>
      </div>

      <!-- Live data panels -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-slate-900 rounded p-2">
          <div class="text-[10px] text-slate-500 mb-1">K 矩阵 非零元</div>
          <div class="text-sm font-mono font-bold text-blue-400">
            {{ nonZeroK.count.toLocaleString() }}
            <span class="text-[10px] text-slate-500">
              / {{ nonZeroK.total.toLocaleString() }}
            </span>
          </div>
        </div>
        <div class="bg-slate-900 rounded p-2">
          <div class="text-[10px] text-slate-500 mb-1">K 稀疏度</div>
          <div class="text-sm font-mono font-bold text-purple-400">
            {{ nonZeroK.total > 0 ? ((1 - nonZeroK.count / nonZeroK.total) * 100).toFixed(1) : 0 }}%
          </div>
        </div>
      </div>

      <!-- Vector previews -->
      <div class="space-y-2">
        <div class="bg-slate-900 rounded p-2">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] text-slate-500">载荷向量 F（前{{ displayF.length }}项）</span>
            <span class="text-[10px] text-slate-600">单位: N</span>
          </div>
          <div class="flex gap-1 flex-wrap">
            <span
              v-for="(v, i) in displayF"
              :key="'f' + i"
              :class="[
                'px-1.5 py-0.5 rounded text-[9px] font-mono',
                Math.abs(v) > 0.001 ? 'bg-indigo-900 text-indigo-300' : 'bg-slate-800 text-slate-600',
              ]"
            >
              F[{{ i }}]={{ v > 0 ? '+' : '' }}{{ v.toExponential(1) }}
            </span>
            <span v-if="store.currentStep?.F.length! > displayF.length" class="text-[9px] text-slate-600 self-center">
              …+{{ (store.currentStep?.F.length || 0) - displayF.length }}项
            </span>
          </div>
        </div>

        <div v-if="store.currentStep?.U" class="bg-slate-900 rounded p-2">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] text-slate-500">位移向量 U（前{{ displayU.length }}项）</span>
            <span class="text-[10px] text-slate-600">单位: m</span>
          </div>
          <div class="flex gap-1 flex-wrap">
            <span
              v-for="(v, i) in displayU"
              :key="'u' + i"
              :class="[
                'px-1.5 py-0.5 rounded text-[9px] font-mono',
                Math.abs(v) > 1e-9 ? 'bg-cyan-900 text-cyan-300' : 'bg-slate-800 text-slate-600',
              ]"
            >
              U[{{ i }}]={{ v > 0 ? '+' : '' }}{{ (v * 1000).toExponential(1) }}mm
            </span>
            <span v-if="store.currentStep?.U.length! > displayU.length" class="text-[9px] text-slate-600 self-center">
              …+{{ (store.currentStep?.U.length || 0) - displayU.length }}项
            </span>
          </div>
        </div>

        <div v-if="store.currentStep?.stresses?.length" class="bg-slate-900 rounded p-2">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] text-slate-500">单元应力 σ（前{{ displayStressAt.length }}个）</span>
            <span class="text-[10px] text-slate-600">单位: MPa</span>
          </div>
          <div class="flex gap-1 flex-wrap">
            <span
              v-for="(v, i) in displayStressAt"
              :key="'s' + i"
              :class="[
                'px-1.5 py-0.5 rounded text-[9px] font-mono',
                v >= 0 ? 'bg-red-900 text-red-300' : 'bg-blue-900 text-blue-300',
              ]"
            >
              #{{ i }}:{{ (v / 1e6).toFixed(1) }}
            </span>
            <span v-if="store.currentStep?.stresses.length! > displayStressAt.length" class="text-[9px] text-slate-600 self-center">
              …+{{ (store.currentStep?.stresses.length || 0) - displayStressAt.length }}个
            </span>
          </div>
        </div>
      </div>

      <!-- Reaction forces -->
      <div v-if="store.currentStep?.reactionForces?.length" class="bg-slate-900 rounded p-2">
        <div class="text-[10px] text-slate-500 mb-1">支座反力</div>
        <div class="space-y-1">
          <div
            v-for="r in store.currentStep!.reactionForces"
            :key="r.nodeId"
            class="flex items-center justify-between px-2 py-1 rounded bg-amber-900/30 text-[10px]"
          >
            <span class="text-amber-400 font-mono">节点 #{{ r.nodeId }}</span>
            <span class="text-slate-300 font-mono">
              Rx={{ (r.fx / 1000).toFixed(2) }}kN · Ry={{ (r.fy / 1000).toFixed(2) }}kN
            </span>
          </div>
        </div>
      </div>

      <!-- Playback controls -->
      <div class="border-t border-slate-700 pt-3 space-y-2">
        <!-- Speed control -->
        <div>
          <div class="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>播放速度</span>
            <span class="text-indigo-400 font-mono">{{ speedLabel }} · {{ store.playbackSpeed }}ms</span>
          </div>
          <input
            type="range"
            min="100"
            max="4000"
            step="100"
            :value="store.playbackSpeed"
            @input="onSpeedChange"
            class="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
          />
        </div>

        <!-- Control buttons -->
        <div class="flex items-center gap-1">
          <button
            @click="store.goToStep(0)"
            :disabled="stepNumber === 1"
            class="flex-1 py-1.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            ⏮ 首步
          </button>
          <button
            @click="store.prevStep()"
            :disabled="stepNumber === 1"
            class="flex-1 py-1.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            ◀ 上一步
          </button>
          <button
            @click="store.togglePlayback()"
            :class="[
              'flex-1 py-1.5 rounded text-[11px] font-bold transition',
              store.isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white',
            ]"
          >
            {{ store.isPlaying ? '⏸ 暂停' : '▶ 播放' }}
          </button>
          <button
            @click="store.nextStep()"
            :disabled="stepNumber === totalSteps"
            class="flex-1 py-1.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            下一步 ▶
          </button>
          <button
            @click="store.goToStep(totalSteps - 1)"
            :disabled="stepNumber === totalSteps"
            class="flex-1 py-1.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            末步 ⏭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
