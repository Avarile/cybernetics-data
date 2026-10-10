#!/usr/bin/env node
/**
 * NOT USED AT THE MOMENT: the agents read through AiDataService (queryRecords /
 * getRecords tools) and no longer allow this script. Kept for reference.
 *
 * Find a record ID in a linked table by matching a field value.
 * Use this before setting any link field to get a valid record ID.
 *
 * Usage:
 *   node lookup-link-id.js '<json>'
 *
 * JSON fields:
 *   tableId   {string} required — the linked table's ID (e.g. "tblXXX")
 *   fieldId   {string} required — the field ID to filter on (MUST be a field ID, not a display name)
 *   value     {string} required — the value to match exactly (operator: "is")
 *   operator  {string} optional — filter operator, default "is"; options: "is","contains","isNot","doesNotContain"
 *   take      {number} optional — max results to return, default 10
 *
 * Returns the first matched record's id, plus all matches for disambiguation.
 *
 * Environment:
 *   TEABLE_API_TOKEN  — required
 *   TEABLE_BASE_URL   — default http://localhost:3000
 *
 * Output:
 *   {
 *     "matched": [{ "id": "recXXX", "fields": {...} }, ...],
 *     "firstId": "recXXX"   ← use this for single-link fields: { "id": "recXXX" }
 *   }
 *
 * Example — find a contact-type record ID by label:
 *   node lookup-link-id.js '{
 *     "tableId": "tblXWCU7zG6yVPpnH50",
 *     "fieldId": "fldnyYl4qoi7Rj2vuWH",
 *     "value": "Employee"
 *   }'
 *
 * Example — find a project by title:
 *   node lookup-link-id.js '{
 *     "tableId": "tbluBET7kwcH7WDUxVf",
 *     "fieldId": "fldNasw0UVWhXYR70X7",
 *     "value": "Data Platform Migration"
 *   }'
 */

(async () => {
  const raw = process.argv[2];
  if (!raw) {
    console.error(
      'Usage: node lookup-link-id.js \'{"tableId":"tblXXX","fieldId":"fldXXX","value":"..."}\''
    );
    process.exit(1);
  }

  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON argument');
    process.exit(1);
  }

  const { tableId, fieldId, value, operator = 'is', take = 10 } = args;

  if (!tableId) {
    console.error('tableId is required');
    process.exit(1);
  }
  if (!fieldId) {
    console.error('fieldId is required (use the fldXXX ID, not display name)');
    process.exit(1);
  }
  if (value === undefined || value === null) {
    console.error('value is required');
    process.exit(1);
  }

  const token = process.env.TEABLE_API_TOKEN;
  if (!token) {
    console.error('TEABLE_API_TOKEN environment variable is not set');
    process.exit(1);
  }

  const baseUrl = process.env.TEABLE_BASE_URL || 'http://localhost:3000';

  const filter = {
    conjunction: 'and',
    filterSet: [{ fieldId, operator, value }],
  };

  const params = new URLSearchParams();
  params.set('fieldKeyType', 'name');
  params.set('take', String(Math.min(Number(take), 100)));
  params.set('filter', JSON.stringify(filter));

  const url = `${baseUrl}/api/table/${tableId}/record?${params.toString()}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(`Network error: ${err.message}`);
    process.exit(1);
  }

  const data = await res.json();

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    process.exit(1);
  }

  const matched = data.records || [];

  if (matched.length === 0) {
    console.error(
      `No records found in table ${tableId} where field ${fieldId} ${operator} "${value}"`
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        matched: matched.map((r) => ({ id: r.id, fields: r.fields })),
        firstId: matched[0].id,
      },
      null,
      2
    )
  );
})();
