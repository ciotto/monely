<script setup>
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

Chart.register(BarController, BarElement, CategoryScale, Legend, LinearScale, Tooltip);

// A horizontal bar chart: one bar per label and dataset, the values formatted by `format` (`formatAxis` on the axis);
// datasets sharing a `stack` are drawn as a single bar, and their null values are left out
const props = defineProps({
  labels: { type: Array, required: true },
  datasets: { type: Array, required: true },
  format: { type: Function, required: true },
  formatAxis: { type: Function, required: true },
  label: { type: String, required: true },
});

const canvas = ref(null);
let chart = null;

function data() {
  return {
    labels: props.labels,
    // Thin bars with rounded ends, square on the baseline
    datasets: props.datasets.map((dataset, index) => ({
      stack: String(index),
      ...dataset,
      borderRadius: 4,
      maxBarThickness: 14,
      barPercentage: 0.85,
      categoryPercentage: 0.7,
    })),
  };
}

onMounted(() => {
  chart = new Chart(canvas.value, {
    type: "bar",
    data: data(),
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", axis: "y", intersect: false },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#f1f5f9" },
          ticks: { color: "#64748b", maxTicksLimit: 5, callback: (value) => props.formatAxis(value) },
        },
        y: { stacked: true, border: { display: false }, grid: { display: false }, ticks: { color: "#334155" } },
      },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 12, boxHeight: 12, color: "#334155" } },
        tooltip: {
          filter: (item) => item.raw !== null,
          callbacks: { label: (item) => `${item.dataset.label}: ${props.format(item.parsed.x)}` },
        },
      },
    },
  });
});

watch(
  () => [props.labels, props.datasets],
  () => {
    chart.data = data();
    chart.update();
  },
);

onBeforeUnmount(() => chart.destroy());
</script>

<template>
  <!-- The height grows with the bars, so that they keep their thickness -->
  <div class="relative" :style="{ height: `${labels.length * 44 + 72}px` }">
    <canvas ref="canvas" role="img" :aria-label="label" />
  </div>
</template>
