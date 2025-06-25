df.SwaggerUI = class SwaggerUI extends df.WebBaseControl {
    constructor(sName, oParent) {
        super(sName, oParent)

        //OpenApi url
        this.prop(df.tString, "psOpenApiUrl", "");

        this._eSwaggerDiv = null;
        this.OpenApiSpecification = null;
        //determine the base path. This is the origin (http://localhost for example) + the path name minus the index.html. 
        this.basePath = window.location.origin + window.location.pathname.split(/\/[Ii]ndex\.html/)[0];
    }

    openHtml(aHtml) {
        super.openHtml(aHtml);

        aHtml.push('<div id="swagger-ui"></div>');
    }

    afterRender() {
        super.afterRender();

        //Query the div
        this._eSwaggerDiv = df.dom.query(this._eElem, "div#swagger-ui");

        this.InitSwagger();
    }

    async InitSwagger() {
        if (!this._eSwaggerDiv) {
            return;
        }

        await fetch(this.basePath + this.psOpenApiUrl)
        .then(response => response.json())
        .then(data => this.OpenApiSpecification = JSON.parse(data.OpenApiSpecification));

        const ui = SwaggerUIBundle({
            spec: this.OpenApiSpecification,
            dom_id: '#swagger-ui',
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
            ]
        });


    }
}