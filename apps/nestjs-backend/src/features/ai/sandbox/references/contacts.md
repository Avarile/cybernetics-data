# contacts — tblBVWS56TLkQqW3J4z

People in the system: internal staff, external partners, contractors, etc.

## Fields

| Display Name                | Field ID            | Type                            | Writable | Notes                                                      |
| --------------------------- | ------------------- | ------------------------------- | -------- | ---------------------------------------------------------- |
| Label                       | fldCwghjVZqx0SBTQSH | Single line text                | Yes      | PRIMARY — auto-set from firstname+lastname or manually     |
| record_id                   | fldeQ62TIzU9rIRv0xz | Auto-incrementing number        | No       | READ-ONLY                                                  |
| created_at                  | fldJi8hCqwicBhCcMGr | Created time                    | No       | READ-ONLY                                                  |
| update_at                   | fldEZdaeuAley9G761M | Last modified time              | No       | READ-ONLY                                                  |
| firstname                   | fldf1hpQYPWqcKoejHA | Single line text                | Yes      |                                                            |
| lastname                    | fldk8dAUdMKPAnfrO2x | Single line text                | Yes      |                                                            |
| email                       | fldSbbeLg8zRK54MS8n | Single line text                | Yes      | unique identifier for lookups                              |
| mobile                      | fldknfNcNOE6fUkKJMD | Single line text                | Yes      |                                                            |
| landline                    | fldU1LajzAa9m4ESZB6 | Single line text                | Yes      |                                                            |
| title                       | fldL1sGrxt6i5OQht7P | Single line text                | Yes      | job title / position                                       |
| age                         | fld5MBDEbIsILaEJW1R | Number                          | Yes      |                                                            |
| nickname                    | fldRTuzNBVEDapUD0Ry | Single line text                | Yes      |                                                            |
| internal_contact_type       | fldvakGkDtRXYOEBNxu | Single link → contact-type      | Yes      | **REQUIRED on create**; single record `{ "id": "recXXX" }` |
| internal_contact_profession | fld5jvIWvcZm7waQiBr | Multi-link → contact-profession | Yes      | array `[{ "id": "recXXX" }]`                               |
| tasks                       | fldH533OMLkSWAmQiYA | Multi-link → tasks              | Yes      |                                                            |
| projects                    | fldboPhfNXcf1GJtVYN | Multi-link → projects           | Yes      |                                                            |
| department                  | fldluX15rOczzzhznKH | Multi-link → departments        | Yes      |                                                            |
| role                        | fld2ilgjEnTHPah0SKX | Multi-link → roles              | Yes      |                                                            |

## Required Fields on Create

- `internal_contact_type` (single link) — must be a valid contact-type record ID.
  Call `queryRecords` on table `tblXWCU7zG6yVPpnH50`, filtering field `fldnyYl4qoi7Rj2vuWH`, first.

## Common Filter Examples

Find by email:

```json
{
  "conjunction": "and",
  "filterSet": [{ "fieldId": "fldSbbeLg8zRK54MS8n", "operator": "is", "value": "jane@example.com" }]
}
```

Find by last name (contains):

```json
{
  "conjunction": "and",
  "filterSet": [{ "fieldId": "fldk8dAUdMKPAnfrO2x", "operator": "contains", "value": "Smith" }]
}
```

Find all with empty email:

```json
{ "conjunction": "and", "filterSet": [{ "fieldId": "fldSbbeLg8zRK54MS8n", "operator": "isEmpty" }] }
```

## Example Payloads

### Create a contact

```json
{
  "tableId": "tblBVWS56TLkQqW3J4z",
  "records": [
    {
      "fields": {
        "firstname": "Jane",
        "lastname": "Smith",
        "email": "jane.smith@example.com",
        "mobile": "+61 400 000 000",
        "title": "Software Engineer",
        "internal_contact_type": { "id": "recXXXXXXX" }
      }
    }
  ]
}
```

### Update a contact's title and department

```json
{
  "tableId": "tblBVWS56TLkQqW3J4z",
  "recordId": "recXXXXXXX",
  "fields": {
    "title": "Senior Software Engineer",
    "department": [{ "id": "recDeptId" }]
  }
}
```
