<script setup lang="ts">
import { computed, ref } from 'vue';
import type { OfferChannel, OfferChannelSelection, OfferChannelSelections, OfferRecord, OfferTrackerRules, UiLanguage } from '../../shared/contracts/offer';
import { CHANNEL_GRADES, CHANNEL_GRADE_COLORS, CHANNEL_VERIFICATION, channelSelection, selectedForChannel } from './offerChannels';
import { normalizeOfferRecord } from './offerTrackerModel';
const props = defineProps<{ rows: readonly OfferRecord[]; channel: OfferChannel; selections: OfferChannelSelections; language: UiLanguage; rules?: OfferTrackerRules }>();
const emit = defineEmits<{ update: [value: OfferChannelSelections] }>();
const t = (zh: string, en: string) => props.language === 'zh' ? zh : en;
const query = ref('');
const selectedId = ref('');
const candidates = computed(() => props.rows.map(source => ({ source, row: normalizeOfferRecord(source) })).filter(({ row }) => row.merchantId && `${row.merchantId} ${row.merchantName}`.toLowerCase().includes(query.value.toLowerCase())));
const selected = computed(() => candidates.value.find(({ row }) => row.merchantId === selectedId.value) || candidates.value[0]);
const decision = computed(() => selected.value ? channelSelection(selected.value.source, props.channel, props.selections, props.rules) : null);
function update(patch: Partial<OfferChannelSelection>) {
  if (!selected.value || !decision.value) return;
  const id = selected.value.row.merchantId;
  const value = { ...decision.value, asins: [...decision.value.asins], ...patch };
  emit('update', { ...props.selections, [id]: { ...props.selections[id], [props.channel]: value } });
}
function toggleAsin(asin: string) {
  if (!decision.value) return;
  update({ asins: decision.value.asins.includes(asin) ? decision.value.asins.filter(a => a !== asin) : [...decision.value.asins, asin] });
}
function editAsins(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  update({ asins: [...new Set(value.toUpperCase().split(/[\s,;，；]+/).filter(Boolean))] });
}
</script>
<template>
  <details class="channel-editor">
    <summary>{{ t('调整本渠道商家与 ASIN', 'Edit merchants and ASINs for this channel') }}</summary>
    <p>{{ t('候选不等于确认适合。可从总表加入其他商家（包括高价优惠），并分别调整 ASIN。此处修改只影响当前渠道，刷新页面后清除。', 'Candidates are unverified. Add any merchant from the master list, including high-price deals, and choose channel ASINs independently. Edits affect only this channel and are cleared when the page reloads.') }}</p>
    <div class="channel-search">
      <label>{{ t('搜索商家', 'Search merchants') }}<input v-model="query" type="search" :aria-label="t('渠道商家搜索', 'Channel merchant search')" /></label>
      <label>{{ t('选择商家', 'Select merchant') }}<select :value="selected?.row.merchantId || ''" @change="selectedId = ($event.target as HTMLSelectElement).value" :aria-label="t('渠道商家', 'Channel merchant')">
        <option v-for="item in candidates.slice(0, 100)" :key="item.row.merchantId" :value="item.row.merchantId">{{ item.row.merchantName }} · {{ item.row.merchantId }} · {{ selectedForChannel(item.source, channel, selections) ? t('已纳入', 'Included') : t('未纳入', 'Not included') }}</option>
      </select></label>
    </div>
    <p v-if="candidates.length > 100">{{ t('候选选择器显示前 100 个匹配，请搜索名称或 ID 定位其他商家。导出不受此限制。', 'The picker shows the first 100 matches. Search a name or ID to find others. Export is not limited.') }}</p>
    <div v-if="decision && selected" class="channel-fields">
      <label><input type="checkbox" :checked="decision.included" @change="update({ included: ($event.target as HTMLInputElement).checked })" />{{ t('纳入本渠道', 'Include in this channel') }}</label>
      <label>{{ t('渠道推荐等级', 'Channel priority') }}<select :aria-label="t('渠道推荐等级', 'Channel priority')" :style="{ background: CHANNEL_GRADE_COLORS[decision.grade] }" :value="decision.grade" @change="update({ grade: ($event.target as HTMLSelectElement).value as OfferChannelSelection['grade'] })">
        <option v-for="(labels, value) in CHANNEL_GRADES" :key="value" :value="value">{{ t(labels[0], labels[1]) }}</option>
      </select></label>
      <label>{{ t('核实状态（独立于等级）', 'Verification (independent of priority)') }}<select :aria-label="t('核实状态', 'Verification status')" :value="decision.verification" @change="update({ verification: ($event.target as HTMLSelectElement).value as OfferChannelSelection['verification'] })">
        <option v-for="(labels, value) in CHANNEL_VERIFICATION" :key="value" :value="value">{{ t(labels[0], labels[1]) }}</option>
      </select></label>
      <fieldset><legend>{{ t('从全站 Top 5 勾选本渠道 ASIN', 'Choose channel ASINs from overall Top 5') }}</legend>
        <label v-for="asin in selected.row.asins" :key="asin"><input type="checkbox" :checked="decision.asins.includes(asin)" @change="toggleAsin(asin)" />{{ asin }}</label>
      </fieldset>
      <label class="wide">{{ t('本渠道 ASIN（可补充，逗号或换行分隔）', 'Channel ASINs (add others; comma or newline separated)') }}<textarea :key="`${channel}:${selected.row.merchantId}`" :value="decision.asins.join('\n')" maxlength="2000" @change="editAsins" :aria-label="t('本渠道 ASIN', 'Channel ASINs')" /></label>
      <p class="wide">{{ t('手动补充的 ASIN 请核实商家归属。默认仅沿用全站 Top 5，不代表已完成渠道适配排序。', 'Verify merchant ownership of manually added ASINs. Defaults use overall Top 5, not a channel-specific ranking.') }}</p>
      <label class="wide">{{ t('商家入选理由', 'Merchant selection reason') }}<textarea :value="decision.reason" maxlength="2000" @input="update({ reason: ($event.target as HTMLTextAreaElement).value })" /></label>
      <label class="wide">{{ t('ASIN 推荐理由', 'ASIN selection reason') }}<textarea :value="decision.asinReason" maxlength="2000" @input="update({ asinReason: ($event.target as HTMLTextAreaElement).value })" /></label>
      <label class="wide">{{ t('待核实事项', 'To verify') }}<textarea :value="decision.checks" maxlength="2000" @input="update({ checks: ($event.target as HTMLTextAreaElement).value })" /></label>
    </div>
    <p v-else>{{ t('没有匹配的商家。', 'No matching merchants.') }}</p>
  </details>
</template>
<style scoped>
.channel-editor { border: 1px solid #cbd9ef; border-radius: 12px; background: #f8faff; padding: 16px; margin: 12px 0; }
summary { font-weight: 650; cursor: pointer; } p { color: #526786; font-size: 13px; line-height: 1.6; }
.channel-search, .channel-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; min-width: 0; }
input[type=search], select, textarea { border: 1px solid #b9cbea; background: white; color: #1e3557; border-radius: 6px; padding: 8px; font: inherit; width: 100%; min-width: 0; }
textarea { min-height: 60px; resize: vertical; } .wide, fieldset { grid-column: 1 / -1; }
fieldset { border: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 12px; } legend { margin-bottom: 8px; font-size: 13px; }
input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid #3b82f6; outline-offset: 2px; }
@media (max-width: 650px) { .channel-search, .channel-fields { grid-template-columns: 1fr; } }
</style>
