<script setup>
// Modale de combat (mode Assisté, phase Combat — cf. lib/useCombat.js, qui
// porte TOUTE la logique : ce composant ne fait qu'AFFICHER ce qu'elle
// calcule et renvoyer deux intentions, "ferme" et "combats").
//
// Volontairement NON bloquante (pas d'overlay, comme RollModal.vue dont elle
// reprend le principe et le glisser-déposer) : pendant qu'elle est ouverte,
// le joueur doit pouvoir continuer à cliquer sur la CARTE pour désigner ses
// unités attaquantes — un overlay modal classique l'en empêcherait. Elle est
// déplaçable pour la même raison : elle ne doit jamais masquer
// définitivement l'hex qu'on veut cliquer.
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { mt } from '../i18n/index.js'

const { t } = useI18n()

const props = defineProps({
  // Numéros des hex cibles ("0512"...) — cf. useCombat.js::targetHexLabels.
  targetHexes: { type: Array, default: () => [] },
  // Toutes les unités ennemies des hex cibles, dont les facteurs de défense
  // s'additionnent — cf. useCombat.js::defenders.
  defenders: { type: Array, default: () => [] },
  // Attaquants désignés, dans l'ordre de sélection : `{ unit, factor,
  // ranged }` — facteur de barrage pour une artillerie, `ranged` si elle
  // tire à distance (jamais affectée par le résultat) — cf.
  // useCombat.js::attackerDetails.
  attackerDetails: { type: Array, default: () => [] },
  // Le combat est-il résoluble (au moins un attaquant, aucune unité
  // orpheline) ? — cf. useCombat.js::canResolve.
  canResolve: { type: Boolean, default: false },
  // Unités amies qui ne pourraient plus attaquer, et hex ennemis qui ne
  // pourraient plus être attaqués, si ce combat avait lieu (`{ id, side,
  // name, hex }`, `side` = 'friendly' | 'enemy') — cf. useCombat.js::strandedUnits.
  strandedUnits: { type: Array, default: () => [] },
  attackStrength: { type: Number, default: 0 },
  defenseStrength: { type: Number, default: 0 },
  differential: { type: Number, default: 0 },
  // `{ row: { key, label, shift }, reason }` — ligne de la table retenue et
  // pourquoi (terrain de l'hex, ou hexside franchi par tous les attaquants).
  terrainRow: { type: Object, default: null },
  // Colonne de la table retenue (1-12), déjà décalée selon le terrain.
  column: { type: Number, default: null },
  // Résultat du dernier jet, ou `null` — cf. useCombat.js::combatResult.
  combatResult: { type: Object, default: null },
  // Les lignes de terrain de la table, prêtes à afficher (cf. useCombat.js::crtRows).
  crtRows: { type: Array, default: () => [] },
  // Les lignes de résultats (une par face du dé) — cf. useCombat.js::crtResults.
  crtResults: { type: Array, default: () => [] },
  // Retraite EN COURS après le jet (cf. useRetreat.js::info) — `{ name,
  // side, step, total, waiting, pushes, pushing, reduction }`, ou `null`
  // s'il n'y en a pas (ou plus).
  retreat: { type: Object, default: null },
  // Ce qui s'est passé en appliquant le résultat (éliminations, retraites
  // terminées) — cf. useRetreat.js::notes.
  retreatNotes: { type: Array, default: () => [] },
  // Avance après combat EN COURS (cf. useRetreat.js::advanceInfo) — `{ name,
  // count }` (unité choisie ou `null`, nombre d'unités pouvant avancer), ou
  // `null` hors avance.
  advance: { type: Object, default: null },
  // FPF du défenseur (cf. useCombat.js, section FPF, et HexMap.vue::fpfView)
  // — `{ mode, candidates, selectedIds, units, strength }`, ou `null` s'il
  // n'y a rien à en montrer. `candidates` : artilleries éligibles ; `units` :
  // celles retenues ; `selectedIds` : leurs ids (chaînes). `mode` :
  //   - 'local' : partie sur un seul écran, le défenseur les coche ici ;
  //   - 'request' : en ligne, écran de l'attaquant — un FPF est possible, le
  //     combat doit être soumis au défenseur avant le jet ;
  //   - 'waiting' : en ligne, attaquant — réponse du défenseur attendue ;
  //   - 'answered' : en ligne, attaquant — le défenseur a choisi ;
  //   - 'defender' : en ligne, écran du défenseur — il coche puis valide ;
  //   - 'done' : combat résolu (seul le rappel des FPF retenus subsiste).
  fpf: { type: Object, default: null },
  // Pions de SOUTIEN engagés dans ce combat (cf. lib/useCombat.js, section
  // "PIONS DE SOUTIEN", et HexMap.vue::supportView) — `{ attacking,
  // counters, strength, factor }`, ou `null` s'il n'y en a aucun.
  // `attacking` : ils renforcent l'ATTAQUE (tour de leur camp) ; sinon la
  // DÉFENSE (tour adverse), comme un FPF.
  support: { type: Object, default: null },
  // Plafond d'artilleries du module (cf. lib/useCombat.js, section "COMBIEN
  // D'ARTILLERIES DANS UN COMBAT ?", et HexMap.vue::artilleryCapView) —
  // `{ max, attackFull, fpfFull }`, ou `null` pour un module sans plafond.
  // `attackFull`/`fpfFull` : le plafond est atteint, de ce côté-là de la
  // table — plus aucune artillerie ne peut s'y joindre.
  artilleryCap: { type: Object, default: null },
})

