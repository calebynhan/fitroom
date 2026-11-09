import { describe, expect, it } from 'vitest';
import { parseMeasurement, parseSizeChart, type UniqloSizeChartEntry } from './sizeChart';

const cm = (value: string, inch = '0') => [
  { value, unit: 'cm' },
  { value: inch, unit: 'inch' },
];

// Trimmed from the real size-charts response for E453754-000 (sweater) and E482856-000 (jeans).
const SWEATER: UniqloSizeChartEntry = {
  productId: 'E453754-000',
  sizeChart: [
    {
      name: 'S',
      sizeParts: [
        { code: 'knit-body-length-front', name: 'Body length back', measurements: cm('65') },
        { code: 'shoulder-width', name: 'Shoulder width', measurements: cm('43') },
        { code: 'body-width', name: 'Chest', measurements: cm('51') },
        { code: 'sleeve-length-cb', name: 'Sleeve Length (center back)', measurements: cm('86') },
      ],
    },
    {
      name: 'M',
      sizeParts: [
        { code: 'knit-body-length-front', name: 'Body length back', measurements: cm('68') },
        { code: 'body-width', name: 'Chest', measurements: cm('54') },
      ],
    },
  ],
  bodyMeasurements: [
    { name: 'S', sizeParts: [{ code: 'nude-chest', name: 'Chest', measurements: cm('88 - 96') }] },
    { name: 'M', sizeParts: [{ code: 'nude-chest', name: 'Chest', measurements: cm('96 - 104') }] },
  ],
};

const JEANS: UniqloSizeChartEntry = {
  productId: 'E482856-000',
  sizeChart: [
    {
      name: '30inch',
      sizeParts: [
        { code: 'waist-product-size', name: 'Waist', measurements: cm('79.5') },
        { code: 'hip-product-size', name: 'Hip', measurements: cm('99') },
        { code: 'thigh', name: 'Thigh', measurements: cm('30.5') },
        { code: 'rising-length', name: 'Rise', measurements: cm('24.5') },
        { code: 'bottom-width', name: 'Leg opening', measurements: cm('18') },
        { code: 'inseam', name: 'Inseam', measurements: cm('78 / 85') },
      ],
    },
  ],
  bodyMeasurements: [{ name: '30inch', sizeParts: [{ code: 'nude-waist', name: 'Waist', measurements: cm('76') }] }],
};

describe('parseMeasurement', () => {
  it('reads plain cm values', () => {
    expect(parseMeasurement(cm('58.5'))).toEqual([58.5, 58.5]);
  });
  it('reads ranges as [min, max]', () => {
    expect(parseMeasurement(cm('104 - 112'))).toEqual([104, 112]);
    expect(parseMeasurement(cm('104-112'))).toEqual([104, 112]);
  });
  it('takes the first of several lengths ("78 / 85")', () => {
    expect(parseMeasurement(cm('78 / 85'))).toEqual([78, 78]);
  });
  it('falls back to inches when cm is missing, including fractions', () => {
    expect(parseMeasurement([{ value: '23 ½', unit: 'inch' }])).toEqual([59.69, 59.69]);
  });
  it('reads a lone fraction', () => {
    expect(parseMeasurement([{ value: '½', unit: 'inch' }])).toEqual([1.27, 1.27]);
  });
  it('returns null for blanks, hyphens and junk', () => {
    expect(parseMeasurement(cm('-'))).toBeNull();
    expect(parseMeasurement(cm(''))).toBeNull();
    expect(parseMeasurement(cm('n/a'))).toBeNull();
    expect(parseMeasurement(undefined)).toBeNull();
    expect(parseMeasurement([{ value: '0', unit: 'cm' }])).toBeNull();
  });
});

describe('parseSizeChart', () => {
  it('maps a top: body chest range on top level (upper end), garment circumference doubled from flat width', () => {
    const { chart } = parseSizeChart(SWEATER);
    expect(chart).toEqual({
      S: {
        chestCm: 96,
        lengthCm: 65,
        body: { chestCm: [88, 96] },
        garment: { chestCm: 102, lengthCm: 65, shoulderCm: 43, sleeveCm: 86 },
      },
      M: {
        chestCm: 104,
        lengthCm: 68,
        body: { chestCm: [96, 104] },
        garment: { chestCm: 108, lengthCm: 68 },
      },
    });
  });

  it('maps pants: body waist, garment inseam on top level, flat widths doubled', () => {
    const { chart } = parseSizeChart(JEANS);
    expect(chart).toEqual({
      '30inch': {
        waistCm: 76,
        inseamCm: 78,
        body: { waistCm: [76, 76] },
        garment: { waistCm: 79.5, hipsCm: 99, thighCm: 61, riseCm: 24.5, hemCm: 36, inseamCm: 78 },
      },
    });
  });

  it('reports part codes it does not understand instead of dropping them silently', () => {
    const entry: UniqloSizeChartEntry = {
      productId: 'E1',
      sizeChart: [{ name: 'M', sizeParts: [{ code: 'hood-height', name: 'Hood', measurements: cm('30') }] }],
      bodyMeasurements: [{ name: 'M', sizeParts: [{ code: 'nude-chest', name: 'Chest', measurements: cm('96 - 104') }] }],
    };
    const { chart, unknownParts } = parseSizeChart(entry);
    expect(unknownParts).toEqual(['hood-height']);
    expect(chart).toEqual({ M: { chestCm: 104, body: { chestCm: [96, 104] } } });
  });

  it('only takes centre-back sleeve length (a shoulder-seam sleeve would read long sleeves as short)', () => {
    const entry: UniqloSizeChartEntry = {
      productId: 'E1',
      sizeChart: [{ name: 'M', sizeParts: [{ code: 'sleeve-length', name: 'Sleeve', measurements: cm('62') }] }],
    };
    expect(parseSizeChart(entry)).toEqual({ chart: null, unknownParts: ['sleeve-length'] });
  });

  it('returns null when there is nothing usable', () => {
    expect(parseSizeChart(undefined).chart).toBeNull();
    expect(parseSizeChart({ productId: 'E1', sizeChart: [], bodyMeasurements: [] }).chart).toBeNull();
    expect(
      parseSizeChart({
        productId: 'E1',
        sizeChart: [{ name: 'M', sizeParts: [{ code: 'body-width', name: 'Chest', measurements: cm('-') }] }],
      }).chart,
    ).toBeNull();
  });

  it('keeps garment-only sizes (no body row) so the app can still compare ease', () => {
    const { chart } = parseSizeChart({ ...SWEATER, bodyMeasurements: [] });
    expect(chart?.S).toEqual({ lengthCm: 65, garment: { chestCm: 102, lengthCm: 65, shoulderCm: 43, sleeveCm: 86 } });
  });

  it('ignores rows without a size name and malformed parts', () => {
    const entry = {
      productId: 'E1',
      sizeChart: [{ sizeParts: [] }, { name: 'L', sizeParts: [null, { code: 'body-width' }] }],
      bodyMeasurements: [{ name: 'L', sizeParts: [{ code: 'nude-waist', measurements: cm('84 - 92') }] }],
    } as unknown as UniqloSizeChartEntry;
    expect(parseSizeChart(entry).chart).toEqual({ L: { waistCm: 92, body: { waistCm: [84, 92] } } });
  });
});
