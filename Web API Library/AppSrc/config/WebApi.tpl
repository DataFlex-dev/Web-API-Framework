Use WebApi\cWebApi.pkg
Use WebApi\cJSONIterator.pkg

Object oWebApi is a cWebApi
    Set psPath to "Api"

    Send AddIterator (RefClass(cJSONIterator)) "application/json"

    // Add your datasets and routers here

End_Object
