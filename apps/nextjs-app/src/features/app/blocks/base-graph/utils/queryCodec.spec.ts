import type { IBaseGraphQueryRo } from '@teable/openapi';
import { decodeQuery, encodeQuery, normaliseQuery, queryHash } from './queryCodec';

const RO: IBaseGraphQueryRo = {
  tables: [
    {
      tableId: 'tblTasks',
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldName', operator: 'contains', value: 'ünï 名' }],
      },
    },
  ],
  linkFieldIds: [],
  showTableHubs: false,
};

describe('queryCodec', () => {
  it('round-trips a query, unicode included', () => {
    expect(decodeQuery(encodeQuery(RO))).toEqual(normaliseQuery(RO));
  });

  it('strips false and undefined but keeps an empty link list', () => {
    const n = normaliseQuery({ ...RO, showBaseHub: undefined });
    expect(n).not.toHaveProperty('showTableHubs');
    expect(n).not.toHaveProperty('showBaseHub');
    expect(n.linkFieldIds).toEqual([]);
  });

  it('hashes equal queries equally regardless of key order', () => {
    const reordered = { showTableHubs: false, linkFieldIds: [], tables: RO.tables };
    expect(queryHash(reordered as IBaseGraphQueryRo)).toBe(queryHash(RO));
  });

  it('rejects anything that does not validate', () => {
    expect(decodeQuery('not-base64-json')).toBeNull();
    expect(decodeQuery(btoa(JSON.stringify({ tables: [] })))).toBeNull();
    expect(decodeQuery(btoa(JSON.stringify({ tables: [{ tableId: 'nope' }] })))).toBeNull();
    expect(decodeQuery(undefined)).toBeNull();
  });
});
