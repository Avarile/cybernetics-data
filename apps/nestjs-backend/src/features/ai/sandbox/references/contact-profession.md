# contact-profession — tblSceUZHrMe5psnhCZ

Professional specialisation of contacts: e.g. "Software Engineer", "Designer", "Accountant".

## Fields

| Display Name      | Field ID            | Type                  | Writable | Notes           |
| ----------------- | ------------------- | --------------------- | -------- | --------------- |
| Label             | fldSKRAlDgG0I9HuUld | Single line text      | Yes      | PRIMARY         |
| record_id         | fldJhXa5DeYC5bYGWW4 | Auto number           | No       | READ-ONLY       |
| created_at        | fldvBKZZr4P9syIgVQb | Created time          | No       | READ-ONLY       |
| title             | fldEEYC8IGsxhCKy49F | Single line text      | Yes      | profession name |
| context           | fld8R6jvgNP3cPOr9q2 | Long text             | Yes      |                 |
| contacts-internal | fld3WhZxZox1r55OSp0 | Multi-link → contacts | Yes      | reverse link    |

## Usage

Lookup a profession record ID before setting `internal_contact_profession` on a contact:

```
queryRecords({
  "tableId": "tblSceUZHrMe5psnhCZ",
  "filter": { "conjunction": "and", "filterSet": [
    { "fieldId": "fldEEYC8IGsxhCKy49F", "operator": "is", "value": "Software Engineer" }
  ] },
  "take": 2
})
```

Use the `id` of the returned record.

## Example Payloads

### Create a profession

```json
{
  "tableId": "tblSceUZHrMe5psnhCZ",
  "records": [
    {
      "fields": {
        "title": "DevOps Engineer",
        "context": "Specialises in CI/CD, infrastructure, and platform reliability"
      }
    }
  ]
}
```
