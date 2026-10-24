import { FieldType, isMultiValueLink } from '@cybernetics/core';
import type { Relationship } from '@cybernetics/core';

export interface IFieldInfo {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: unknown;
  isPrimary?: boolean;
  isComputed?: boolean;
}

// Subset of link field options needed to document/synthesize a reference.
interface ILinkOptionsSubset {
  foreignTableId?: string;
  relationship?: Relationship;
}

// A couple of real records pulled from a foreign table, used to make link
// references in the example record concrete and copy-paste runnable.
export interface IForeignSample {
  id: string;
  title: string;
}
export interface IForeignTableInfo {
  tableName: string;
  samples: IForeignSample[];
}
export type ForeignMap = Record<string, IForeignTableInfo>;

export const getLinkOptions = (options?: unknown): ILinkOptionsSubset =>
  (options ?? {}) as ILinkOptionsSubset;

const getFieldTypeDescription = (type: FieldType, options?: unknown): string => {
  switch (type) {
    case FieldType.SingleLineText:
      return 'Single line text';
    case FieldType.LongText:
      return 'Long text / Rich text';
    case FieldType.Number:
      return 'Number';
    case FieldType.SingleSelect: {
      const opts = options as { choices?: { name: string }[] };
      const choices = opts?.choices?.map((c) => c.name).join(', ') || '';
      return choices ? `Single select (options: ${choices})` : 'Single select';
    }
    case FieldType.MultipleSelect: {
      const opts = options as { choices?: { name: string }[] };
      const choices = opts?.choices?.map((c) => c.name).join(', ') || '';
      return choices ? `Multiple select (options: ${choices})` : 'Multiple select';
    }
    case FieldType.Checkbox:
      return 'Checkbox (true/false)';
    case FieldType.Date:
      return 'Date/Time';
    case FieldType.Attachment:
      return 'File attachments';
    case FieldType.Link: {
      const link = getLinkOptions(options);
      if (link.foreignTableId) {
        const rel = link.relationship ? ` (relationship: ${link.relationship})` : '';
        return `Link to table ${link.foreignTableId}${rel}`;
      }
      return 'Link to another table';
    }
    case FieldType.Formula:
      return 'Computed formula field';
    case FieldType.Rollup:
    case FieldType.ConditionalRollup:
      return 'Rollup (aggregation from linked records)';
    case FieldType.User:
      return 'User reference';
    case FieldType.CreatedTime:
      return 'Created time (auto-generated)';
    case FieldType.LastModifiedTime:
      return 'Last modified time (auto-generated)';
    case FieldType.CreatedBy:
      return 'Created by (auto-generated)';
    case FieldType.LastModifiedBy:
      return 'Last modified by (auto-generated)';
    case FieldType.AutoNumber:
      return 'Auto-incrementing number';
    case FieldType.Rating:
      return 'Rating (1-5 stars)';
    case FieldType.Button:
      return 'Button (trigger actions)';
    default:
      return type;
  }
};

// Synthesize a plausible example value for a field, deterministically (no LLM).
// Returns undefined for fields that should be omitted from a create payload
// (attachments, user, and any computed/auto field).
const getExampleValue = (field: IFieldInfo, foreignMap: ForeignMap): unknown => {
  const type = field.type as FieldType;
  switch (type) {
    case FieldType.SingleLineText:
      return 'Sample text';
    case FieldType.LongText:
      return 'A longer sample description spanning a sentence or two.';
    case FieldType.Number:
      return 42;
    case FieldType.Rating:
      return 3;
    case FieldType.Checkbox:
      return true;
    case FieldType.Date:
      return new Date().toISOString();
    case FieldType.SingleSelect: {
      const opts = field.options as { choices?: { name: string }[] } | undefined;
      return opts?.choices?.[0]?.name ?? 'Option A';
    }
    case FieldType.MultipleSelect: {
      const opts = field.options as { choices?: { name: string }[] } | undefined;
      return [opts?.choices?.[0]?.name ?? 'Option A'];
    }
    case FieldType.Link: {
      const link = getLinkOptions(field.options);
      const samples = link.foreignTableId ? foreignMap[link.foreignTableId]?.samples ?? [] : [];
      const multi = link.relationship ? isMultiValueLink(link.relationship) : true;
      const toRef = (s: IForeignSample) => ({ id: s.id, title: s.title });
      if (samples.length === 0) {
        const placeholder = { id: 'recXXXXXXXXXXXXXX' };
        return multi ? [placeholder] : placeholder;
      }
      return multi ? samples.slice(0, 2).map(toRef) : toRef(samples[0]);
    }
    default:
      // Attachment, User, and computed/auto fields are omitted from the example.
      return undefined;
  }
};

