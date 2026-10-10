# contact-type — tblXWCU7zG6yVPpnH50

Classification of contacts: e.g. "Employee", "Contractor", "Vendor", "Partner".
This is a **required** field when creating a contact.

## Fields

| Display Name      | Field ID            | Type                  | Writable | Notes        |
| ----------------- | ------------------- | --------------------- | -------- | ------------ |
| Label             | fldnyYl4qoi7Rj2vuWH | Single line text      | Yes      | PRIMARY      |
| record_id         | fldJbrkaFSFq4pdWfKv | Auto number           | No       | READ-ONLY    |
| created_at        | fldGHxWFcuujyLN29Lo | Created time          | No       | READ-ONLY    |
| update_at         | fldATvhyUUEkATeBEuu | Last modified time    | No       | READ-ONLY    |
| title             | fldIGDeAfwj7LukG0Kn | Single line text      | Yes      | type name    |
| context           | fldPsjAmgUsPnGq3Mis | Long text             | Yes      |              |
| contacts-internal | fld9dMELOhAw618pDKR | Multi-link → contacts | Yes      | reverse link |

## Key Use: Resolving Required Link for Contact Create

Before creating a contact, look up a valid contact-type ID:

```
queryRecords({
  "tableId": "tblXWCU7zG6yVPpnH50",
  "filter": { "conjunction": "and", "filterSet": [
    { "fieldId": "fldIGDeAfwj7LukG0Kn", "operator": "is", "value": "Employee" }
  ] },
  "take": 2
})
```

Then use the `id` of the returned record as `internal_contact_type: { "id": "recXXX" }` in the contact create payload.

## Example Payloads

### Create a contact type

```json
{
  "tableId": "tblXWCU7zG6yVPpnH50",
  "records": [
    {
      "fields": {
        "title": "Contractor",
        "context": "External contractor engaged on a fixed-term basis"
      }
    }
  ]
}
```
