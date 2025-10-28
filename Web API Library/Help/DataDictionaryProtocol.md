# Data Dictionary Protocol (DDP)

The Data Dictionary Protocol (DDP) exposes DataFlex data dictionaries as a structured REST API. Clients send JSON describing what to do; the server executes the operation through the live DataFlex DD layer — including all validation rules, cascade relationships, and referential integrity checks — and returns the result as JSON.

All requests and responses use the custom content type `application/ddp`. Every request, including GET, must carry `Content-Type: application/ddp` or it will be rejected with 404. If an `Accept` header is present it must be `application/ddp` or `*/*`.

---

## Setup

Add a `cWebAPIDataDictionaryProtocol` object inside your `cWebApi` and call `Send Expose` for each data dictionary class you want to make available:

```dataflex
Object oRestFramework is a cWebApi
    Set psPath to "Api"

    Object oDDPAPI is a cWebAPIDataDictionaryProtocol
        Set psPath to "ddp"

        Send Expose (RefClass(cCustomerDataDictionary))
        Send Expose (RefClass(cOrderHeaderDataDictionary))
        Send Expose (RefClass(cOrderDetailDataDictionary))
        Send Expose (RefClass(cSalesPersonDataDictionary))
    End_Object
End_Object
```

Only exposed tables can be queried or mutated.

---

## Case Sensitivity

**Table names** are matched case-insensitively. `"Customer"`, `"customer"`, and `"CUSTOMER"` all resolve to the same table.

**Field names** in request bodies (`__fields`, constraints, store/update/delete payloads) are also matched case-insensitively. `"Name"`, `"name"`, and `"NAME"` all resolve to the same field.

**Output** always uses the original casing from the DataFlex field and table definitions regardless of how the client supplied the name. A request using `"name"` receives a response with `"Name"`.

---

## Endpoints

| Method | Path | Use case |
|---|---|---|
| `GET` | `/Api/ddp/v1` | Discover which tables are exposed |
| `GET` | `/Api/ddp/v1/schema` | Discover field names and types for all exposed tables |
| `POST` | `/Api/ddp/v1/query` | Read records (single table, related tables, paged, filtered, sorted) |
| `POST` | `/Api/ddp/v1/store` | Create one or more new records |
| `PUT` / `PATCH` | `/Api/ddp/v1/update` | Update an existing record |
| `POST` | `/Api/ddp/v1/delete` | Delete a record with optional optimistic concurrency check |

---

## `GET /Api/ddp/v1`

Returns the protocol version and the names of all exposed tables. Use this to verify connectivity and discover what tables are available before building queries.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |

**Response — `200 OK`**

```json
{
  "version": "1.0",
  "exposed": ["Customer", "OrderHeader", "OrderDetail", "SalesPerson"]
}
```

Table names are returned with their original DataFlex casing.

---

## `GET /Api/ddp/v1/schema`

Returns the field names and types for every exposed table. Use this to build dynamic forms, drive client-side validation, or understand what fields are available before constructing queries.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |

**Response — `200 OK`**

The response is a JSON object keyed by table name. Each value is an object mapping every field name to its type string.

```json
{
  "Customer": {
    "Customer_Number": "integer",
    "Name": "string",
    "Address_1": "string",
    "City": "string",
    "State": "string",
    "Zip": "string",
    "Phone_Number": "string",
    "Fax_Number": "string",
    "EMail_Address": "string",
    "Balance": "decimal",
    "Credit_Limit": "decimal",
    "Date_Created": "date",
    "SalesPerson_ID": "integer"
  },
  "OrderHeader": {
    "Order_Number": "integer",
    "Customer_Number": "integer",
    "SalesPerson_ID": "integer",
    "Order_Date": "date",
    "Order_Total": "decimal"
  }
}
```

**Type strings**

| Type | When used |
|---|---|
| `"integer"` | Whole-number numeric field (BCD, precision = 0) |
| `"decimal"` | Fractional numeric field (BCD, precision > 0) |
| `"date"` | Date field |
| `"string"` | All other field types (text, ASCII, etc.) |

