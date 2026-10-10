#!/usr/bin/env node
/**
 * NOT USED AT THE MOMENT: the agents read through AiDataService (queryRecords /
 * getRecords tools) and no longer allow this script. Kept for reference.
 *
 * Fetch records from a Teable table.
 *
 * Usage:
 *   node get-records.js '<json>'
 *
 * JSON fields:
 *   tableId    {string}   required  — table ID (e.g. "tblXXX")
 *   take       {number}   optional  — records to return, default 100, max 1000
 *   skip       {number}   optional  — records to skip for pagination, default 0
 *   search     {string}   optional  — full-text search across all fields
 *   filter     {object}   optional  — filter object; fieldId keys REQUIRED (not display names)
 *   orderBy    {array}    optional  — sort array; fieldId keys REQUIRED
 *   projection {string[]} optional  — field display names to include in response
 *
 * Filter example:
 *   { "conjunction": "and", "filterSet": [{ "fieldId": "fldXXX", "operator": "is", "value": "Active" }] }
 *
 * OrderBy example:
 *   [{ "fieldId": "fldXXX", "order": "desc" }]
 *
 * Environment:
 *   TEABLE_API_TOKEN  — required
 *   TEABLE_BASE_URL   — default http://localhost:3000
 *
 * Output: JSON { records: [...], total: N } to stdout
 */

(async () => {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Usage: node get-records.js \'{"tableId":"tblXXX",...}\'');
    process.exit(1);
  }

  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON argument');
    process.exit(1);
  }

  const { tableId, take = 100, skip = 0, search, filter, orderBy, projection } = args;

  if (!tableId) {
    console.error('tableId is required');
    process.exit(1);
  }

  const token = process.env.TEABLE_API_TOKEN;
  if (!token) {
    console.error('TEABLE_API_TOKEN environment variable is not set');
    process.exit(1);
  }

  const baseUrl = process.env.TEABLE_BASE_URL || 'http://localhost:3000';

  const params = new URLSearchParams();
  params.set('fieldKeyType', 'name');
  params.set('take', String(Math.min(Number(take), 1000)));
  params.set('skip', String(Number(skip)));

  if (search) params.set('search', search);
  if (filter) params.set('filter', JSON.stringify(filter));
  if (orderBy) params.set('orderBy', JSON.stringify(orderBy));
  if (projection) {
    [].concat(projection).forEach((p) => params.append('projection', p));
  }

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

  console.log(JSON.stringify(data, null, 2));
})();
