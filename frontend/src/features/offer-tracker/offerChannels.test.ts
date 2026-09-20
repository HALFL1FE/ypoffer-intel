import { describe, expect, it } from 'vitest';
import { offerTrackerExportSheets } from './offerTrackerExport';
import { suggestChannel } from './offerChannels';
import { buildWorkbookFiles, worksheetRowBackgroundColor } from '../../shared/export/xlsx';
import type { OfferChannelSelections, OfferTrackerExportPayload } from '../../shared/contracts/offer';
const a = { merchantId: '101', merchantName: 'A', tier: 'Tier 1', category: 'Home & Kitchen', affCommissionRate: 20, aov: 200, salesAmount: 50, topAsins: ['B000000001', 'B000000002'] };
const b = { ...a, merchantId: '1101', merchantName: 'A', aov: 30, salesAmount: 0, category: 'Unknown' };
const value = (sheet: ReturnType<typeof offerTrackerExportSheets>[number], label: string, index = 0) => sheet.columns!.find(c => c[0] === label)![1](sheet.rows[index]!);
describe('channel workbook cohorts', () => {
  it('orders every sheet green, cyan, white using its own grade and keeps ties stable', () => {
    const low = { ...a, merchantId: 'low', tier: 'Tier 4', affCommissionRate: 2, aov: 30 };
    const recommended = { ...low, merchantId: 'recommended', aov: 200 };
    const recommended2 = { ...recommended, merchantId: 'recommended2' };
    const source = [low, recommended2, a, recommended];
    const selections: OfferChannelSelections = {};
    for (const row of source) {
      selections[row.merchantId] = {};
      for (const channel of ['google', 'deals', 'creators'] as const) {
        selections[row.merchantId]![channel] = {
          ...suggestChannel(row, channel), included: true,
          grade: row === low ? 'high' : row === a ? 'low-aov' : 'recommended',
        };
      }
    }
    const sheets = offerTrackerExportSheets({ rows: source, view: 'offers', selectedOnly: false, channelSelections: selections });
    expect(sheets[0]!.rows.map(r => r.merchantId)).toEqual(['101', 'recommended2', 'recommended', 'low']);
    for (const sheet of sheets.slice(1)) expect(sheet.rows.map(r => r.merchantId)).toEqual(['low', 'recommended2', 'recommended', '101']);
    for (const sheet of sheets) expect(sheet.rows.map((_, i) => worksheetRowBackgroundColor(i + 1, sheet.rowBackgroundRanges)))
      .toEqual(['#D6EEDD', '#CCFFFF', '#CCFFFF', '#FFFFFF']);
    expect(source.map(r => r.merchantId)).toEqual(['low', 'recommended2', '101', 'recommended']);
  });
  it('keeps the complete exact-ID master and independently classifies merchant subsets', () => {
    const sheets = offerTrackerExportSheets({ rows: [a, b, { ...a }], view: 'offers', selectedOnly: false });
    expect(sheets.map(s => s.rows.map(r => r.merchantId))).toEqual([['101', '1101'], ['101'], ['1101'], ['101']]);
    expect(value(sheets[1]!, 'Verification Status')).toContain('待核实');
    expect(value(sheets[1]!, 'Metric Scope')).toContain('not channel attribution');
    expect(value(sheets[1]!, 'ASIN Reason')).toContain('overall Top 5');
  });
  it('supports different ASINs for the same merchant, including manually reviewed additions', () => {
    const selections: OfferChannelSelections = { '101': {
      google: { ...suggestChannel(a, 'google'), asins: ['B000000001'] },
      deals: { ...suggestChannel(a, 'deals'), included: true, grade: 'recommended', asins: ['B000000003'], reason: 'Confirmed high-value deal' },
      creators: { ...suggestChannel(a, 'creators'), asins: ['B000000002'] },
    } };
    const payload: OfferTrackerExportPayload = { rows: [a], view: 'products', selectedOnly: true, channelSelections: selections, dateRange: { startDate: '2026-09-01', endDate: '2026-09-19' } };
    const sheets = offerTrackerExportSheets(payload);
    expect(sheets.map(s => value(s, 'Channel ASINs'))).toEqual(['', 'B000000001', 'B000000003', 'B000000002']);
    expect(sheets.every(s => value(s, 'Top Rank ASINs') === 'B000000001\nB000000002')).toBe(true);
    expect(value(sheets[2]!, 'Data End')).toBe('2026-09-19');
    expect(a.topAsins).toEqual(['B000000001', 'B000000002']);
  });
  it('uses grade colors by merchant after channel filtering and exports empty sheets', () => {
    const sheets = offerTrackerExportSheets({ rows: [a, b], view: 'offers', selectedOnly: false, backgroundRanges: [{ start: 2, end: 2, color: '#CCFFFF' }], channelSelections: { '101': { creators: { ...suggestChannel(a, 'creators'), included: false } } } });
    expect(worksheetRowBackgroundColor(1, sheets[2]!.rowBackgroundRanges)).toBe('#D6EEDD');
    expect(sheets[3]!.rows).toEqual([]);
    expect(sheets[3]!.columns!.length).toBe(sheets[0]!.columns!.length);
    expect(sheets[0]!.rows).toHaveLength(2);
  });
  it('blocks invalid included ASINs but never infers permission from BB preference', () => {
    expect(suggestChannel({ ...a, merchantName: 'Merach' }, 'google').verification).toBe('pending');
    expect(() => offerTrackerExportSheets({ rows: [a], view: 'offers', selectedOnly: false, channelSelections: { '101': { google: { ...suggestChannel(a, 'google'), asins: ['invalid'] } } } })).toThrow('valid ASINs');
  });
  it('preserves the three source colors, legend, numeric values and independent channel grades', () => {
    const sheets = offerTrackerExportSheets({ rows: [a, b], view: 'offers', selectedOnly: false, rules: { highScore: 1, lowAovMax: 100 }, channelSelections: { '101': {
      google: { ...suggestChannel(a, 'google'), grade: 'recommended' },
      creators: { ...suggestChannel(a, 'creators'), grade: 'low-aov' },
    } } });
    expect(sheets.map(s => worksheetRowBackgroundColor(1, s.rowBackgroundRanges))).toEqual(['#D6EEDD', '#CCFFFF', '#D6EEDD', '#FFFFFF']);
    expect(value(sheets[0]!, 'Priority')).toContain('高优先级offer');
    expect(value(sheets[1]!, 'Priority')).toContain('推荐offer、低单价优选');
    expect(value(sheets[3]!, 'Priority')).toContain('低单价优选');
    expect(value(sheets[1]!, 'Verification Status')).toContain('待核实');
    const files = new Map(buildWorkbookFiles(sheets).map(f => [f.name, f.data]));
    const xml = String(files.get('xl/worksheets/sheet1.xml'));
    expect(xml).toContain('topLeftCell="A5"');
    expect(xml).toContain('autoFilter ref="A4:X6"');
    expect(xml).toContain('<v>0.2</v>');
    expect(xml).toContain('推荐offer、低单价优选');
    for (const color of ['D6EEDD', 'CCFFFF', 'FFFFFF', '1F4E78']) expect(files.get('xl/styles.xml')).toContain(`FF${color}`);
  });

});
