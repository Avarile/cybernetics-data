# knowledge-type — tbl2vKKo0l3RfSvKzM1

Categories for knowledge base articles (e.g. "How-to", "Policy", "Runbook").

## Fields

| Display Name | Field ID            | Type                    | Writable | Notes       |
| ------------ | ------------------- | ----------------------- | -------- | ----------- |
| Label        | fldkBfd3ambfvY33532 | Single line text        | Yes      | PRIMARY     |
| record_id    | fldVYt0qrtrLGQOrZR3 | Auto number             | No       | READ-ONLY   |
| created_at   | fldEQW6ENjSlR6b9ncW | Created time            | No       | READ-ONLY   |
| title        | fldpzHMiqnvE3pXzFfD | Single line text        | Yes      | type name   |
| context      | fldvb52dQ4jSw4H4x2Q | Long text               | Yes      | description |
| knowledges   | fldHcnuYGYRRcS2uuhX | Multi-link → knowledges | Yes      |             |

## Usage

Read all types to discover valid IDs before creating a knowledge record:

```
queryRecords({ "tableId": "tbl2vKKo0l3RfSvKzM1", "take": 50 })
```

## Example Payloads

### Create a knowledge type

```json
{
  "tableId": "tbl2vKKo0l3RfSvKzM1",
  "records": [
    { "fields": { "title": "Runbook", "context": "Operational procedures for on-call engineers" } }
  ]
}
```