// `end-advance` : bouton "Terminer l'avance" (cf. useRetreat.js::endAdvance).
// `reduce-retreat` : bouton de réduction de retraite (cf. useRetreat.js::reduce).
// `cancel-push` : abandon d'un refoulement d'ami en cours de choix (cf.
// useRetreat.js::cancelPush).
// FPF (cf. prop `fpf`) : `toggle-fpf` (id d'une artillerie cochée/décochée),
// `request-fpf` (soumettre le combat au défenseur), `cancel-fpf-request`
// (renoncer à cette demande), `send-fpf` (le défenseur valide son choix).
// `toggle-support` : le défenseur coche/décoche un pion de soutien de sa
// tablette (en ligne : il n'a pas la main pour le poser sur la carte, cf.
// prop `support`, champ `choices`).
const emit = defineEmits(['close', 'fight', 'end-advance', 'reduce-retreat', 'cancel-push',
  'toggle-fpf', 'request-fpf', 'cancel-fpf-request', 'send-fpf', 'toggle-support'])

const fpfMode = computed(() => props.fpf?.mode ?? null)

// La composition du combat se modifie-t-elle encore depuis la carte ? Non une
// fois le dé lancé, ni pendant la négociation du FPF en ligne (cf.
// useCombat.js::fpfStatus), ni, bien sûr, sur l'écran du défenseur.
const composing = computed(() => !props.combatResult && !['waiting', 'answered', 'defender'].includes(fpfMode.value))

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

const RANGED_TITLE = computed(() => t('combat.rangedTitle'))

// [8.45] : ni FPF ni soutien contre une attaque faite uniquement
// d'artillerie et/ou de soutien (cf. prop `support`, champ `barred`).
const SUPPORT_BARRED_TITLE = computed(() => t('combat.supportBarred'))

// Plafond d'artilleries atteint (cf. prop `artilleryCap`) : le clic sur une
// artillerie de plus reste sans effet, autant le dire.
const artilleryCapNote = computed(() => (props.artilleryCap
  ? t('combat.artilleryCap', { max: props.artilleryCap.max })
  : null))

// Animation du dé : purement décorative. La VALEUR retenue est celle tirée
// par useCombat.js::resolveCombat (émise via `fight` à la fin du roulement),
// jamais celle affichée pendant l'animation.
const rolling = ref(false)
const spinFace = ref(1)
let interval = null, timer = null, closeTimer = null

// Durée pendant laquelle le résultat reste affiché avant que la modale ne se
// ferme d'elle-même (le résultat reste consultable dans le journal).
const RESULT_DISPLAY_MS = 2500

/** Un combat ne se joue qu'UNE fois : pas de relance possible (cf.
 *  useCombat.js, qui fige alors le combat et marque les unités
 *  participantes). La fermeture automatique est gérée plus bas. */