// Build the example create payload from the editable fields.
const buildExampleRecord = (
  fields: IFieldInfo[],
  foreignMap: ForeignMap
): Record<string, unknown> => {
  const example: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.isComputed) continue;
    const value = getExampleValue(field, foreignMap);
    if (value !== undefined) example[field.name] = value;
  }
  return example;
};

const TOKEN_PLACEHOLDER = '<YOUR_API_TOKEN>';

export const generateAIContext = (
  tableName: string,
  tableDescription: string | undefined,
  fields: IFieldInfo[],
  baseUrl: string,
  tableId: string,
  foreignMap: ForeignMap,
  token?: string
): string => {
  const displayToken = token || TOKEN_PLACEHOLDER;
  const fieldDescriptions = fields
    .map((field) => {
      const typeDesc = getFieldTypeDescription(field.type as FieldType, field.options);
      const primary = field.isPrimary ? ' [PRIMARY]' : '';
      const computed = field.isComputed ? ' [READ-ONLY]' : '';
      const desc = field.description ? ` - ${field.description}` : '';
      return `  - "${field.name}" [id: ${field.id}] (${typeDesc})${primary}${computed}${desc}`;
    })
    .join('\n');

  const editableFields = fields
    .filter((f) => !f.isComputed)
    .map((f) => `"${f.name}"`)
    .join(', ');

  // Build the "Example Record" section: a concrete create payload plus, for
  // link fields, notes naming the referenced table and the reference shape.
  const exampleJson = JSON.stringify(
    { fieldKeyType: 'name', records: [{ fields: buildExampleRecord(fields, foreignMap) }] },
    null,
    2
  );
  const linkFields = fields.filter(
    (f) => (f.type as FieldType) === FieldType.Link && !f.isComputed
  );
  const linkNotes = linkFields
    .map((f) => {
      const link = getLinkOptions(f.options);
      const info = link.foreignTableId ? foreignMap[link.foreignTableId] : undefined;
      const target = info?.tableName
        ? `${info.tableName} (${link.foreignTableId})`
        : link.foreignTableId ?? 'the linked table';
      const multi = link.relationship ? isMultiValueLink(link.relationship) : true;
      const shape = multi ? 'an array of record references' : 'a single record reference';
      const rel = link.relationship ? ` [relationship: ${link.relationship}]` : '';
      return `  - "${f.name}" references ${target} — provide ${shape} like \`{ "id": "recXXX" }\`${rel}`;
    })
    .join('\n');
  const exampleSection = `## Example Record

A sample \`POST\` body for creating a record. Link fields use real record IDs fetched from the referenced tables where available; \`recXXXXXXXXXXXXXX\` is a placeholder when the referenced table is empty.

\`\`\`json
${exampleJson}
\`\`\`
${linkFields.length ? `\n### Link / Reference Fields\n${linkNotes}\n` : ''}`;

  return `# Table: ${tableName}
${tableDescription ? `\nDescription: ${tableDescription}\n` : ''}
## API Operations

### 1. Read Records (GET)
\`\`\`bash
curl -X GET "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Pagination
Use \`skip\` and \`take\` parameters:
- \`take\`: Number of records to return (default: 100, max: 1000)
- \`skip\`: Number of records to skip

\`\`\`bash
# Get 20 records, starting from the 41st record (page 3)
curl "${baseUrl}/api/table/${tableId}/record?take=20&skip=40&fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Filtering
Use the \`filter\` parameter with a JSON object.

**⚠️ Important: The \`fieldId\` in filter/orderBy MUST use the actual field ID (e.g., "fldXXXX"), not the field name.**

\`\`\`bash
# Filter records - use field ID from the Fields section above
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  --data-urlencode 'filter={"conjunction":"and","filterSet":[{"fieldId":"fldXXXXXXX","operator":"is","value":"Active"}]}' \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

**Filter Operators**:
- Text: \`is\`, \`isNot\`, \`contains\`, \`doesNotContain\`, \`isEmpty\`, \`isNotEmpty\`
- Number: \`is\`, \`isNot\`, \`isGreater\`, \`isLess\`, \`isGreaterEqual\`, \`isLessEqual\`
- Date: \`is\`, \`isBefore\`, \`isAfter\`, \`isWithin\`

#### Sorting
Use the \`orderBy\` parameter.

**⚠️ Important: The \`fieldId\` in orderBy MUST use the actual field ID (e.g., "fldXXXX"), not the field name.**

\`\`\`bash
# Sort by a field - use field ID from the Fields section above
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name" \\
  --data-urlencode 'orderBy=[{"fieldId":"fldXXXXXXX","order":"desc"}]' \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Field Selection (Projection)
Use the \`projection\` parameter to return only specific fields:
\`\`\`bash
# Only return "Name" and "Email" fields
curl "${baseUrl}/api/table/${tableId}/record?fieldKeyType=name&projection=Name&projection=Email" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

#### Searching
Use the \`search\` parameter:
\`\`\`bash
# Search for "john" in all fields
curl "${baseUrl}/api/table/${tableId}/record?search=john&fieldKeyType=name" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

### 2. Create Record (POST)
\`\`\`bash
curl -X POST "${baseUrl}/api/table/${tableId}/record" \\
  -H "Authorization: Bearer ${displayToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fieldKeyType": "name",
    "records": [
      {
        "fields": {
          // Editable fields: ${editableFields || 'None'}
        }
      }
    ]
  }'
\`\`\`

### 3. Update Record (PATCH)
\`\`\`bash
curl -X PATCH "${baseUrl}/api/table/${tableId}/record/{recordId}" \\
  -H "Authorization: Bearer ${displayToken}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fieldKeyType": "name",
    "record": {
      "fields": {
        // Include only fields you want to update
      }
    }
  }'
\`\`\`

### 4. Delete Record (DELETE)
\`\`\`bash
curl -X DELETE "${baseUrl}/api/table/${tableId}/record/{recordId}" \\
  -H "Authorization: Bearer ${displayToken}"
\`\`\`

---

## API Configuration
- **Base URL**: ${baseUrl}
- **Table ID**: ${tableId}
- **API Token**: ${displayToken}
- **Endpoint**: \`${baseUrl}/api/table/${tableId}/record\`

## Authentication
All requests require the \`Authorization\` header:
\`\`\`
Authorization: Bearer ${displayToken}
\`\`\`

---

## Fields
${fieldDescriptions}

---

${exampleSection}
---

## Notes for AI
- Fields marked [PRIMARY] are the main identifier field
- Fields marked [READ-ONLY] are computed and cannot be directly modified
- Use \`fieldKeyType=name\` to reference fields by their display name in request/response body
- **Important**: \`filter\` and \`orderBy\` parameters MUST use field IDs (the [id: fldXXX] shown above), not field names
- Dates should be in ISO 8601 format (e.g., "2024-01-15T10:30:00Z")
- For select fields, use the exact option names listed above
- For link fields, see the **Example Record** section above for the exact reference shape and the foreign table each field points to
- Response format: \`{ "records": [{ fields: { ... } }] }\`
`;
};
