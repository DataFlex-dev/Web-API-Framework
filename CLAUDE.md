# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A DataFlex library for building REST APIs with drag-and-drop components in DataFlex Studio. It ships as two parts:

- **`Web API Library/`** — the reusable framework library (attach to any workspace)
- **`Web API Sample/`** — a working reference application built with the library

DataFlex uses `.pkg` (package/class) and `.wo` (web object) files. Classes are instantiated as nested `Object ... End_Object` blocks rather than called directly.

## Building & Running

There is no CLI build command. The project is built and run through **DataFlex Studio** (Windows IDE):

1. Open the `.sws` workspace file in DataFlex Studio
2. Use Studio's build commands to compile
3. Run `WebApp.exe` from `Web API Sample/Programs/` to serve the sample API

For JWT authentication, `l8w8jwt2.dll` / `l8w8jwt264.dll` must be present in `Programs/`.

The sample application serves the API at `/Api/...` and exposes Swagger UI via the built-in `cSwaggerUI` web control.

## Architecture

### Request Flow

```
HTTP Request
  → cWebApi (cWebHttpHandler subclass, mounted at /Api)
      → selects iterator based on Accept header (JSON or XML)
      → runs modifiers (auth, logging, etc.)
      → cWebApiRouter (routes by psPath segment)
          → cRestDataset / cWebApiCustomEndpoint / cWebAPIDataDictionaryProtocol
              → OnHttpGet / OnHttpPost / OnHttpPut / OnHttpPatch / OnHttpDelete
```

### Core Classes (`Web API Library/AppSrc/WebApi/`)

| Class | Role |
|---|---|
| `cWebApi` | Root HTTP handler. Registers iterators, fires pre/post events, owns the OpenAPI endpoint. |
| `cWebApiRouter` | Groups child endpoints under a path prefix. Supports middleware via `cWebApiModifier`. |
| `cRestDataset` | Data-aware endpoint backed by a DataFlex data dictionary. Handles CRUD, filtering, pagination. |
| `cBaseRestDataset` | Abstract base with routing and field exposure logic. |
| `cRestField` | Exposes a single DD field using `Entry_Item` syntax, mirroring DataFlex forms. |
| `cWebApiCustomEndpoint` | For non-data-driven endpoints (e.g. file upload/download). |
| `cWebApiLoginEndpoint` | Credential exchange endpoint producing a session/token. |
| `cOpenApiSpecification` | Generates the OpenAPI 3.x JSON spec from all registered endpoints. |
| `cJSONIterator` / `cXMLIterator` | Serialize/deserialize request and response bodies. |
| `cWebApiModifier` | Middleware mixin — implement `OnPreRequest`/`OnPostRequest` for auth, logging, etc. |
| `cWebApiAuthModifier` | Base class for authentication modifiers. |

### Data Dictionary Protocol (`DDP/`)

`cWebAPIDataDictionaryProtocol` auto-exposes DataFlex data dictionaries as REST resources using the custom content type `application/vnd.dataflex.ddp`. Add DDs via `Send Expose (RefClass(...))`. It uses conditional compilation (`#IFDEF IS$TECHSTACK`) to select between `Classic.pkg` and `Main.pkg` backends.

### Mixin Pattern

Cross-cutting concerns are mixed in rather than inherited. Key mixins:
- `cWebApiModifierHost_Mixin` — lets a router/endpoint host modifiers
- `cWebApiRoutableHost_Mixin` — lets a router register and route to children
- `cWebApiErrorHandler_Mixin` — standard error response formatting

### Call Context (`tWebApiCallContext`)

All request state flows through `tWebApiCallContext` passed by reference. It carries path, verb, body, iterator handle, response body, status code, and error flags. Endpoints modify this struct in-place rather than returning values.

## Adding an Endpoint (Pattern)

```dataflex
// In a .pkg file under AppSrc/
Use WebApi\cRestDataset.pkg
Use cMyDataDictionary.dd
Use WebApi\cRestField.pkg

Object oMyEndpoint is a cRestDataset
    Set psPath to "MyResources"
    
    Object oMyDD is a cMyDataDictionary
    End_Object
    Set Main_DD to oMyDD
    Set Server to oMyDD

    Object oField1 is a cRestField
        Entry_Item MyTable.FieldName
    End_Object
End_Object
```

Then `Use` that file inside a `cWebApiRouter` or `cWebApi` block.

## Adding Authentication

Drop an auth modifier object inside a `cWebApiRouter`. It intercepts all requests within that router's subtree:

```dataflex
Object oSecureRouter is a cWebApiRouter
    Set psPath to "v1"
    
    Object oAuth is a cBasicAuth
    End_Object
    
    Use MyEndpoint.pkg
End_Object
```

Available auth classes: `cBasicAuth`, `cJWTAuthentication`, `cApiKeyAuthentication`.

## Swagger / OpenAPI

`cOpenApiSpecification` auto-generates the spec from all registered endpoints. No manual spec writing needed. The spec is served at `/Api/openapi.json` (default). Add `cSwaggerUI` as a web control in your application to render the interactive UI.

## Branching

- `production/stable` — main/release branch
- `production/beta` — pre-release
- Feature branches: `feature/`, `improvement/`, `bugfix/` prefixes
- Commits: short descriptive messages; no enforced convention in this repo