---

## `POST /Api/ddp/v1/query`

Reads records from one or more related tables. This is the most flexible endpoint — it supports filtering, ordering, pagination, field projection, and three different response shapes.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |
| `DDPStyle` | `nested` (default), `flat`, or `flatlinked` |

**Request body**

The root object contains one or more top-level keys, each being a table name mapped to a table query object.

```json
{
  "<TableName>": { <table query> }
}
```

> In `flat` and `flatlinked` modes only one top-level table is allowed.

---

### Table Query Object

| Key | Type | Description |
|---|---|---|
| `__limit` | integer | Maximum rows to return. Omit for no limit. |
| `__offset` | integer | Rows to skip before collecting. Use with `__limit` for paging. |
| `__fields` | string[] | Field names to include. Omit to return all fields. Case-insensitive. |
| `<FieldName>` | scalar | Equality constraint on that field (shorthand for `<FieldName>_eq`). |
| `<FieldName>_eq` | scalar | Equal to. |
| `<FieldName>_ne` | scalar | Not equal to. |
| `<FieldName>_lt` | scalar | Less than. |
| `<FieldName>_le` | scalar | Less than or equal to. |
| `<FieldName>_ge` | scalar | Greater than or equal to. |
| `<FieldName>_gt` | scalar | Greater than. |
| `<FieldName>_di` | `"asc"` or `"desc"` | Sort order for this field. Multiple fields supported; applied in declaration order. |
| `<RelatedTableName>` | object | Include a directly related table (parent or child). See [Related Tables](#related-tables). |

Constraint suffixes and ordering values are case-insensitive (`_GE`, `"ASC"` both work).

### Pagination

Use `__limit` and `__offset` together to page through results:

```json
{ "Customer": { "__limit": 25, "__offset":  0 } }   // page 1
{ "Customer": { "__limit": 25, "__offset": 25 } }   // page 2
{ "Customer": { "__limit": 25, "__offset": 50 } }   // page 3
```

When `__offset` exceeds the available rows the result is an empty array with status 200.

### Related Tables

Nest a related table by including its name as a key with its own table query object as the value. The table must be directly related via the data dictionary (`Add_Server_File` or `Add_Client_File`). Whether it is a parent (1-to-1) or child (1-to-N) is determined automatically.

```json
{
  "OrderHeader": {
    "__limit": 50,
    "Customer": {},
    "SalesPerson": {},
    "OrderDetail": {
      "__fields": ["Detail_Number", "Qty_Ordered", "Price"]
    }
  }
}
```

---

## Response Modes

### Nested (default — `DDPStyle: nested`)

Each queried table is a key in the response object. Its value is an array of row objects. Related **parent** tables are embedded as objects inside each row. Related **child** tables are embedded as arrays inside each row.

**Use case:** Loading a form or detail view where you need the full object graph in one request.

**Request**

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
```

```json
{
  "OrderHeader": {
    "__limit": 2,
    "Customer": {},
    "OrderDetail": {}
  }
}
```

**Response**

```json
{
  "OrderHeader": [
    {
      "Order_Number": 1,
      "Order_Date": "2025-01-15",
      "Order_Total": 249.95,
      "Customer": {
        "Customer_Number": 5,
        "Name": "Acme Industries"
      },
      "OrderDetail": [
        { "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98 },
        { "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price":  49.97 }
      ]
    },
    {
      "Order_Number": 2,
      "Order_Date": "2025-01-22",
      "Order_Total": 89.50,
      "Customer": {
        "Customer_Number": 5,
        "Name": "Acme Industries"
      },
      "OrderDetail": [
        { "Detail_Number": 1, "Qty_Ordered": 1, "Price": 89.50, "Extended_Price": 89.50 }
      ]
    }
  ]
}
```

---

### Flat (`DDPStyle: flat`)

All tables appear as top-level keys. Arrays are **index-aligned** with the main table: position `i` in every parent array corresponds to position `i` in the main array. If multiple main rows share the same parent, that parent record is duplicated. Child tables are arrays-of-arrays: position `i` is the array of children for main row `i`.

**Use case:** Grid-style displays, spreadsheet exports, or scenarios where you need all data in flat parallel arrays and duplicates are acceptable.

**Request**

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPStyle: flat
```

```json
{
  "OrderHeader": {
    "__limit": 3,
    "Customer": {},
    "SalesPerson": {},
    "OrderDetail": {
      "__fields": ["Detail_Number", "Qty_Ordered", "Price", "Extended_Price"]
    }
  }
}
```

**Response**

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Customer_Number": 5, "SalesPerson_ID": 2, "Order_Total": 249.95 },
    { "Order_Number": 2, "Customer_Number": 5, "SalesPerson_ID": 3, "Order_Total":  89.50 },
    { "Order_Number": 3, "Customer_Number": 8, "SalesPerson_ID": 2, "Order_Total": 540.00 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 8, "Name": "Blue Sky Corp",   "City": "Tampa"   }
  ],
  "SalesPerson": [
    { "SalesPerson_ID": 2, "Name": "John Smith" },
    { "SalesPerson_ID": 3, "Name": "Jane Doe"   },
    { "SalesPerson_ID": 2, "Name": "John Smith" }
  ],
  "OrderDetail": [
    [
      { "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98 },
      { "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price":  49.97 }
    ],
    [
      { "Detail_Number": 1, "Qty_Ordered": 1, "Price": 89.50, "Extended_Price":  89.50 }
    ],
    [
      { "Detail_Number": 1, "Qty_Ordered": 3, "Price": 60.00, "Extended_Price": 180.00 },
      { "Detail_Number": 2, "Qty_Ordered": 2, "Price": 45.00, "Extended_Price":  90.00 },
      { "Detail_Number": 3, "Qty_Ordered": 1, "Price": 270.00,"Extended_Price": 270.00 }
    ]
  ]
}
```

`Customer[0]` and `Customer[1]` are the same record — orders 1 and 2 both belong to customer 5. `SalesPerson[0]` and `SalesPerson[2]` are the same — orders 1 and 3 share the same salesperson.

---

### FlatLinked (`DDPStyle: flatlinked`)

Like `flat` but **deduplicated** — each unique record appears exactly once. Parent arrays contain one entry per unique parent record; child arrays contain all child rows as a single flat array. Foreign key fields are always included so clients can join the arrays themselves.

**Use case:** Efficiently loading reference data for a UI (e.g. a data grid with lookup tables), or feeding a client-side normalised store. Reduces payload size when many main rows share the same parent.

**Request**

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPStyle: flatlinked
```

```json
{
  "OrderHeader": {
    "__limit": 3,
    "Customer": {},
    "SalesPerson": {},
    "OrderDetail": {
      "__fields": ["Order_Number", "Detail_Number", "Qty_Ordered", "Price", "Extended_Price"]
    }
  }
}
```

**Response**

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Customer_Number": 5, "SalesPerson_ID": 2, "Order_Total": 249.95 },
    { "Order_Number": 2, "Customer_Number": 5, "SalesPerson_ID": 3, "Order_Total":  89.50 },
    { "Order_Number": 3, "Customer_Number": 8, "SalesPerson_ID": 2, "Order_Total": 540.00 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 8, "Name": "Blue Sky Corp",   "City": "Tampa"   }
  ],
  "SalesPerson": [
    { "SalesPerson_ID": 2, "Name": "John Smith" },
    { "SalesPerson_ID": 3, "Name": "Jane Doe"   }
  ],
  "OrderDetail": [
    { "Order_Number": 1, "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98 },
    { "Order_Number": 1, "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price":  49.97 },
    { "Order_Number": 2, "Detail_Number": 1, "Qty_Ordered": 1, "Price": 89.50, "Extended_Price":  89.50 },
    { "Order_Number": 3, "Detail_Number": 1, "Qty_Ordered": 3, "Price": 60.00, "Extended_Price": 180.00 },
    { "Order_Number": 3, "Detail_Number": 2, "Qty_Ordered": 2, "Price": 45.00, "Extended_Price":  90.00 },
    { "Order_Number": 3, "Detail_Number": 3, "Qty_Ordered": 1, "Price": 270.00,"Extended_Price": 270.00 }
  ]
}
```

Customer 5 appears once despite being referenced by two orders. `Order_Number` on each `OrderDetail` row is the join key back to `OrderHeader`.

---

## `POST /Api/ddp/v1/store`

Creates one or more new records via the DataFlex DD layer. All DD validation rules (required fields, range checks, cross-field constraints) are enforced before saving. The response contains the saved record(s) with any server-assigned values (auto-increment PKs, computed defaults) already populated.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |

**Request body**

The body is a single **store-object** or a JSON array of store-objects.

A store-object has exactly one top-level key — the table name — whose value is a field map. Only include fields you want to set; omitted fields receive DD defaults. `null` values are silently skipped.

```
{ "<TableName>": { "<FieldName>": <value>, ... } }
```

**Single record**

```json
{ "Customer": { "Name": "Acme Corp", "EMail_Address": "info@acme.com" } }
```

**Array of records**

Each element is an independent store-object. Elements may target different tables.

```json
[
  { "Customer": { "Name": "Acme Corp",    "EMail_Address": "info@acme.com"    } },
  { "Customer": { "Name": "Blue Sky Ltd", "EMail_Address": "info@bluesky.com" } }
]
```

**With nested child records**

Child records are nested as a JSON array under their table name inside the parent object. The DD layer automatically seeds the foreign key on each child from the saved parent buffer — you do not supply the FK value.

```json
{
  "OrderHeader": {
    "Customer_Number": 5,
    "OrderDetail": [
      { "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99 },
      { "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97 }
    ]
  }
}
```

A single child object (not an array) is accepted and treated as a one-element list.

> Only **child** tables (1-to-N client files) may be nested. To link a parent (e.g. a Customer to an OrderHeader), set the FK field directly on the main record — do not nest the parent.

**Response — `201 Created`**

Shape mirrors the request. Single-object request → object keyed by table name. Array request → flat array.

Single record:

```json
{
  "Customer": {
    "Customer_Number": 42,
    "Name": "Acme Corp",
    "EMail_Address": "info@acme.com"
  }
}
```

With nested children:

```json
{
  "OrderHeader": {
    "Order_Number": 7,
    "Customer_Number": 5,
    "OrderDetail": [
      { "Order_Number": 7, "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98 },
      { "Order_Number": 7, "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price":  49.97 }
    ]
  }
}
```

---

## `PUT|PATCH /Api/ddp/v1/update`

Updates an existing record via the DataFlex DD layer. The record is identified by its primary key field(s) in the request body. Only the fields you supply are changed — all other fields retain their current database values. `PUT` and `PATCH` behave identically.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |

**Request body**

Single **update-object** or a JSON array of update-objects.

An update-object has exactly one top-level key — the table name — whose value maps field names to values. PK fields identify the record; all other supplied fields are written as new values. Only scalar values are accepted; nested objects or arrays are not permitted.

```
{ "<TableName>": { "<PKField>": <value>, "<FieldToChange>": <value>, ... } }
```

**Single record**

```json
{ "Customer": { "Customer_Number": 42, "Name": "New Name", "EMail_Address": "new@acme.com" } }
```

**Array of records**

```json
[
  { "Customer": { "Customer_Number": 42, "Name": "New Name"   } },
  { "Customer": { "Customer_Number": 43, "Name": "Other Name" } }
]
```

**Response — `200 OK`**

The updated record(s) serialised after the save, so server-computed values (triggers, computed fields) are reflected.

Single record:

```json
{
  "Customer": {
    "Customer_Number": 42,
    "Name": "New Name",
    "EMail_Address": "new@acme.com"
  }
}
```

---

## `POST /Api/ddp/v1/delete`

Deletes one or more records via the DataFlex DD layer. The record is identified by its primary key field(s). Any additional fields supplied act as an **optimistic concurrency check**: the server reads the record by PK and verifies that every extra field still matches before deleting. If a field has changed, the delete is rejected with `409 Conflict`.

Cascade deletes (child record removal) are governed entirely by the DD's `Cascade_Delete_State` setting — the client does not control which related records are removed.

The response contains a snapshot of the deleted record(s) taken **before** deletion.

**Required headers**

| Header | Value |
|---|---|
| `Content-Type` | `application/ddp` |

**Request body**

Single **delete-object** or a JSON array of delete-objects.

A delete-object has exactly one top-level key — the table name — whose value maps field names to values. Only scalar values are accepted.

```
{ "<TableName>": { "<PKField>": <value>, "<OptionalVerifyField>": <value>, ... } }
```

**Single record — PK only**

```json
{ "Customer": { "Customer_Number": 42 } }
```

**Single record with verification fields**

```json
{
  "Customer": {
    "Customer_Number": 42,
    "Name": "Acme Corp",
    "EMail_Address": "info@acme.com"
  }
}
```

If `Name` or `EMail_Address` no longer match the database record, the server returns `409 Conflict` and the record is not deleted.

**Array of records**

```json
[
  { "Customer": { "Customer_Number": 42 } },
  { "Customer": { "Customer_Number": 43 } }
]
```

**Response — `200 OK`**

Snapshot of deleted record(s) taken before deletion. Shape mirrors the request.

Single record:

```json
{
  "Customer": {
    "Customer_Number": 42,
    "Name": "Acme Corp",
    "EMail_Address": "info@acme.com"
  }
}
```

---

## Error Responses

All errors return a JSON object:

```json
{
  "type": "about:blank",
  "status": 422,
  "title": "Validation Error",
  "detail": "EMail_Address is required.",
  "instance": "/Api/ddp/v1/store"
}
```

### Query (`/query`)

| Situation | Status |
|---|---|
| Invalid `DDPStyle` header value | 405 |
| Request body is not valid JSON | 405 |
| Root is not a JSON object | 405 |
| More than one table in a `flat` or `flatlinked` request | 405 |
| Table name not exposed | 405 |
| Related table not directly related to the queried table | 405 |
| Invalid `__limit` or `__offset` (not an integer) | 405 |
| Invalid `__fields` (not an array) | 405 |
| Unknown field name in `__fields` or constraint | 405 |
| Invalid ordering value (not `"asc"` or `"desc"`) | 405 |

### Store (`/store`)

| Situation | Status |
|---|---|
| Request body is not valid JSON | 405 |
| Root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed | 405 |
| Nested table is not a direct child of the parent | 405 |
| Nested table is a parent (server file) rather than a child | 405 |
| Unknown field name | 405 |
| DD validation rules failed (required field, range check, etc.) | 422 |
| Save failed at the database level | 422 |

### Update (`/update`)

| Situation | Status |
|---|---|
| Request body is not valid JSON | 405 |
| Root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed | 405 |
| Nested object or array value (only scalars accepted) | 405 |
| Unknown field name | 405 |
| A required primary key field was not supplied | 405 |
| No record found matching the supplied primary key | 404 |
| DD validation rules failed | 422 |
| Save failed at the database level | 422 |

### Delete (`/delete`)

| Situation | Status |
|---|---|
| Request body is not valid JSON | 405 |
| Root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed | 405 |
| Nested object or array value (only scalars accepted) | 405 |
| Unknown field name | 405 |
| A required primary key field was not supplied | 405 |
| No record found matching the supplied primary key | 404 |
| A verification field does not match the current database value | 409 |
| DD validation prevented the delete | 422 |
| Delete failed at the database level | 422 |