function fight() {
  if (rolling.value || !props.canResolve || props.combatResult) return
  rolling.value = true
  interval = setInterval(() => { spinFace.value = Math.floor(Math.random() * 6) + 1 }, 55)
  timer = setTimeout(() => {
    clearInterval(interval); interval = null
    rolling.value = false
    emit('fight')
  }, 900)
}

// Fermeture automatique : peu après que le résultat est connu ET que toutes
// les retraites et l'avance qu'il entraîne sont faites (cf. props `retreat`
// et `advance`). Surveillé plutôt que programmé juste après `emit('fight')`,
// parce que les props ne sont mises à jour par le parent qu'au rendu
// suivant.
watch([() => props.combatResult, () => props.retreat, () => props.advance], () => {
  if (!props.combatResult || rolling.value || props.retreat || props.advance || closeTimer) return
  closeTimer = setTimeout(() => emit('close'), RESULT_DISPLAY_MS)
})

// --- Position flottante + glisser-déposer (repris de RollModal.vue) ---------
const pos = ref({ x: 0, y: 90 })
const dragging = ref(false)
let drag = null

function onDragStart(event) {
  if (event.target.closest('button')) return
  dragging.value = true
  drag = { mx: event.clientX, my: event.clientY, x: pos.value.x, y: pos.value.y }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  event.preventDefault()
}
function onDragMove(event) {
  if (!dragging.value) return
  const nx = drag.x + (event.clientX - drag.mx)
  const ny = drag.y + (event.clientY - drag.my)
  pos.value = {
    x: Math.min(Math.max(-400, nx), (window.innerWidth || 1200) - 120),
    y: Math.min(Math.max(0, ny), (window.innerHeight || 800) - 90),
  }
}
function onDragEnd() {
  dragging.value = false
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  pos.value = { x: Math.max(20, (window.innerWidth || 1200) - 660), y: 90 }
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  clearInterval(interval)
  clearTimeout(timer)
  clearTimeout(closeTimer)
})
</script>

