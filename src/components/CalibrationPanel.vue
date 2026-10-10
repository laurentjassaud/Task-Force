<script setup>
import { ref } from 'vue'

// Les objets `calibration`/`gridStyle`/`mapConfig` sont passés par référence
// (réactifs côté parent, HexMap.vue) ; on mute en place. `defaultCalibration`/
// `imageWidth`/`imageHeight` viennent du module courant (src/modules/*.json)
// — ce composant reste générique, sans aucune valeur de carte en dur.

const props = defineProps({
  calibration: { type: Object, required: true },
  gridStyle: { type: Object, required: true },
  mapConfig: { type: Object, required: true }, // { cols, rows }
  defaultCalibration: { type: Object, required: true },
  imageWidth: { type: Number, required: true },
  imageHeight: { type: Number, required: true },
})

const copied = ref(false)

function reset() {
  Object.assign(props.calibration, props.defaultCalibration)
}
function copyCfg() {
  const cfg = { ...props.calibration, ...props.mapConfig }
  navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  })
}
</script>

<template>
  <div class="calib">
    <h3>{{ $t('calibration.title') }}</h3>
    <div class="calib-grid">
      <div class="ctl"><label>{{ $t('calibration.originX') }} <b>{{ calibration.x0 }}</b></label>
        <input type="range" min="0" max="300" step="0.5" v-model.number="calibration.x0"></div>
      <div class="ctl"><label>{{ $t('calibration.originY') }} <b>{{ calibration.y0 }}</b></label>
        <input type="range" min="0" max="300" step="0.5" v-model.number="calibration.y0"></div>
      <div class="ctl"><label>{{ $t('calibration.colStep') }} <b>{{ calibration.colStep }}</b></label>
        <input type="range" min="30" max="200" step="0.25" v-model.number="calibration.colStep"></div>
      <div class="ctl"><label>{{ $t('calibration.radius') }} <b>{{ calibration.a }}</b></label>
        <input type="range" min="15" max="130" step="0.25" v-model.number="calibration.a"></div>
      <div class="ctl"><label>{{ $t('calibration.rowStep') }} <b>{{ calibration.rowStep }}</b></label>
        <input type="range" min="30" max="200" step="0.25" v-model.number="calibration.rowStep"></div>
      <div class="ctl"><label>{{ $t('calibration.cols') }} <b>{{ mapConfig.cols }}</b></label>
        <input type="number" min="1" max="80" v-model.number="mapConfig.cols"></div>
      <div class="ctl"><label>{{ $t('calibration.rows') }} <b>{{ mapConfig.rows }}</b></label>
        <input type="number" min="1" max="80" v-model.number="mapConfig.rows"></div>
      <div class="ctl"><label>{{ $t('calibration.strokeWidth') }} <b>{{ gridStyle.width }}px</b></label>
        <input type="range" min="0.5" max="4" step="0.5" v-model.number="gridStyle.width"></div>
      <div class="ctl"><label>{{ $t('calibration.strokeOpacity') }} <b>{{ gridStyle.opacity }}</b></label>
        <input type="range" min="0" max="1" step="0.05" v-model.number="gridStyle.opacity"></div>
      <div class="ctl"><label>{{ $t('calibration.strokeColor') }}</label>
        <div class="swatchrow"><input type="color" v-model="gridStyle.stroke">
          <span>{{ gridStyle.stroke }}</span></div></div>
    </div>
    <div class="calib-actions">
      <button @click="reset">{{ $t('calibration.reset') }}</button>
      <button @click="copyCfg">{{ $t('calibration.copy') }}</button>
      <span class="copied">{{ copied ? $t('calibration.copied') : '' }}</span>
    </div>
    <p class="hint">{{ $t('calibration.hint', { width: imageWidth, height: imageHeight }) }}</p>
  </div>
</template>

<style scoped>
.calib {
  margin-top: 24px;
  border: 1.5px solid var(--light-border);
  background: var(--light-bg-soft);
  padding: 20px 24px;
  border-radius: var(--radius-6);
}
.calib h3 {
  font-weight: 600;
  letter-spacing: 1px;
  margin: 0 0 16px;
  font-size: var(--font-size-090);
  text-transform: uppercase;
  color: var(--light-text-medium);
}
.calib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px 22px;
}
.ctl {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ctl label {
  font-size: var(--font-size-075);
  color: var(--light-text-muted);
  display: flex;
  justify-content: space-between;
}
.ctl label b {
  color: var(--light-text-strong);
  font-weight: 700;
}
.ctl input[type='range'],
.ctl input[type='number'] {
  width: 100%;
}
.swatchrow {
  display: flex;
  gap: 10px;
  align-items: center;
}
.swatchrow span {
  font-size: var(--font-size-075);
  color: var(--light-text-muted);
}
.calib-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.calib-actions button {
  font-family: var(--font-mono);
  font-size: var(--font-size-085);
  border: 1.5px solid var(--light-text);
  background: var(--color-white);
  padding: 6px 14px;
  cursor: pointer;
  border-radius: var(--radius-4);
}
.copied {
  font-size: var(--font-size-075);
  color: var(--light-text-muted);
}
.hint {
  font-size: var(--font-size-075);
  color: var(--light-text-muted);
  margin: 14px 0 0;
  line-height: 1.5;
}
</style>
