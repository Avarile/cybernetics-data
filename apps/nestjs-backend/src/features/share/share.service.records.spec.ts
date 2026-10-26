import type { IFilter } from '@cybernetics/core';
import { SortFunc, ViewType } from '@cybernetics/core';
import type { IShareViewRecordsRo } from '@teable/openapi';
import type { IShareViewInfo } from './share-auth.service';
import { ShareService } from './share.service';

const fields = [
  { id: 'fldPrimary', isPrimary: true },
  { id: 'fldVisible', isPrimary: false },
];
const hiddenFieldId = 'fldHidden';

const shareInfo = {
  shareId: 'shrTest',
  tableId: 'tblTest',
  view: { id: 'viwTest', type: ViewType.Grid },
  shareMeta: { includeRecords: true },
} as unknown as IShareViewInfo;

const createService = () => {
  const getRecords = vi.fn().mockResolvedValue({ records: [] });
  const service = new ShareService(
    ...([
      undefined,
      undefined,
      { getFieldsByQuery: vi.fn().mockResolvedValue(fields) },
      { getRecords },
    ] as unknown as ConstructorParameters<typeof ShareService>)
  );
  const lastQuery = () => getRecords.mock.calls[0][1];
  return { service, getRecords, lastQuery };
};

const filterOn = (fieldId: string): IFilter => ({
  conjunction: 'and',
  filterSet: [{ fieldId, operator: 'isNotEmpty', value: null }],
});

describe('ShareService.getViewRecords', () => {
  it('drops hidden fields from the requested projection', async () => {
    const { service, lastQuery } = createService();
    await service.getViewRecords(shareInfo, { projection: ['fldVisible', hiddenFieldId] });
    expect(lastQuery().projection).toEqual(['fldVisible']);
  });

  it('returns the shared fields when the projection only names hidden ones', async () => {
    const { service, lastQuery } = createService();
    await service.getViewRecords(shareInfo, { projection: [hiddenFieldId] });
    expect(lastQuery().projection).toEqual(['fldPrimary', 'fldVisible']);
  });

  it.each<[string, IShareViewRecordsRo]>([
    ['filter', { filter: filterOn(hiddenFieldId) }],
    ['orderBy', { orderBy: [{ fieldId: hiddenFieldId, order: SortFunc.Asc }] }],
    ['groupBy', { groupBy: [{ fieldId: hiddenFieldId, order: SortFunc.Asc }] }],
  ])('rejects a %s on a hidden field', async (_name, query) => {
    const { service, getRecords } = createService();
    await expect(service.getViewRecords(shareInfo, query)).rejects.toThrow(/hidden/);
    expect(getRecords).not.toHaveBeenCalled();
  });

  it('keeps the link filter when the visitor sends their own', async () => {
    const { service, lastQuery } = createService();
    const linkFilter = filterOn('fldPrimary');
    const visitorFilter = filterOn('fldVisible');
    await service.getViewRecords({ ...shareInfo, linkOptions: { filter: linkFilter } } as never, {
      filter: visitorFilter,
    });
    expect(lastQuery().filter).toEqual({
      conjunction: 'and',
      filterSet: [{ conjunction: 'and', filterSet: [linkFilter, visitorFilter] }],
    });
  });
});