<template>
  <div class="combat-modal" :class="{ dragging }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDragStart">
    <header class="cm-head">
      <span class="cm-title">{{ fpfMode === 'defender' ? t('combat.enemyTitle') : t('combat.title') }}</span>
      <!-- Pas de fermeture pendant une retraite ou une avance : elles doivent
           aller à leur terme (l'avance se termine par son propre bouton) — ni
           une fois que le défenseur a répondu au FPF : l'attaque est engagée.
           Le défenseur, lui, doit répondre (éventuellement sans FPF). -->
      <button v-if="fpfMode !== 'defender'" class="cm-close" :title="t('combat.cancel')"
        :disabled="!!retreat || !!advance || fpfMode === 'answered'" @click="$emit('close')">&times;</button>
    </header>

    <div class="cm-forces">
      <!-- Défenseurs : TOUTES les unités ennemies des hex cibles (ajoutés /
           retirés en cliquant sur la carte), chacune avec son facteur de
           défense — le total est leur somme. -->
      <section class="cm-side cm-defender">
        <h4>{{ t('combat.defenders') }} <span class="cm-hexes">{{ targetHexes.join(', ') }}</span></h4>
        <div class="cm-units">
          <figure v-for="defender in defenders" :key="defender.id" class="cm-unit">
            <img :src="defender.src" :alt="defender.name" />
            <span class="cm-factor" :title="t('combat.defenseFactor')">{{ defender.def ?? 0 }}</span>
            <figcaption>{{ defender.name }}</figcaption>
          </figure>
          <!-- Artilleries dont le FPF s'ajoute à la défense (cf. prop `fpf`). -->
          <figure v-for="unit in fpf?.units ?? []" :key="'fpf' + unit.id" class="cm-unit cm-fpf-unit"
            :title="t('combat.fpfTitle')">
            <img :src="unit.src" :alt="unit.name" />
            <span class="cm-factor" :title="t('combat.fpfFactor')">{{ unit.fpf ?? 0 }}</span>
            <figcaption>FPF {{ unit.name }}</figcaption>
          </figure>
          <!-- Pions de soutien engagés en DÉFENSE (cf. prop `support`) —
               sans effet contre une attaque faite uniquement d'artillerie
               et/ou de soutien ([8.45], cf. champ `barred`). -->
          <figure v-for="counter in (support && !support.attacking ? support.counters : [])" :key="'sup' + counter.id"
            class="cm-unit cm-fpf-unit" :class="{ 'cm-unit-barred': support.barred }"
            :title="support.barred ? SUPPORT_BARRED_TITLE : t('combat.supportTitle')">
            <img :src="counter.src" :alt="counter.name" />
            <span class="cm-factor" :title="t('combat.supportFactor')">{{ support.barred ? 0 : support.factor }}</span>
            <figcaption>{{ counter.name }}</figcaption>
          </figure>
        </div>
        <p class="cm-total">
          {{ t('combat.defense') }} <b>{{ defenseStrength }}</b>
          <span v-if="fpf?.strength" class="cm-fpf-note">{{ t('combat.ofWhichFpf', { n: fpf.strength }) }}</span>
          <span v-if="support && !support.attacking && support.strength" class="cm-fpf-note">{{ t('combat.ofWhichSupport', { n: support.strength }) }}</span>
        </p>
        <p v-if="support?.barred && support.counters.length" class="cm-hint">{{ SUPPORT_BARRED_TITLE }}</p>
      </section>

      <!-- Attaquants : ajoutés/retirés en cliquant sur la carte (leur hex
           passe en jaune), jamais depuis cette modale. Une artillerie qui
           tire à distance est signalée : elle ne subira pas le résultat. -->
      <section class="cm-side cm-attackers">
        <h4>{{ t('combat.attackers') }}</h4>
        <div class="cm-units">
          <figure v-for="detail in attackerDetails" :key="detail.unit.id" class="cm-unit"
            :title="detail.ranged ? RANGED_TITLE : null">
            <img :src="detail.unit.src" :alt="detail.unit.name" />
            <span class="cm-factor" :title="t('combat.attackFactor')">{{ detail.factor }}</span>
            <figcaption>{{ detail.unit.name }}</figcaption>
            <span v-if="detail.ranged" class="cm-ranged-tag">{{ t('combat.ranged') }}</span>
          </figure>
          <!-- Pions de soutien engagés en ATTAQUE (cf. prop `support`) : une
               unité attaquante de plus, qui ne subit pas le résultat. -->
          <figure v-for="counter in (support?.attacking ? support.counters : [])" :key="'sup' + counter.id"
            class="cm-unit cm-support-unit" :title="t('combat.supportTitle')">
            <img :src="counter.src" :alt="counter.name" />
            <span class="cm-factor" :title="t('combat.supportFactor')">{{ support.factor }}</span>
            <figcaption>{{ counter.name }}</figcaption>
          </figure>
          <p v-if="attackerDetails.length === 0 && !support?.attacking" class="cm-hint">
            {{ t('combat.pickAttackers') }}
          </p>
          <!-- [9.13] Le soutien peut frapper n'importe quel hex ennemi, donc
               attaquer seul : ce combat-là est résoluble sans attaquant. -->
          <p v-else-if="attackerDetails.length === 0" class="cm-hint">
            {{ t('combat.supportOnly') }}
          </p>
          <!-- Plafond d'artilleries du module (cf. prop `artilleryCap`). -->
          <p v-if="composing && artilleryCap?.attackFull" class="cm-hint">{{ artilleryCapNote }}</p>
        </div>
        <p class="cm-total">
          {{ t('combat.attack') }} <b>{{ attackStrength }}</b>
          <span v-if="support?.attacking && support.strength" class="cm-support-note">{{ t('combat.ofWhichSupport', { n: support.strength }) }}</span>
        </p>
      </section>
    </div>

    <p v-if="composing" class="cm-hint cm-tip">{{ t('combat.addTargets') }}</p>

    <!-- Règle de participation (cf. useCombat.js::strandedUnits) : ce combat
         laisserait ces unités sans adversaire — "Combattre" reste grisé. -->
    <div v-if="strandedUnits.length && fpfMode !== 'defender'" class="cm-stranded">
      <p>{{ t('combat.stranded') }}</p>
      <ul>
        <li v-for="unit in strandedUnits" :key="unit.id">
          <b>{{ unit.name }}</b> ({{ unit.hex }}) —
          {{ unit.side === 'friendly' ? t('combat.strandedFriendly') : t('combat.strandedEnemy') }}
        </li>
      </ul>
      <p>{{ t('combat.changeForces') }}</p>
    </div>

    <!-- FPF du défenseur (cf. prop `fpf`) : choix sur cet écran (partie
         locale, ou écran du défenseur en ligne), ou étapes de la demande
         faite au défenseur en ligne. -->
    <section v-if="fpf && fpfMode !== 'done'" class="cm-fpf">
      <template v-if="fpfMode === 'local' || fpfMode === 'defender'">
        <p>{{ fpfMode === 'local' ? t('combat.fpfLocal') : t('combat.fpfDefender') }}</p>
        <div class="cm-fpf-list">
          <!-- Plafond atteint (cf. prop `artilleryCap`) : les artilleries non
               retenues sont éteintes, pas retirées — le défenseur voit ce
               qu'il devrait décocher pour en choisir une autre. -->
          <button v-for="unit in fpf.candidates" :key="unit.id" type="button" class="cm-fpf-choice"
            :class="{ on: fpf.selectedIds.includes(String(unit.id)) }" @click="$emit('toggle-fpf', unit.id)"
            :disabled="artilleryCap?.fpfFull && !fpf.selectedIds.includes(String(unit.id))">
            <img :src="unit.src" :alt="unit.name" />
            {{ unit.name }} <b>+{{ unit.fpf }}</b>
          </button>
        </div>
        <p v-if="artilleryCap?.fpfFull" class="cm-hint">{{ artilleryCapNote }}</p>
        <p v-if="fpfMode === 'local'" class="cm-hint">{{ t('combat.fpfClickMap') }}</p>
        <p v-if="!fpf.candidates.length" class="cm-hint">{{ t('combat.fpfNone') }}</p>
        <!-- Pions de soutien du défenseur (en ligne) : il ne peut pas les
             poser sur la carte pendant le tour adverse, il les coche ici. -->
        <template v-if="support?.choices?.length">
          <p>{{ t('combat.supportDefense') }}</p>
          <div class="cm-fpf-list">
            <button v-for="token in support.choices" :key="token.id" type="button" class="cm-fpf-choice cm-support-choice"
              :class="{ on: support.selectedIds.includes(String(token.id)) }" @click="$emit('toggle-support', token.id)">
              <img :src="token.src" :alt="token.name" />
              {{ token.name }} <b>+{{ support.factor }}</b>
            </button>
          </div>
        </template>
      </template>
      <p v-else-if="fpfMode === 'request'">{{ t('combat.fpfRequest') }}</p>
      <template v-else-if="fpfMode === 'waiting'">
        <p>{{ t('combat.fpfWaiting') }}</p>
        <button type="button" class="cm-end-advance" @click="$emit('cancel-fpf-request')">{{ t('combat.cancelRequest') }}</button>
      </template>
      <p v-else-if="fpfMode === 'answered'">
        <template v-if="fpf.units.length">{{ t('combat.fpfAnswered', { units: fpf.units.map((unit) => unit.name).join(', ') }) }}</template>
        <template v-else>{{ t('combat.fpfDeclined') }}</template>
        {{ t('combat.youMayRoll') }}
      </p>
    </section>

    <p class="cm-diff">
      {{ t('combat.differential') }} <b>{{ differential > 0 ? '+' + differential : differential }}</b>
      <span v-if="terrainRow" class="cm-reason">
        — {{ mt(terrainRow.row.label) }} ({{ terrainRow.reason }}), {{ t('combat.column', { n: column }) }}
      </span>
    </p>

    <!-- Table de combat (cf. images/combat-chart.png) : la ligne de terrain
         retenue et la colonne du différentiel sont surlignées en permanence,
         la case du résultat une fois le dé lancé. -->
    <table class="crt">
      <tbody>
        <tr v-for="row in crtRows" :key="row.key" :class="{ 'row-on': terrainRow && row.key === terrainRow.row.key }">
          <th>{{ mt(row.label) }}</th>
          <td v-for="columnNumber in (crtResults[0]?.length ?? 0)" :key="columnNumber" :class="{ 'col-on': columnNumber === column }">{{ row.cells[columnNumber - 1] ?? '' }}</td>
        </tr>
        <tr v-for="(line, dieIndex) in crtResults" :key="'d' + dieIndex" class="crt-die">
          <th>{{ t('combat.die', { n: dieIndex + 1 }) }}</th>
          <td v-for="(cell, columnIndex) in line" :key="columnIndex"
            :class="{ 'col-on': columnIndex + 1 === column, hit: combatResult && combatResult.die === dieIndex + 1 && combatResult.column === columnIndex + 1 }">
            {{ cell }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="cm-foot">
      <div class="cm-roll">
        <span class="cm-die" :class="{ rolling, final: !rolling && combatResult }">
          {{ FACES[(rolling ? spinFace : combatResult?.die ?? 1) - 1] }}
        </span>
        <span v-if="combatResult && !rolling" class="cm-result">
          <b>{{ combatResult.result }}</b> — {{ mt(combatResult.resultLabel) }}
        </span>
      </div>
      <!-- Bouton principal : lancer le dé — sauf, en ligne, soumettre d'abord
           le combat au défenseur (FPF possible), ou, sur son écran, valider
           son choix de FPF. -->
      <button v-if="fpfMode === 'defender'" class="cm-fight" @click="$emit('send-fpf')">{{ t('combat.sendFpf') }}</button>
      <button v-else-if="fpfMode === 'request'" class="cm-fight" :disabled="!canResolve" @click="$emit('request-fpf')">
        {{ t('combat.submitToDefender') }}
      </button>
      <button v-else class="cm-fight" :disabled="rolling || !canResolve || !!combatResult" @click="fight">
        {{ combatResult && !rolling ? t('combat.resolved') : t('combat.fight') }}
      </button>
    </footer>

    <!-- Application du résultat (cf. useRetreat.js) : unité qui retraite
         maintenant, et ce qui s'est déjà passé. -->
    <section v-if="combatResult && !rolling && (retreat || advance || retreatNotes.length)" class="cm-retreat">
      <!-- Refoulement d'un ami en attente de choix (cf. useRetreat.js::pending). -->
      <i18n-t v-if="retreat?.pushing" keypath="combat.pushChoice" tag="p" class="cm-retreat-now">
        <template #unit><b>{{ retreat.name }}</b></template>
        <template #pushed><b>{{ retreat.pushing }}</b></template>
        <template #red><span class="cm-red">{{ t('combat.red') }}</span></template>
      </i18n-t>
      <button v-if="retreat?.pushing" class="cm-end-advance" @click="$emit('cancel-push')">
        {{ t('combat.otherRetreatHex') }}
      </button>
      <p v-else-if="retreat" class="cm-retreat-now">
        <i18n-t keypath="combat.retreatOf" tag="span">
          <template #unit><b>{{ retreat.name }}</b></template>
          <template #role>{{ retreat.side === 'defender' ? t('combat.defender') : t('combat.attacker') }}</template>
          <template #step>{{ retreat.step }}</template>
          <template #total>{{ retreat.total }}</template>
          <template #red><span class="cm-red">{{ t('combat.red') }}</span></template>
        </i18n-t>
        <span v-if="retreat.pushes" class="cm-retreat-wait">
          {{ t('combat.pushesOnly') }}
        </span>
        <span v-if="retreat.waiting" class="cm-retreat-wait">
          {{ t('combat.thenOthers', retreat.waiting) }}
        </span>
      </p>
      <!-- Réduction facultative offerte par le module dans l'hex actuel
           (ex. hex City à Arnhem, cf. useArnhem.js::cityRetreatReduction). -->
      <button v-if="retreat?.reduction" class="cm-end-advance" @click="$emit('reduce-retreat')">
        {{ retreat.reduction.total < retreat.step ? t('combat.stopHere') : t('combat.reduceRetreat', { n: retreat.reduction.total }) }}
        ({{ retreat.reduction.reason }})
      </button>
      <ul v-if="retreatNotes.length">
        <li v-for="(note, noteIndex) in retreatNotes" :key="noteIndex">{{ note }}</li>
      </ul>
      <!-- Avance après combat (cf. useRetreat.js) : le chemin de retraite est
           en vert sur la carte. -->
      <div v-if="advance" class="cm-advance">
        <i18n-t v-if="advance.name" keypath="combat.advanceOf" tag="p">
          <template #unit><b>{{ advance.name }}</b></template>
          <template #green><span class="cm-green">{{ t('combat.brightGreen') }}</span></template>
        </i18n-t>
        <i18n-t v-else keypath="combat.advancePick" tag="p">
          <template #green><span class="cm-green">{{ t('combat.green') }}</span></template>
        </i18n-t>
        <button class="cm-end-advance" @click="$emit('end-advance')">{{ t('combat.endAdvance') }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.combat-modal {
  position: fixed;
  z-index: var(--z-combat-modal);
  width: 640px;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  box-shadow: var(--shadow-modal);
  padding: 12px 16px 14px;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.combat-modal.dragging {
  box-shadow: var(--shadow-modal-drag);
}

.cm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.cm-title {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: var(--font-size-090);
  color: var(--color-gold);
}

.cm-close {
  border: none;
  background: transparent;
  color: var(--panel-text-muted);
  font-size: var(--font-size-150);
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}

.cm-close:hover:not(:disabled) {
  color: var(--color-white);
}

.cm-close:disabled {
  opacity: 0.3;
  cursor: default;
}

.cm-retreat {
  margin-top: 10px;
  padding: 6px 8px;
  border-radius: var(--radius-6);
  border-left: 3px solid var(--color-red);
  background: var(--red-a12);
  font-size: var(--font-size-078);
}

.cm-retreat p,
.cm-retreat ul {
  margin: 0;
}

.cm-retreat ul {
  margin-top: 4px;
  padding-left: 16px;
  color: var(--panel-text-muted);
}

.cm-red {
  color: var(--color-red-light);
  font-weight: 700;
}

.cm-advance {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--green-a40);
  display: flex;
  align-items: center;
  gap: 10px;
}

.cm-advance p {
  flex: 1;
}

.cm-green {
  color: var(--color-green-light);
  font-weight: 700;
}

.cm-end-advance {
  border: none;
  background: var(--color-green);
  color: var(--color-white);
  font-weight: 700;
  font-size: var(--font-size-075);
  padding: 6px 12px;
  border-radius: var(--radius-6);
  cursor: pointer;
  white-space: nowrap;
}

.cm-end-advance:hover {
  filter: brightness(1.1);
}

.cm-retreat-wait {
  color: var(--panel-text-faint);
}

.cm-forces {
  display: flex;
  gap: 10px;
}

.cm-side {
  flex: 1;
  background: var(--white-a06);
  border-radius: var(--radius-8);
  padding: 8px;
  min-width: 0;
}

.cm-defender {
  border-left: 3px solid var(--color-orange);
}

.cm-attackers {
  border-left: 3px solid var(--color-gold);
}

.cm-side h4 {
  margin: 0 0 6px;
  font-size: var(--font-size-072);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--panel-text-muted);
}

.cm-units {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 46px;
}

.cm-unit {
  position: relative;
  margin: 0;
  width: 44px;
  text-align: center;
}

/* Facteur (défense ou attaque) de l'unité, en pastille sur son pion. */
.cm-factor {
  position: absolute;
  top: -4px;
  right: -2px;
  min-width: 16px;
  padding: 0 3px;
  border-radius: var(--radius-8);
  background: var(--color-gold);
  color: var(--panel-bg);
  font-size: var(--font-size-065);
  font-weight: 700;
  line-height: 16px;
}

.cm-defender .cm-factor {
  background: var(--color-orange);
}

/* Artillerie du FPF, dans la colonne du défenseur : bleu, comme son hex sur
   la carte (cf. HexMap.vue, .hex-fpf). */
.cm-defender .cm-fpf-unit .cm-factor {
  background: var(--color-blue);
}

.cm-fpf-note {
  font-size: var(--font-size-072);
  color: var(--color-blue);
  margin-left: 4px;
}

/* Pion de soutien engagé en attaque (cf. prop `support`) : vert, comme les
   hex où on le pose sur la carte (cf. HexMap.vue, .hex-support-target). */
.cm-attackers .cm-support-unit .cm-factor {
  background: var(--color-green);
}

/* Pion de soutien engagé mais privé d'effet ([8.45]). */
.cm-unit-barred {
  opacity: 0.5;
}

.cm-support-note {
  font-size: var(--font-size-072);
  color: var(--color-green-light);
  margin-left: 4px;
}

/* Artillerie qui tire à distance (cf. prop `attackerDetails`). */
.cm-ranged-tag {
  display: block;
  font-size: var(--font-size-055);
  color: var(--color-gold);
  font-style: italic;
}

.cm-fpf {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-8);
  border-left: 3px solid var(--color-blue);
  background: var(--blue-a10);
  font-size: var(--font-size-080);
}

.cm-fpf p {
  margin: 0 0 4px;
}

.cm-fpf-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.cm-fpf-choice {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 3px;
  border: 1px solid var(--color-blue);
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--panel-text);
  font-size: var(--font-size-075);
  cursor: pointer;
}

