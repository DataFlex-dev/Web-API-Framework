# Data Dictionary Protocol (DDP)

The Data Dictionary Protocol (DDP) exposes DataFlex data dictionaries as a structured REST API. Clients send JSON describing what to do; the server executes the operation through the live DataFlex DD layer — including all validation rules, cascade relationships, and referential integrity checks — and returns the result as JSON.

Requests use the custom content type `application/ddp`; responses are JSON
and use `application/json`. Every request, including GET, must carry
`Content-Type: application/ddp` or it is rejected with 404. If an
`Accept` header is present it must be `application/ddp` or `*/*`; any other
value is rejected with 400.

Contents:

- [Setup](#setup)
- [Endpoints](#endpoints) and [headers](#headers)
- [Query request formats](#query-request-formats): [Legacy](#legacy-format) and [DbMessage](#dbmessage-format)
- [Response styles](#response-styles): `nested`, `flat`, `flatlinked`
- [Writes](#post-apiddpv1store): `/store`, `/update`, `/save`, `/delete`
- [Error responses](#error-responses)
- [Backend differences](#backend-differences)

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

Only exposed tables can be queried or written. Related tables are only reachable when they are exposed too.

`Expose` rules:

- It must be called while the object is constructed; a call at runtime raises an error.
- The class must create a valid data dictionary. On the Windows backend its table must be open and its driver must support SQL filters (the embedded DataFlex database does not).
- The resource name is the DataFlex logical file name of the DD's main table. Exposing a table twice raises an error.
- The relationships between exposed tables are taken from the DD classes (Windows: `Add_Server_File` / `Add_Client_File`; cross-platform: the schema relations of the DDs).

### `OnExposeDD`

`OnExposeDD tDDPDataDictPair Def` fires once per exposed DD, before its relationships are recorded. Use it to configure the DD instance the protocol keeps (`Def.hoDD`), for example a database adapter on the cross-platform backend or a `psSQLFilter` on the Windows backend. A SQL filter set here or in the DD class is kept; every request adds its own filters to it.

```dataflex
Class cMyDataDictionaryProtocol is a cWebAPIDataDictionaryProtocol
    { MethodType = Event }
    Procedure OnExposeDD tDDPDataDictPair Def
        Set phoAdapter of Def.hoDD to oSqliteAdapter
    End_Procedure
End_Class
```

### Securing the endpoint

`cWebAPIDataDictionaryProtocol` is a `cWebApiRouter`, so it follows the normal modifier rules: place it inside a router that holds an authentication modifier to protect every DDP endpoint.

```dataflex
Object oSecureRouter is a cWebApiRouter
    Set psPath to "secure"

    Object oAuth is a cJWTAuthentication
    End_Object

    Object oDDPAPI is a cWebAPIDataDictionaryProtocol
        Set psPath to "ddp"
        Send Expose (RefClass(cCustomerDataDictionary))
    End_Object
End_Object
```

### Configuration properties

| Property | Default | Meaning |
|---|---|---|
| `pbShowRequestErrorDetail` | `True` | Show the error text of request errors. See [Error detail and logging](#error-detail-and-logging). |
| `pbShowValidationErrorDetail` | `True` | Show the error text of DD validation failures. |
| `pbShowDatabaseErrorDetail` | `False` | Show the error text of failed finds, saves, updates and deletes. |
| `pbShowUnexpectedErrorDetail` | `False` | Show the error text of unexpected DataFlex errors (status 500). |
| `psGenericErrorMessage` | `The server could not process the request. Reference: %1` | Client text for a hidden error; `%1` is the log reference. |

---

## Case Sensitivity

**Table names** are matched case-insensitively. `"Customer"`, `"customer"`, and `"CUSTOMER"` all resolve to the same table.

**Field names** in request bodies (`__fields`, `fields`, constraints, ordering, store/update/save/delete payloads) are also matched case-insensitively. `"Name"`, `"name"`, and `"NAME"` all resolve to the same field.

**Keywords** are case-insensitive: Legacy suffixes (`_GE`), ordering directions (`"ASC"`), DbMessage operators (`"GT"`), cursor modes and `/save` operations (`"Create"`). DbMessage **member names** (`table`, `join`, `fields`, `constraints`, `orderBy`, `limit`, `offset`, `cursor`) and the `DDPStyle` header value are case-sensitive.

**Output names** use the original casing from the DataFlex definition: field names, discovery, schema, related-table names and the parent/child arrays of `flat` and `flatlinked`. The key of a main table in a query response and of a record in a store, update, delete or save response mirrors the table name as it was sent in the request.

---

## Endpoints

| Method | Path | Use case |
|---|---|---|
| `GET` | `/Api/ddp/v1` | Discover which tables are exposed |
| `GET` | `/Api/ddp/v1/schema` | Discover field names and types for all exposed tables |
| `POST` | `/Api/ddp/v1/query` | Read records (related tables, filtered, sorted, paged, cursor-based) |
| `POST` | `/Api/ddp/v1/store` | Create one or more new records, optionally with child records |
| `PUT` / `PATCH` | `/Api/ddp/v1/update` | Update one or more existing records |
| `POST` | `/Api/ddp/v1/save` | Write the records of one client `Request_Save` in one transaction |
| `POST` | `/Api/ddp/v1/delete` | Delete one or more records with an optional optimistic concurrency check |
| `OPTIONS` | `/Api/ddp`, `/Api/ddp/v1` | Capability discovery (`Allow`) and CORS preflight (`Access-Control-Allow-Methods`) |

Any other verb on an endpoint returns 405.

### Headers

| Header | Applies to | Values |
|---|---|---|
| `Content-Type` | every request | `application/ddp` (required, otherwise 404) |
| `Accept` | every request | absent, `application/ddp` or `*/*` (otherwise 400) |
| `DDPFormat` | `/query` | `Legacy` (default) or `DbMessage`, case-insensitive. Selects the [request body format](#query-request-formats). |
| `DDPStyle` | `/query` | `nested` (default), `flat` or `flatlinked`, lowercase. Selects the [response style](#response-styles). |

An unknown `DDPFormat` or `DDPStyle` value returns 405.

## Recommended use

DDP is schema-driven. Let the server describe its exposed tables, then build
requests from that description instead of hard-coding fields:

1. `GET /Api/ddp/v1` to verify the endpoint and discover exposed tables.
2. `GET /Api/ddp/v1/schema` to discover field names and field types.
3. Use `POST /Api/ddp/v1/query` for reads, in the `Legacy` format: it is
   the format for regular API consumers. The `DbMessage` format exists for
   `cDDPDriver` (see [Query request formats](#query-request-formats)). Pick
   the response style that suits the client: `nested` for an object graph,
   `flat` for position-aligned rows, `flatlinked` for a normalised,
   deduplicated result.
4. Use `POST /save` to create and update records: it writes all records of
   one save in one transaction. `POST /store` and `PUT` or `PATCH /update`
   remain available for simple clients; use `POST /delete` for removals.

### Endpoints used by `cDDPDriver`

`cDDPDriver` (DataFlex Database Framework, `Db\cDDPDriver.pkg`) is the DDP client adapter behind data dictionaries that read and write through a DDP server. Its connection URI is the version base, for example `https://host/Api/ddp/v1` (no trailing slash). Every request carries `Content-Type` and `Accept` `application/ddp`, `DDPFormat: DbMessage` and `DDPStyle: flat`.

| Driver operation | Endpoint | Request |
|---|---|---|
| `InitializeConnection` | `GET /Api/ddp/v1` | Connection check; any status other than 200 fails the connection. |
| `FindRecord` (every find mode) | `POST /Api/ddp/v1/query` | DbMessage query with `limit: 1`: constraints, a multi-field constraint for `GT`/`GE`/`LT`/`LE`, `orderBy` ending in the primary key (reversed for `LT`, `LE`, `LAST_RECORD`), and joins to the parents. |
| `QueryRecords` | `POST /Api/ddp/v1/query` | DbMessage query with `fields`, `join`, `constraints` (including `or`/`and` groups and `contains`), `orderBy`, `limit`, `offset` and `cursor`. |
| `SaveRecords` (creates and updates) | `POST /Api/ddp/v1/save` | One item per record of a `Request_Save`, parents first; expects 200. |
| `DeleteRecord` | `POST /Api/ddp/v1/delete` | `{"<Table>": {<primary key>}}` for a single record by RowID; the server's DD applies the cascade. Expects 200. |

The driver does not use `/schema`, `/store` or `/update`, the `Legacy` format, or the `nested` and `flatlinked` styles. Changes to `/query` (DbMessage, flat), `/save` and `/delete` therefore affect every `cDDPDriver` client; the other endpoints serve direct HTTP clients. On a failed request the driver reports the response's `detail`, or `DDP <operation>: HTTP <status>.` when there is none.

---

## `GET /Api/ddp/v1`

Returns the protocol version and the names of all exposed tables. Use this to verify connectivity and discover what tables are available before building queries.

**Response — `200 OK`**

```json
{
  "version": "1.0",
  "exposed": ["Customer", "OrderDetail", "OrderHeader", "SalesPerson"]
}
```

Table names are returned with their original DataFlex casing, sorted by name.

---

## `GET /Api/ddp/v1/schema`

Returns the field names and types for every exposed table. Use this to build dynamic forms, drive client-side validation, or understand what fields are available before constructing queries.

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
| `"integer"` | Whole-number numeric field (BCD, precision = 0, Windows backend; integer types on the cross-platform backend) |
| `"decimal"` | Fractional numeric field (BCD, precision > 0, Windows backend; every Number, Decimal, Currency, Real and Float on the cross-platform backend, whatever the Size) |
| `"date"` | Date field |
| `"string"` | All other field types (text, ASCII, etc.) |

---

## `POST /Api/ddp/v1/query`

Reads records from one table and its related tables. It supports filtering, ordering, offset and cursor paging, field projection, and three response styles.

### Query request formats

The `DDPFormat` header selects one of two request body formats. Both are executed by the same engine and both work with every [response style](#response-styles).

- **`Legacy`** is the format for regular consumption: web pages, scripts, integrations and other HTTP clients. It is the default, and nested table objects make object-graph reads with child tables straightforward.
- **`DbMessage`** is meant for `cDDPDriver` to talk to the server in a format that looks like a database message: one main table, joins, and flat lists of fields, constraints and sort fields, mirroring the find and query requests a data dictionary sends to its database driver. It covers what a driver needs (`or`/`and` groups, `contains`, multi-field index constraints, cursor paging). Other clients can use it, but `Legacy` is the format to build against.

| | `Legacy` (default) | `DbMessage` |
|---|---|---|
| Shape | Root keys are table names; each table is an object that holds its own constraints, ordering and related tables | One structured object: `table`, `join`, `fields`, `constraints`, `orderBy`, `limit`, `offset`, `cursor` |
| Main tables per request | One or more (`nested`); one (`flat`, `flatlinked`) | One |
| Parent tables | Nested table objects, any depth | `join` entries, any depth |
| Child tables | Yes, with their own limit, offset, constraints and ordering | No |
| Field names | Plain (`Name`) inside the table's object | Qualified (`Customer.Name`) |
| Operators | `eq`, `ne`, `lt`, `le`, `ge`, `gt` | `eq`, `ne`, `contains`, `lt`, `le`, `ge`, `gt` |
| `or` / `and` groups | No | Yes, nested to any depth |
| Multi-field (index) constraint | No | Yes, one per request, main table |
| Ordering | `_di` members; precedence by position or `{dir, seq}` | `orderBy` array; precedence by position |
| Paging | `__limit`, `__offset` per table | `limit`, `offset` and `cursor` on the main table |

`ne` is supported by the Windows backend only; the cross-platform backend rejects it (405). See [Backend differences](#backend-differences).

---

### Legacy format

`DDPFormat` absent or `Legacy`. The root object contains one or more keys, each a table name mapped to a table query object.

```json
{
  "<TableName>": { <table query> }
}
```

> In `flat` and `flatlinked` styles only one top-level table is allowed.

#### Table query object

| Key | Type | Description |
|---|---|---|
| `__limit` | integer | Rows to return for this table. Defaults to 200; zero means no limit. For a child table the limit applies per parent row. |
| `__offset` | integer | Rows to skip before collecting. Use with `__limit` for paging. |
| `__fields` | string[] | Fields to return. Omit to return all fields; `[]` returns none. |
| `<FieldName>` | scalar | Equality constraint on that field (shorthand for `<FieldName>_eq`). |
| `<FieldName>_eq` | scalar | Equal to. |
| `<FieldName>_ne` | scalar | Not equal to. Windows backend only; rejected (405) by the cross-platform backend. |
| `<FieldName>_lt` | scalar | Less than. |
| `<FieldName>_le` | scalar | Less than or equal to. |
| `<FieldName>_ge` | scalar | Greater than or equal to. |
| `<FieldName>_gt` | scalar | Greater than. |
| `<FieldName>_di` | `"asc"`, `"desc"` or `{"dir", "seq"}` | Sort order for this field. See [Ordering](#ordering). |
| `<RelatedTableName>` | object | Include a directly related table (parent or child). Its value is another table query object. See [Related tables](#related-tables). |

`__limit` and `__offset` must be non-negative JSON integers, not quoted strings. Constraint values must be JSON scalars; the only objects are related tables and `{dir, seq}` ordering values. Unknown members are rejected (405) rather than ignored, which makes a misspelled field visible to the client.

Constraint values are checked against the field type:

- Numeric fields: the value must be numeric, otherwise 405.
- Date fields: `YYYY-MM-DD`. The cross-platform backend also accepts `""` or `"0"` for the empty date.

#### Constraints on related tables

Constraints in a **parent** table's object filter the main rows: `{"OrderHeader": {"Customer": {"State": "FL"}}}` returns only the orders of customers in Florida. Constraints in a **child** table's object filter only the child rows returned for each parent row; they do not filter the parent rows.

#### Ordering

Every table query object holds the `_di` members of its own table only. To sort the main rows by a parent field, put the `_di` member in that parent's nested object.

A `_di` value is either a direction string or an object with an explicit precedence:

| Form | Precedence |
|---|---|
| `"asc"` / `"desc"` | The member's position in the request, read depth-first (a nested parent object counts at the position where it appears). |
| `{"dir": "asc" \| "desc", "seq": <integer>}` | `seq`, lowest first. |

```json
{
  "OrderHeader": {
    "Order_Number_di": { "dir": "asc", "seq": 3 },
    "Terms_di":        { "dir": "asc", "seq": 1 },
    "Customer": {
      "Name_di": { "dir": "asc", "seq": 0 },
      "City_di": { "dir": "asc", "seq": 2 }
    }
  }
}
```

This sorts by `Customer.Name`, `Terms`, `Customer.City`, then `Order_Number`: with `seq`, any order across tables can be expressed. With direction strings the sort fields of a parent (and its own parents) can only form one adjacent group, because one table is one object.

A table and its parents must use one form. Each child table has its own sort order and is checked separately. Mixing strings and `{dir, seq}` objects, using a `seq` twice, or an object without an integer `seq` and a valid `dir` is rejected (405). Parent-table ordering is applied by the cross-platform backend; the Windows backend sorts on main-table fields only and ignores parent sort fields.

#### Pagination

Use `__limit` and `__offset` together to page through results:

```json
{ "Customer": { "__limit": 25, "__offset":  0 } }   // page 1
{ "Customer": { "__limit": 25, "__offset": 25 } }   // page 2
{ "Customer": { "__limit": 25, "__offset": 50 } }   // page 3
```

When `__offset` exceeds the available rows the result is an empty array with status 200. For stable pages, sort on a unique key or add the primary key as the last sort field. The Windows backend appends the unsorted primary-key fields as a tie-breaker automatically.

#### Related tables

Nest a related table by including its name as a key with its own table query object as the value. The table must be exposed and directly related via the data dictionary (`Add_Server_File` or `Add_Client_File`). Whether it is a parent (1-to-1) or child (1-to-N) is determined automatically. Nesting may continue to any depth: grandparents inside a parent, grandchildren inside a child, the parents of a child inside the child.

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

#### Legacy example with every member

```json
{
  "OrderHeader": {
    "__limit": 20,
    "__offset": 40,
    "__fields": ["Order_Number", "Order_Date", "Order_Total"],
    "Terms": "NET30",
    "Ship_Via_eq": "UPS",
    "Order_Total_gt": 100,
    "Order_Date_ge": "2026-01-01",
    "Order_Number_lt": 5000,
    "Last_Detail_Num_le": 10,
    "Order_Date_di": { "dir": "desc", "seq": 1 },
    "Order_Number_di": { "dir": "asc", "seq": 2 },
    "Customer": {
      "__fields": ["Customer_Number", "Name", "City"],
      "State_eq": "UT",
      "Name_di": { "dir": "asc", "seq": 0 }
    },
    "SalesPerson": {
      "__fields": ["ID", "Name"]
    },
    "OrderDetail": {
      "__limit": 5,
      "__offset": 0,
      "__fields": ["Detail_Number", "Item_ID", "Qty_Ordered", "Price"],
      "Qty_Ordered_gt": 0,
      "Detail_Number_di": "asc"
    }
  }
}
```

---

### DbMessage format

`DDPFormat: DbMessage`. This is the format `cDDPDriver` uses to communicate with the server; regular clients should use the [Legacy format](#legacy-format). The body is one query object that reads like a database message: a main table, the parent tables joined to it, and flat lists of fields, constraints and sort fields that name each field as `Table.Field`.

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPFormat: DbMessage
DDPStyle: flat
```

```json
{
  "table": "Customer",
  "join": [
    { "table": "SalesPerson", "from": "Customer" }
  ],
  "fields": ["Customer.Customer_Number", "Customer.Name", "SalesPerson.Name"],
  "constraints": [
    { "field": "Customer.State", "op": "eq", "value": "FL" },
    { "field": "Customer.Balance", "op": "gt", "value": 100 }
  ],
  "orderBy": [
    { "field": "SalesPerson.Name", "dir": "asc" },
    { "field": "Customer.Name", "dir": "asc" }
  ],
  "limit": 20,
  "offset": 0
}
```

#### Members

| Member | Type | Required | Description |
|---|---|---|---|
| `table` | string | yes | The main table. |
| `join` | array of `{"table", "from"}` | no | Parent tables to join. See [Joins](#joins). |
| `fields` | array of `"Table.Field"` | no | Fields to return. Omit to return every field of every table. When present, each table returns exactly the fields listed for it; a joined table with no listed fields returns no fields. |
| `constraints` | array | no | Constraints, all ANDed. Each element is a [field constraint](#field-constraints), a [group](#or-and-and-groups) or a [multi-field constraint](#multi-field-index-constraints). |
| `orderBy` | array of `{"field", "dir"}` | no | Sort fields, highest precedence first. See [Ordering (DbMessage)](#ordering-dbmessage). |
| `limit` | integer | no | Rows to return. Defaults to 200; zero means no limit. |
| `offset` | integer | no | Rows to skip before collecting. |
| `cursor` | `{"mode", "rowid"}` | no | Start after or before a known row. See [Cursor paging](#cursor-paging). |

Any other member is rejected (405). `limit` and `offset` must be non-negative JSON integers. Every `Table.Field` must name the main table or a joined table, and a field of that table.

#### Joins

```json
"join": [
  { "table": "OrderHeader", "from": "OrderDetail" },
  { "table": "Customer",    "from": "OrderHeader" },
  { "table": "SalesPerson", "from": "OrderHeader" }
]
```

- `table` must be an exposed **parent** of `from`; child tables cannot be joined.
- `from` must be the main table or a table joined earlier in the array, so grandparents are joined through their child.
- A table can be joined only once.
- A joined parent is 1-to-1 with the main row; `limit` and `offset` apply to the main table only.

#### Field constraints

```json
{ "field": "Customer.Name", "op": "contains", "value": "Corp" }
```

| `op` | Meaning |
|---|---|
| `eq` | Equal to. |
| `ne` | Not equal to. Windows backend only; rejected (405) by the cross-platform backend. |
| `contains` | The text contains `value`, matched literally. Text fields only (cross-platform: String; Windows: ASCII and Text). |
| `lt`, `le`, `ge`, `gt` | Less than, less or equal, greater or equal, greater than. |

`value` must be a JSON scalar. A constraint may be on the main table or any joined table; a constraint on a joined table filters the main rows. Values are checked against the field type as in the Legacy format (numbers numeric, dates `YYYY-MM-DD`).

#### `or` and `and` groups

A group is an object with one member, `or` or `and`, holding an array of members. A member is a field constraint or another group, so groups nest to any depth. An `or` group matches when any member matches; an `and` group when every member matches. The `constraints` array itself is an AND, so an `and` group is only needed inside an `or`.

```json
{
  "table": "Customer",
  "constraints": [
    { "field": "Customer.Balance", "op": "gt", "value": 100 },
    { "or": [
      { "field": "Customer.State", "op": "eq", "value": "FL" },
      { "and": [
        { "field": "Customer.State", "op": "eq", "value": "GA" },
        { "field": "Customer.City", "op": "eq", "value": "Atlanta" }
      ] }
    ] }
  ],
  "limit": 20
}
```

- Members may be on the main table or any joined table (cross-platform backend). The Windows backend accepts main-table members only.
- A range (`Between`) inside an `or` is an `and` group of `ge` and `le`.
- On the cross-platform backend a member with an empty string value on a String field is ignored by the driver and matches every row: it drops the whole `or` group and is left out of an `and` group.
- Multi-field constraints are not allowed inside a group. An empty group is an error.

#### Multi-field (index) constraints

A multi-field constraint selects the rows after (`gt`, `ge`) or before (`lt`, `le`) a tuple of values in the order of a multi-segment index. It is the DDP equivalent of a `Find GT` on an index, without the OR/AND expansion on the client.

```json
{
  "field": ["Customer.Name", "Customer.Customer_Number"],
  "op": "gt",
  "value": ["Jansen", 12],
  "dir": ["asc", "desc"]
}
```

- `op` is `gt`, `ge`, `lt` or `le`.
- `field` and `value` are arrays of the same length; `dir` is optional (default `asc` per field) and, when present, has the same length.
- All fields must belong to the main table.
- One multi-field constraint per request. It cannot be combined with `cursor` or used inside a group.

#### Ordering (DbMessage)

`orderBy` lists the sort fields, highest precedence first. Fields may come from any joined table and are sorted in array order, whatever their table. Each field may appear once; `dir` is required. The Windows backend sorts on main-table fields only and ignores sort fields of joined tables.

#### Cursor paging

A cursor continues from a known row instead of skipping `offset` rows, so pages stay stable while rows are inserted or deleted.

```json
"cursor": { "mode": "gt", "rowid": 12 }
```

- `mode` `gt` returns the rows after the cursor row in the `orderBy` order; `lt` returns the rows before it, nearest first. The cursor row itself is not returned.
- `rowid` is the cursor row's primary key: a scalar for a single-field key, an array with one value per key field (in primary index order) for a composite key. Date key values use `YYYY-MM-DD`.
- The main table must have a primary key.
- Use the same `constraints` and `orderBy` as the request that produced the cursor row.
- Windows backend: the cursor row must still exist (otherwise 405 `Cursor row not found.`) and may not have an empty date in a sort field.

Next page after the row with key 12:

```json
{
  "table": "Customer",
  "orderBy": [ { "field": "Customer.Name", "dir": "asc" } ],
  "cursor": { "mode": "gt", "rowid": 12 },
  "limit": 20
}
```

Previous page: the same request with `"mode": "lt"`; reverse the returned rows for display.

#### Find equivalents

DataFlex find modes map to a `limit: 1` query on the index fields:

| Find | DbMessage |
|---|---|
| `FIRST_RECORD` | `orderBy` the index fields ascending |
| `LAST_RECORD` | `orderBy` the index fields descending |
| `EQ` | one `eq` constraint per index field |
| `GT` / `GE` | multi-field constraint `gt` / `ge` on the index fields, `orderBy` ascending |
| `LT` / `LE` | multi-field constraint `lt` / `le` on the index fields, `orderBy` descending |

```json
{
  "table": "Customer",
  "constraints": [
    { "field": ["Customer.Name", "Customer.Customer_Number"], "op": "ge", "value": ["Jansen", 12] }
  ],
  "orderBy": [
    { "field": "Customer.Name", "dir": "asc" },
    { "field": "Customer.Customer_Number", "dir": "asc" }
  ],
  "limit": 1
}
```

For an index with a descending segment, pass `dir` in the multi-field constraint and mirror it in `orderBy` (flip every direction for `lt`/`le`).

#### DbMessage example with every member

```json
{
  "table": "OrderDetail",
  "join": [
    { "table": "OrderHeader", "from": "OrderDetail" },
    { "table": "Customer", "from": "OrderHeader" },
    { "table": "SalesPerson", "from": "OrderHeader" }
  ],
  "fields": ["OrderDetail.Qty_Ordered", "OrderHeader.Order_Date", "Customer.Name", "SalesPerson.Name"],
  "constraints": [
    { "field": "Customer.State", "op": "eq", "value": "UT" },
    { "field": "Customer.Name", "op": "contains", "value": "Corp" },
    { "field": "OrderDetail.Qty_Ordered", "op": "gt", "value": 0 },
    { "field": "OrderDetail.Price", "op": "ge", "value": 10 },
    { "field": "OrderHeader.Order_Total", "op": "lt", "value": 50000 },
    { "field": "OrderHeader.Order_Date", "op": "le", "value": "2026-10-23" },
    { "or": [
      { "field": "SalesPerson.Name", "op": "eq", "value": "Bakker" },
      { "and": [
        { "field": "SalesPerson.Name", "op": "eq", "value": "Jansen" },
        { "field": "Customer.Status", "op": "eq", "value": "Y" }
      ] }
    ] }
  ],
  "orderBy": [
    { "field": "Customer.Name", "dir": "asc" },
    { "field": "OrderHeader.Order_Date", "dir": "desc" }
  ],
  "cursor": { "mode": "gt", "rowid": [1042, 3] },
  "limit": 20,
  "offset": 0
}
```

This example targets the cross-platform backend: the Windows backend rejects the `or` group (members on joined tables) and ignores the sort fields of joined tables.

---

## Response Styles

The `DDPStyle` header selects the response shape. It applies to both request formats; in DbMessage the joined tables are the parent tables.

| | `nested` (default) | `flat` | `flatlinked` |
|---|---|---|---|
| Main rows | Array under the main table key | Array under the main table key | Array under the main table key |
| Parent tables | Object inside each row; direct parents only | Top-level array per parent table, index-aligned with the main rows; includes grandparents | Top-level array per parent table, each record once; includes grandparents |
| Missing parent record | `{}` | `{}` (keeps the alignment) | left out |
| Child tables | Array inside each row | Top-level array of arrays: element `i` holds the children of main row `i` | Top-level flat array, each record once |
| Child `__limit` / `__offset` | Per parent row | Per parent row | Ignored: all children of the returned main rows |
| Grandchildren | Nested inside the child rows | Nested inside the child rows | Not returned |
| Main tables per request | One or more | One | One |

In `nested`, grandparent tables still filter and sort the rows, but their fields are not returned; use `flat` or `flatlinked` to receive them. In `flatlinked`, the key fields that link the arrays (foreign keys) are always included, even when `__fields`/`fields` leaves them out.

### One query, three styles

The same request, sent once with each `DDPStyle` value. Orders 1 and 2 both belong to customer 5; order 1 has two detail lines, order 2 has one.

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPStyle: nested | flat | flatlinked
```

```json
{
  "OrderHeader": {
    "__limit": 2,
    "__fields": ["Order_Number", "Order_Total"],
    "Customer": { "__fields": ["Customer_Number", "Name"] },
    "OrderDetail": { "__fields": ["Detail_Number", "Qty_Ordered"] }
  }
}
```

**`nested`**: parents and children live inside each order.

```json
{
  "OrderHeader": [
    {
      "Order_Number": 1,
      "Order_Total": 249.95,
      "Customer": { "Customer_Number": 5, "Name": "Acme Industries" },
      "OrderDetail": [
        { "Detail_Number": 1, "Qty_Ordered": 2 },
        { "Detail_Number": 2, "Qty_Ordered": 1 }
      ]
    },
    {
      "Order_Number": 2,
      "Order_Total": 89.5,
      "Customer": { "Customer_Number": 5, "Name": "Acme Industries" },
      "OrderDetail": [
        { "Detail_Number": 1, "Qty_Ordered": 1 }
      ]
    }
  ]
}
```

**`flat`**: one top-level array per table, aligned by position. `Customer[i]` is the customer of `OrderHeader[i]` (customer 5 is repeated); `OrderDetail[i]` holds the details of `OrderHeader[i]`.

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Order_Total": 249.95 },
    { "Order_Number": 2, "Order_Total": 89.5 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries" },
    { "Customer_Number": 5, "Name": "Acme Industries" }
  ],
  "OrderDetail": [
    [
      { "Detail_Number": 1, "Qty_Ordered": 2 },
      { "Detail_Number": 2, "Qty_Ordered": 1 }
    ],
    [
      { "Detail_Number": 1, "Qty_Ordered": 1 }
    ]
  ]
}
```

**`flatlinked`**: each record once, joined by key. The linking foreign keys are added after the requested fields even though `__fields` leaves them out: `Customer_Number` on `OrderHeader` and `Order_Number` on `OrderDetail`.

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Order_Total": 249.95, "Customer_Number": 5 },
    { "Order_Number": 2, "Order_Total": 89.5, "Customer_Number": 5 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries" }
  ],
  "OrderDetail": [
    { "Detail_Number": 1, "Qty_Ordered": 2, "Order_Number": 1 },
    { "Detail_Number": 2, "Qty_Ordered": 1, "Order_Number": 1 },
    { "Detail_Number": 1, "Qty_Ordered": 1, "Order_Number": 2 }
  ]
}
```

The sections below describe each style in detail.

### Nested (default — `DDPStyle: nested`)

Each queried table is a key in the response object. Its value is an array of row objects. Related **parent** tables are embedded as objects inside each row. Related **child** tables are embedded as arrays inside each row.

**Use case:** Loading a form or detail view where you need the full object graph in one request.

The [example above](#one-query-three-styles) shows a nested response. A nested request may also contain several main tables; each becomes its own key in the response:

```json
{
  "Customer": { "__limit": 10, "__fields": ["Customer_Number", "Name"] },
  "SalesPerson": { "__fields": ["SalesPerson_ID", "Name"] }
}
```

---

### Flat (`DDPStyle: flat`)

All tables appear as top-level keys. Arrays are **index-aligned** with the main table: position `i` in every parent array corresponds to position `i` in the main array. If multiple main rows share the same parent, that parent record is duplicated. Child tables are arrays-of-arrays: position `i` is the array of children for main row `i`.

**Use case:** Grid-style displays, spreadsheet exports, or scenarios where you need all data in flat parallel arrays and duplicates are acceptable.

**Request**

The [example above](#one-query-three-styles) extended with a third order, a second parent table and more fields.

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPStyle: flat
```

```json
{
  "OrderHeader": {
    "__limit": 3,
    "__fields": ["Order_Number", "Customer_Number", "SalesPerson_ID", "Order_Total"],
    "Customer": { "__fields": ["Customer_Number", "Name", "City"] },
    "SalesPerson": { "__fields": ["SalesPerson_ID", "Name"] },
    "OrderDetail": { "__fields": ["Detail_Number", "Qty_Ordered", "Price", "Extended_Price"] }
  }
}
```

**Response**

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Customer_Number": 5, "SalesPerson_ID": 2, "Order_Total": 249.95 },
    { "Order_Number": 2, "Customer_Number": 5, "SalesPerson_ID": 3, "Order_Total": 89.5 },
    { "Order_Number": 3, "Customer_Number": 8, "SalesPerson_ID": 2, "Order_Total": 540 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 8, "Name": "Blue Sky Corp", "City": "Tampa" }
  ],
  "SalesPerson": [
    { "SalesPerson_ID": 2, "Name": "John Smith" },
    { "SalesPerson_ID": 3, "Name": "Jane Doe" },
    { "SalesPerson_ID": 2, "Name": "John Smith" }
  ],
  "OrderDetail": [
    [
      { "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98 },
      { "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price": 49.97 }
    ],
    [
      { "Detail_Number": 1, "Qty_Ordered": 1, "Price": 89.5, "Extended_Price": 89.5 }
    ],
    [
      { "Detail_Number": 1, "Qty_Ordered": 3, "Price": 60, "Extended_Price": 180 },
      { "Detail_Number": 2, "Qty_Ordered": 2, "Price": 45, "Extended_Price": 90 },
      { "Detail_Number": 3, "Qty_Ordered": 1, "Price": 270, "Extended_Price": 270 }
    ]
  ]
}
```

`Customer[0]` and `Customer[1]` are the same record: orders 1 and 2 both belong to customer 5. `SalesPerson[0]` and `SalesPerson[2]` are the same: orders 1 and 3 share salesperson 2.

---

### FlatLinked (`DDPStyle: flatlinked`)

Like `flat` but **deduplicated** — each unique record appears exactly once. Parent arrays contain one entry per unique parent record; child arrays contain all child rows as a single flat array. Foreign key fields are always included so clients can join the arrays themselves.

**Use case:** Efficiently loading reference data for a UI (e.g. a data grid with lookup tables), or feeding a client-side normalised store. Reduces payload size when many main rows share the same parent.

**Request**

The same body as the [flat example](#flat-ddpstyle-flat), with `DDPStyle: flatlinked`.

```http
POST /Api/ddp/v1/query
Content-Type: application/ddp
DDPStyle: flatlinked
```

**Response**

```json
{
  "OrderHeader": [
    { "Order_Number": 1, "Customer_Number": 5, "SalesPerson_ID": 2, "Order_Total": 249.95 },
    { "Order_Number": 2, "Customer_Number": 5, "SalesPerson_ID": 3, "Order_Total": 89.5 },
    { "Order_Number": 3, "Customer_Number": 8, "SalesPerson_ID": 2, "Order_Total": 540 }
  ],
  "Customer": [
    { "Customer_Number": 5, "Name": "Acme Industries", "City": "Orlando" },
    { "Customer_Number": 8, "Name": "Blue Sky Corp", "City": "Tampa" }
  ],
  "SalesPerson": [
    { "SalesPerson_ID": 2, "Name": "John Smith" },
    { "SalesPerson_ID": 3, "Name": "Jane Doe" }
  ],
  "OrderDetail": [
    { "Detail_Number": 1, "Qty_Ordered": 2, "Price": 99.99, "Extended_Price": 199.98, "Order_Number": 1 },
    { "Detail_Number": 2, "Qty_Ordered": 1, "Price": 49.97, "Extended_Price": 49.97, "Order_Number": 1 },
    { "Detail_Number": 1, "Qty_Ordered": 1, "Price": 89.5, "Extended_Price": 89.5, "Order_Number": 2 },
    { "Detail_Number": 1, "Qty_Ordered": 3, "Price": 60, "Extended_Price": 180, "Order_Number": 3 },
    { "Detail_Number": 2, "Qty_Ordered": 2, "Price": 45, "Extended_Price": 90, "Order_Number": 3 },
    { "Detail_Number": 3, "Qty_Ordered": 1, "Price": 270, "Extended_Price": 270, "Order_Number": 3 }
  ]
}
```

Customer 5 and salesperson 2 each appear once, although two orders reference them. `Order_Number` is not in the `OrderDetail` `__fields`, but it is added as the join key back to `OrderHeader`.

### Value types

Numbers are written as JSON numbers; dates and all other fields as strings. Dates are converted with the DataFlex runtime's date-to-string conversion, so their format follows the server's date settings, while date values in requests (constraints, cursor keys) must be `YYYY-MM-DD`. The cross-platform backend also writes Boolean/Bit fields as `true`/`false` and the empty date as `""`. See [DDP Backends](DDP%20Backends.md#5-response-shape-and-field-types) for the full mapping.

---

## `POST /Api/ddp/v1/store`

Creates one or more new records via the DataFlex DD layer. All DD validation rules (required fields, range checks, cross-field constraints) are enforced before saving. The response contains the saved record(s) with any server-assigned values (auto-increment PKs, computed defaults) already populated.

**Request body**

The body is a single **store-object** or a JSON array of store-objects.

A store-object has exactly one top-level key — the table name — whose value is a field map. Only include fields you want to set; omitted fields receive DD defaults. `null` values are skipped.

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

Child records are nested as a JSON array under their table name inside the parent object. The foreign key on each child is seeded from the saved parent — you do not supply the FK value. Children may nest their own children.

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

> Only **child** tables (1-to-N client files) may be nested. To link a parent (e.g. a Customer to an OrderHeader), set the FK field directly on the main record — do not nest the parent. A FK value without a matching parent record fails validation (422).

**Transactions:** records are saved one by one: the parent first, then its children, then the next array element. A store request is not one transaction; when a record fails, the records saved before it stay saved. Use [`/save`](#post-apiddpv1save) when the records must be written atomically.

**Response — `201 Created`**

Shape mirrors the request. Single-object request → object keyed by table name. Array request → array of records. Each record contains all its fields after the save; child records are grouped in an array per child table.

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

Updates existing records via the DataFlex DD layer. The record is identified by its primary key field(s) in the request body. Only the fields you supply are changed — all other fields retain their current database values. `PUT` and `PATCH` behave identically.

**Request body**

Single **update-object** or a JSON array of update-objects.

An update-object has exactly one top-level key — the table name — whose value maps field names to values. Every primary-key field must be present; it identifies the record and cannot be changed. All other supplied fields are written as new values. Only scalar values are accepted; nested objects or arrays are not permitted. `null` values are skipped.

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

Changing a foreign key moves the record to the new parent; the DD logic updates both parent records (for example balances). Updates do not cascade to child records. Like `/store`, an array is not one transaction.

**Response — `200 OK`**

The updated record(s) with all fields, read after the save, so server-computed values (DD logic, computed fields) are reflected. Shape mirrors the request.

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

## `POST /Api/ddp/v1/save`

Writes the records of one client `Request_Save` (`cDDPDriver.SaveRecords` of the DataFlex Database Framework) in one transaction.

This is the main write endpoint: `cDDPDriver` sends every create and update here, not to `/store` or `/update`; deletes go to [`/delete`](#post-apiddpv1delete). See [Endpoints used by `cDDPDriver`](#endpoints-used-by-cddpdriver).

The body is an array with one item per record, parents before children. Each item is `{"create": {"<Table>": {...}}}` or `{"update": {"<Table>": {...}}}` (operation names are case-insensitive). `create` carries every field of the record; `update` carries the primary key plus the changed fields (primary keys can't be changed). `null` values are skipped; nested tables are not allowed.

```json
[
  {"create": {"Vendor": {"ID": 0, "Name": "New Vendor"}}},
  {"update": {"Inventory": {"Item_ID": "BOOK-1", "Description": "Changed", "Vendor_ID": 3}}}
]
```

The server writes exactly these records, in order: no parent records are saved and only the record's own DD validation runs. After a `create`, the key of the created record is copied into the foreign key fields of every later item whose table relates to it. Any failure rolls back the whole save.

On the Windows backend each record is saved with its DD's `Request_Save` while the parent DDs are detached, so the DD's own save logic (`Creating`, `Update`, `Backout`) runs, but changes it makes to parent records are not saved; send those as their own `update` items.

Response `200`: an array in the same order, `[{"Vendor": {record}}, {"Inventory": {record}}]`, each record with all fields after the save. An empty array returns `[]`. Error details are prefixed with `Save item <n>: ` (1-based).

---

## `POST /Api/ddp/v1/delete`

Deletes one or more records via the DataFlex DD layer. The record is identified by its primary key field(s). Any additional fields supplied act as an **optimistic concurrency check**: the server reads the record by PK and verifies that every extra field still matches before deleting. If a field has changed, the delete is rejected with `409 Conflict`. The values are compared as text, so send them as the server returned them.

`POST` is used instead of `DELETE` because many HTTP clients do not send a body with `DELETE`.

Cascade deletes (child record removal) are governed entirely by the DD's `Cascade_Delete_State` setting — the client does not control which related records are removed. With `Cascade_Delete_State` True the delete cascades through every level of exposed child tables; with False it is refused while records exist in an exposed child table.

Deletes, `/store` and `/update` work through the exposed DDs: the exposed parent tables (and their parents) are validated and updated by the DD logic, and the exposed child tables take part in the cascade. A related table that is not exposed has no DD on the server:

- Windows backend: the write is rejected (405, "'<Table>' is related to '<Table>' but not exposed") when the DD class declares the table with `Add_Server_File` (every write), or with `Add_Client_File` (deletes), like a classic DDO structure without that DD. Expose every table the DD structure needs.
- Cross-platform backend: tables declared with `ParentRequired` or `ChildRequired` must have a DD, the save or delete fails otherwise; other related tables are skipped, as in any native DDO structure without their DD.

**Request body**

Single **delete-object** or a JSON array of delete-objects.

A delete-object has exactly one top-level key — the table name — whose value maps field names to values. Every primary-key field must be present. Only scalar values are accepted; `null` values are skipped.

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

Like `/store`, an array is not one transaction: records deleted before a failing element stay deleted.

**Response — `200 OK`**

Snapshot of the deleted record(s), all fields, taken before deletion. Shape mirrors the request.

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

### Error detail and logging

Every DDP error falls into one category. Its property on `cWebAPIDataDictionaryProtocol` decides whether `detail` carries the full error text or `psGenericErrorMessage` (default `The server could not process the request. Reference: %1`). When `pbDebugMode` of the `cWebApi` is True every detail is shown.

| Category | Errors | Property | Default |
|---|---|---|---|
| Request | header, JSON shape, verb, unknown table/field, key, not found, ... | `pbShowRequestErrorDetail` | True |
| Validation | `DDPERR_VALIDATION_FAILED` | `pbShowValidationErrorDetail` | True |
| Database | `DDPERR_FIND_FAILED`, `DDPERR_SAVE_FAILED`, `DDPERR_UPDATE_FAILED`, `DDPERR_DELETE_FAILED` | `pbShowDatabaseErrorDetail` | False |
| Unexpected | `DDPERR_UNEXPECTED` (a DataFlex error outside a handled path, status 500) | `pbShowUnexpectedErrorDetail` | False |

`status` and `title` are never hidden. On the Windows backend validation failures of `/save` arrive as `DDPERR_SAVE_FAILED` (Database category).

- `OnDDPError tDDPErrorInfo ByRef info` fires for every error. Change `info.bShowDetail`, `info.iStatusCode`, `info.sTitle` or `info.sDetail`; `info.aReportedErrors` holds the DataFlex errors (number, line, text) of the request. Debug mode still shows the detail after the event.
- `LogDDPError tDDPErrorInfo info` writes every error with full detail and the reference (`YYYYMMDD-HHMMSS-XXXX`) to the WebApp Server event log. Override it to log elsewhere, or with an empty body to stop logging. The request body is not logged.

### All endpoints

| Situation | Status |
|---|---|
| `Content-Type` is not `application/ddp` | 404 |
| `Accept` is not absent, `application/ddp` or `*/*` | 400 |
| Verb not supported by the endpoint | 405 |
| Unexpected DataFlex error | 500 |

### Query (`/query`)

Every query error returns 405.

| Situation | Status |
|---|---|
| Invalid `DDPStyle` or `DDPFormat` header value | 405 |
| Request body is not valid JSON, or root is not a JSON object | 405 |
| More than one table in a `flat` or `flatlinked` request | 405 |
| Table name not exposed, or related table not directly related | 405 |
| Invalid `__limit`/`limit` or `__offset`/`offset` (not an integer or negative) | 405 |
| Invalid `__fields`/`fields` (not an array) or unknown field | 405 |
| Unknown member or constraint key | 405 |
| Constraint value does not match the field type (numeric, date), or `ne` on the cross-platform backend | 405 |
| Invalid ordering value, mixed Legacy ordering forms, repeated `seq`, or a field ordered twice (DbMessage) | 405 |
| DbMessage: unknown root member, unqualified field, invalid join (not a parent, unknown `from`, joined twice), invalid operator, invalid group or multi-field constraint, invalid cursor | 405 |
| Windows backend: group member on a joined table, cursor row not found, cursor row with an empty date in a sort field | 405 |
| Find failed at the database level (Database category) | 405 |

### Store (`/store`)

| Situation | Status |
|---|---|
| Request body is not valid JSON, or root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed, or nested table not a direct child | 405 |
| Unknown field name | 405 |
| Windows backend: a table the DD structure needs is not exposed | 405 |
| FK value without a matching parent record, or DD validation failed | 422 |
| Save failed at the database level | 422 |

### Update (`/update`)

| Situation | Status |
|---|---|
| Request body is not valid JSON, or root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed | 405 |
| Nested object or array value (only scalars accepted) | 405 |
| Unknown field name | 405 |
| A required primary key field was not supplied | 405 |
| No record found matching the supplied primary key | 404 |
| DD validation rules failed | 422 |
| Update failed at the database level | 422 |

### Save (`/save`)

`detail` is prefixed with `Save item <n>: ` (1-based) for errors of one item.

| Situation | Status |
|---|---|
| Request body is not valid JSON, or root is not an array | 405 |
| Item is not `{"create"\|"update": {"<Table>": {...}}}`, nested table, unknown table or field | 405 |
| Update without its primary key field(s) | 405 |
| No record found matching the supplied primary key | 404 |
| DD validation rules failed | 422 |
| Save failed at the database level | 422 |

### Delete (`/delete`)

| Situation | Status |
|---|---|
| Request body is not valid JSON, or root is not an object or array | 405 |
| Element is not an object with exactly one table key | 405 |
| Table name not exposed | 405 |
| Nested object or array value (only scalars accepted) | 405 |
| Unknown field name | 405 |
| A required primary key field was not supplied | 405 |
| Windows backend: a table the DD structure needs is not exposed | 405 |
| No record found matching the supplied primary key | 404 |
| A verification field does not match the current database value | 409 |
| DD validation prevented the delete | 422 |
| Delete failed at the database level | 422 |

---

## Backend differences

The compiler selects the cross-platform (Main) backend or the Windows backend. Request formats, response styles and write pipelines are shared; these features differ:

| Feature | Cross-platform | Windows |
|---|---|---|
| `ne` / `_ne` | rejected (405) | supported |
| `contains` | String fields | ASCII and Text fields |
| Sort on parent / joined-table fields | yes | ignored; main-table fields only |
| `or`/`and` group members on joined tables | yes | rejected (405) |
| Empty date constraint (`""`, `"0"`) | accepted | rejected |
| Backslash in a text or datetime constraint value | accepted | SQL Server and DB2 drivers only; rejected (405) on other drivers |
| Cursor row deleted, or empty date in a sort field | no check | rejected (405) |
| Exposed table driver | any | must support SQL filters |
| `/save` validation failure category | Validation | Database (detail hidden by default) |

[DDP Backends](DDP%20Backends.md) covers every difference, including value types and performance.
