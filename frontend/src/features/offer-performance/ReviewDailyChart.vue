<script setup lang="ts">
import { computed, ref } from "vue";
import type { PerformanceRow, PromotionWindow } from "./performanceModel";
import { reviewDays } from "./reviewModel";
const props = defineProps<{
  rows: PerformanceRow[];
  range: PromotionWindow;
  through: string;
  recommendation: string;
  language: string;
}>();
const metric = ref<"clicks" | "revenue">("clicks"),
  selected = ref("");
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const points = computed(() =>
  reviewDays(props.rows, props.range, props.through, metric.value),
);
const max = computed(() =>
  Math.max(1, ...points.value.map((p) => Math.abs(p.value || 0))),
);
const width = computed(() => Math.max(840, points.value.length * 25 + 100));
const step = computed(() => (width.value - 100) / points.value.length);
const chosen = computed(() =>
  points.value.find((p) => p.date === selected.value),
);
const number = (v: number | null) =>
  v === null
    ? "—"
    : new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
        maximumFractionDigits: 2,
      }).format(v);
const pointLabel = (p: (typeof points.value)[number]) =>
  `${p.date} · ${p.period === "gap" ? t("非观察期", "Outside windows") : p.period === "before" ? t("推荐前", "Before") : t("推荐后", "After")} · ${number(p.value)}`;
</script>
<template>
  <section class="promotion-panel review-chart">
    <div class="review-toolbar">
      <div>
        <h3>{{ t("所有日期的变化", "Daily changes across both windows") }}</h3>
        <p>
          {{
            t(
              "灰蓝：推荐前 · 蓝色：推荐后 · 虚线：推荐日。空白日期不等于 0。",
              "Slate: before · Blue: after · Dashed line: recommendation. Blank is not zero.",
            )
          }}
        </p>
      </div>
      <div class="review-tabs">
        <button :aria-pressed="metric === 'clicks'" @click="metric = 'clicks'">
          {{ t("点击量", "Clicks") }}</button
        ><button
          :aria-pressed="metric === 'revenue'"
          @click="metric = 'revenue'"
        >
          Revenue (USD)
        </button>
      </div>
    </div>
    <div class="promotion-scroll">
      <svg
        :viewBox="`0 0 ${width} 320`"
        :style="{ minWidth: `${width}px` }"
        role="group"
        :aria-label="t('前后期每日柱状图', 'Before and after daily bar chart')"
      >
        <g v-for="fraction in [0, 0.5, 1]" :key="fraction">
          <line
            x1="75"
            :x2="width - 20"
            :y1="145 - fraction * 110"
            :y2="145 - fraction * 110"
            stroke="var(--pp-line)"
            stroke-dasharray="4 4"
          />
          <text x="68" :y="150 - fraction * 110" text-anchor="end">
            {{ number(max * fraction) }}
          </text>
        </g>
        <g
          v-for="(p, i) in points"
          :key="p.date"
          tabindex="0"
          role="button"
          :aria-label="pointLabel(p)"
          @click="selected = p.date"
          @keydown.enter="selected = p.date"
          @keydown.space.prevent="selected = p.date"
          @focus="selected = p.date"
          @mouseenter="selected = p.date"
        >
          <rect
            :x="75 + i * step"
            y="28"
            :width="step"
            height="235"
            fill="transparent"
          />
          <rect
            v-if="p.value !== null"
            :x="78 + i * step"
            :y="p.value >= 0 ? 145 - (Math.abs(p.value) / max) * 110 : 145"
            :width="Math.max(3, step - 6)"
            :height="Math.max(1, (Math.abs(p.value) / max) * 110)"
            rx="2"
            :fill="p.period === 'before' ? '#8aa1c2' : '#3376f6'"
          />
          <line
            v-if="p.date === recommendation"
            :x1="75 + i * step"
            :x2="75 + i * step"
            y1="15"
            y2="266"
            stroke="#d18722"
            stroke-dasharray="5 3"
          />
          <text
            v-if="
              i % Math.ceil(points.length / 18) === 0 ||
              p.date === recommendation
            "
            :x="80 + i * step"
            y="286"
            :transform="`rotate(-35 ${80 + i * step} 286)`"
            text-anchor="end"
          >
            {{ p.date.slice(5) }}
          </text>
          <title>{{ pointLabel(p) }}</title>
        </g>
      </svg>
    </div>
    <p aria-live="polite">
      {{
        chosen
          ? pointLabel(chosen)
          : t(
              "悬停、点击或键盘选择柱子查看当天数值；可横向滚动查看全部日期。",
              "Hover, click or focus a bar for values. Scroll horizontally for every date.",
            )
      }}
    </p>
    <details>
      <summary>{{ t("每日数据表", "Daily data table") }}</summary>
      <div class="promotion-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t("日期", "Date") }}</th>
              <th>{{ t("观察区间", "Period") }}</th>
              <th>{{ metric }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in points" :key="p.date">
              <td>{{ p.date }}</td>
              <td>
                {{
                  p.period === "gap"
                    ? t("非观察期", "Outside windows")
                    : p.period === "before"
                      ? t("推荐前", "Before")
                      : t("推荐后", "After")
                }}
              </td>
              <td>{{ number(p.value) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