.cm-fpf-choice img {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-2);
}

/* Artillerie que le plafond du module écarte (cf. prop `artilleryCap`) :
   éteinte, comme un pion de la tablette de soutien hors phase de Combat. */
.cm-fpf-choice:disabled {
  opacity: 0.45;
  cursor: default;
}

.cm-fpf-choice.on {
  background: var(--color-blue);
  color: var(--color-blue-ink);
}

/* Pion de soutien coché par le défenseur : vert, comme le soutien partout
   ailleurs (cf. HexMap.vue, .hex-support-target). */
.cm-support-choice {
  border-color: var(--color-green);
}

.cm-support-choice.on {
  background: var(--color-green);
  color: var(--panel-bg);
}

.cm-hexes {
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-orange);
  font-weight: 600;
  margin-left: 4px;
}

.cm-tip {
  margin: 6px 0 0;
}

.cm-unit img {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-2);
  display: block;
  margin: 0 auto;
}

.cm-unit figcaption {
  font-size: var(--font-size-060);
  color: var(--panel-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cm-hint {
  margin: 0;
  font-size: var(--font-size-072);
  color: var(--panel-text-faint);
  font-style: italic;
}

.cm-total {
  margin: 6px 0 0;
  font-size: var(--font-size-080);
}

.cm-total b {
  color: var(--color-gold);
  font-size: var(--font-size-100);
}

.cm-stranded {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: var(--radius-6);
  border-left: 3px solid var(--color-stranded);
  background: var(--stranded-a14);
  color: var(--color-stranded-text);
  font-size: var(--font-size-074);
}

.cm-stranded p {
  margin: 0;
}

.cm-stranded ul {
  margin: 2px 0;
  padding-left: 16px;
}

.cm-diff {
  margin: 10px 0 6px;
  font-size: var(--font-size-085);
}

.cm-diff b {
  color: var(--color-gold);
  font-size: var(--font-size-105);
}

.cm-reason {
  color: var(--panel-text-faint);
  font-size: var(--font-size-076);
}

.crt {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-062);
  table-layout: fixed;
}

.crt th {
  text-align: left;
  font-weight: 600;
  color: var(--panel-text-muted);
  white-space: nowrap;
  width: 116px;
  padding: 1px 4px 1px 0;
  font-size: var(--font-size-060);
}

.crt td {
  text-align: center;
  padding: 1px 0;
  color: var(--crt-text);
  border: 1px solid transparent;
}

.crt .row-on th,
.crt .row-on td {
  background: var(--gold-a16);
  color: var(--panel-text);
}

.crt .col-on {
  background: var(--gold-a16);
  color: var(--panel-text);
}

.crt .row-on .col-on {
  background: var(--gold-a34);
}

.crt-die td {
  color: var(--crt-die-text);
}

.crt td.hit {
  background: var(--color-orange);
  color: var(--panel-bg);
  font-weight: 700;
  border-color: var(--crt-hit-border);
}

.cm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.cm-roll {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.cm-die {
  font-size: var(--font-size-220);
  line-height: 1;
}

.cm-die.rolling {
  animation: cm-spin 0.11s linear infinite;
}

.cm-die.final {
  color: var(--color-orange);
}

@keyframes cm-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.cm-result {
  font-size: var(--font-size-080);
}

.cm-result b {
  color: var(--color-orange);
}

.cm-fight {
  border: none;
  background: var(--color-orange);
  color: var(--panel-bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 9px 20px;
  border-radius: var(--radius-8);
  cursor: pointer;
  white-space: nowrap;
}

.cm-fight:hover:not(:disabled) {
  filter: brightness(1.08);
}

.cm-fight:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
