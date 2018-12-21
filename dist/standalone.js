"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = _default;

var _stream = require("stream");

var _svgicons2svgfont = _interopRequireDefault(require("svgicons2svgfont"));

var _cosmiconfig = _interopRequireDefault(require("cosmiconfig"));

var _asyncThrottle = _interopRequireDefault(require("async-throttle"));

var _metadata = _interopRequireDefault(require("svgicons2svgfont/src/metadata"));

var _filesorter = _interopRequireDefault(require("svgicons2svgfont/src/filesorter"));

var _fs = _interopRequireDefault(require("fs"));

var _globby = _interopRequireDefault(require("globby"));

var _lodash = _interopRequireDefault(require("lodash.merge"));

var _nunjucks = _interopRequireDefault(require("nunjucks"));

var _os = _interopRequireDefault(require("os"));

var _path = _interopRequireDefault(require("path"));

var _svg2ttf = _interopRequireDefault(require("svg2ttf"));

var _ttf2eot = _interopRequireDefault(require("ttf2eot"));

var _ttf2woff = _interopRequireDefault(require("ttf2woff"));

var _ttf2woff2 = _interopRequireDefault(require("ttf2woff2"));

var _xml2js = _interopRequireDefault(require("xml2js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function getGlyphsData(files, options) {
  const metadataProvider = options.metadataProvider || (0, _metadata.default)({
    prependUnicode: options.prependUnicode,
    startUnicode: options.startUnicode
  });
  const xmlParser = new _xml2js.default.Parser();
  const throttle = (0, _asyncThrottle.default)(options.maxConcurrency);
  return Promise.all(files.map((file, idx) => throttle(() => new Promise((resolve, reject) => {
    // const glyph = fs.createReadStream(file);
    const glyphContents = file;

    if (file.length === 0) {
      return reject(new Error(`Empty file ${file}`));
    }

    return xmlParser.parseString(glyphContents, error => {
      if (error) {
        return reject(error);
      }

      const glyphData = {
        contents: file,
        name: idx.toString()
      };
      return resolve(glyphData);
    }); // return glyph
    //   .on("error", glyphError => reject(glyphError))
    //   .on("data", data => {
    //     glyphContents += data.toString();
    //   })
    //   .on("end", () => {
    //     // Maybe bug in xml2js
    //     if (glyphContents.length === 0) {
    //       return reject(new Error(`Empty file ${file}`));
    //     }
    //
    //     return xmlParser.parseString(glyphContents, error => {
    //       if (error) {
    //         return reject(error);
    //       }
    //
    //       const glyphData = {
    //         contents: glyphContents,
    //         srcPath: file
    //       };
    //
    //       return resolve(glyphData);
    //     });
    //   });
  })))).then(glyphsData => {
    const sortedGlyphsData = glyphsData;

    function metadataProvider2(glyph) {
      return {
        name: glyph.name,
        unicode: [String.fromCodePoint(options.startUnicode++)]
      };
    }

    return Promise.all(sortedGlyphsData.map(glyphData => new Promise((resolve, reject) => {
      // metadataProvider(glyphData.srcPath, (error, metadata) => {
      //   if (error) {
      //     return reject(error);
      //   }
      //
      //   glyphData.metadata = metadata;
      //
      //   return resolve(glyphData);
      // });
      glyphData.metadata = metadataProvider2(glyphData);
      resolve(glyphData);
    })));
  });
}

function svgIcons2svgFont(glyphsData, options) {
  let result = "";
  return new Promise((resolve, reject) => {
    const fontStream = new _svgicons2svgfont.default({
      ascent: options.ascent,
      centerHorizontally: options.centerHorizontally,
      descent: options.descent,
      fixedWidth: options.fixedWidth,
      fontHeight: options.fontHeight,
      fontId: options.fontId,
      fontName: options.fontName,
      fontStyle: options.fontStyle,
      fontWeight: options.fontWeight,
      // eslint-disable-next-line no-empty-function
      log: options.verbose ? console.log.bind(console) : () => {},
      metadata: options.metadata,
      normalize: options.normalize,
      round: options.round
    }).on("finish", () => resolve(result)).on("data", data => {
      result += data;
    }).on("error", error => reject(error));
    glyphsData.forEach(glyphData => {
      const glyphStream = new _stream.Readable();
      glyphStream.push(glyphData.contents);
      glyphStream.push(null);
      glyphStream.metadata = glyphData.metadata;
      fontStream.write(glyphStream);
    });
    fontStream.end();
  });
}

function buildConfig(options) {
  let searchPath = process.cwd();
  let configPath = null;

  if (options.configFile) {
    searchPath = null;
    configPath = _path.default.resolve(process.cwd(), options.configFile);
  }

  const configExplorer = (0, _cosmiconfig.default)("webfont");
  const searchForConfig = configPath ? configExplorer.load(configPath) : configExplorer.search(searchPath);
  return searchForConfig.then(result => {
    if (!result) {
      return {};
    }

    return result;
  });
}

function _default(initialOptions) {
  if (!initialOptions || !initialOptions.files) {
    throw new Error("You must pass webfont a `files` glob");
  }

  let options = Object.assign({}, {
    ascent: undefined,
    // eslint-disable-line no-undefined
    centerHorizontally: false,
    descent: 0,
    fixedWidth: false,
    fontHeight: null,
    fontId: null,
    fontName: "webfont",
    fontStyle: "",
    fontWeight: "",
    formats: ["svg", "ttf", "eot", "woff", "woff2"],
    formatsOptions: {
      ttf: {
        copyright: null,
        ts: null,
        version: null
      }
    },
    glyphTransformFn: null,
    // Maybe allow setup from CLI
    maxConcurrency: _os.default.cpus().length,
    metadata: null,
    metadataProvider: null,
    normalize: false,
    prependUnicode: false,
    round: 10e12,
    sort: true,
    startUnicode: 0xea01,
    template: null,
    templateClassName: null,
    templateFontName: null,
    templateFontPath: "./",
    verbose: false
  }, initialOptions);
  let glyphsData = [];
  return buildConfig({
    configFile: options.configFile
  }).then(loadedConfig => {
    if (Object.keys(loadedConfig).length > 0) {
      options = (0, _lodash.default)({}, options, loadedConfig.config);
      options.filePath = loadedConfig.filepath;
    }

    return Promise.resolve().then(() => getGlyphsData(options.files, options)).then(generatedDataInternal => {
      glyphsData = generatedDataInternal;
      return svgIcons2svgFont(generatedDataInternal, options);
    }) // Maybe add ttfautohint
    .then(svgFont => {
      const result = {};
      result.svg = svgFont;
      result.glyphsData = glyphsData;
      result.ttf = Buffer.from((0, _svg2ttf.default)(result.svg.toString(), options.formatsOptions && options.formatsOptions.ttf ? options.formatsOptions.ttf : {}).buffer);

      if (options.formats.indexOf("eot") !== -1) {
        result.eot = Buffer.from((0, _ttf2eot.default)(result.ttf).buffer);
      }

      if (options.formats.indexOf("woff") !== -1) {
        result.woff = Buffer.from((0, _ttf2woff.default)(result.ttf, {
          metadata: options.metadata
        }).buffer);
      }

      if (options.formats.indexOf("woff2") !== -1) {
        result.woff2 = (0, _ttf2woff2.default)(result.ttf);
      }

      return result;
    }).then(result => {
      if (!options.template) {
        return result;
      }

      const buildInTemplateDirectory = _path.default.join(__dirname, "../templates");

      const buildInTemplates = {
        css: {
          path: _path.default.join(buildInTemplateDirectory, "template.css.njk")
        },
        html: {
          path: _path.default.join(buildInTemplateDirectory, "template.preview-html.njk")
        },
        scss: {
          path: _path.default.join(buildInTemplateDirectory, "template.scss.njk")
        }
      };
      let templateFilePath = null;

      if (Object.keys(buildInTemplates).includes(options.template)) {
        result.usedBuildInTemplate = true;

        _nunjucks.default.configure(_path.default.join(__dirname, "../"));

        templateFilePath = `${buildInTemplateDirectory}/template.${options.template}.njk`;
      } else {
        const resolvedTemplateFilePath = _path.default.resolve(options.template);

        _nunjucks.default.configure(_path.default.dirname(resolvedTemplateFilePath));

        templateFilePath = _path.default.resolve(resolvedTemplateFilePath);
      }

      const nunjucksOptions = (0, _lodash.default)({}, {
        glyphs: glyphsData.map(glyphData => {
          if (typeof options.glyphTransformFn === "function") {
            glyphData.metadata = options.glyphTransformFn(glyphData.metadata);
          }

          return glyphData.metadata;
        })
      }, options, {
        className: options.templateClassName ? options.templateClassName : options.fontName,
        fontName: options.templateFontName ? options.templateFontName : options.fontName,
        fontPath: options.templateFontPath.replace(/\/?$/, "/")
      });
      result.template = _nunjucks.default.render(templateFilePath, nunjucksOptions);
      return result;
    }).then(result => {
      if (options.formats.indexOf("svg") === -1) {
        delete result.svg;
      }

      if (options.formats.indexOf("ttf") === -1) {
        delete result.ttf;
      }

      result.config = options;
      return result;
    });
  });
}