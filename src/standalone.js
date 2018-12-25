import { Readable } from "stream";
import SVGIcons2SVGFontStream from "svgicons2svgfont";
import cosmiconfig from "cosmiconfig";
import createThrottle from "async-throttle";
import defaultMetadataProvider from "svgicons2svgfont/src/metadata";
import fs from "fs";
import merge from "lodash.merge";
import nunjucks from "nunjucks";
import os from "os";
import path from "path";
import svg2ttf from "svg2ttf";
import ttf2eot from "ttf2eot";
import ttf2woff from "ttf2woff";
import ttf2woff2 from "ttf2woff2";
import xml2js from "xml2js";

function getGlyphsData(items, options) {
  const metadataProvider =
    options.metadataProvider ||
    (glyphData => {
      if (glyphData.srcPath) {
        return defaultMetadataProvider({
          prependUnicode: options.prependUnicode,
          startUnicode: options.startUnicode
        });
      }

      return (glyph, cb) => {
        const metadata = {
          name: glyph.name || glyph.index.toString(),
          unicode: [String.fromCodePoint(options.startUnicode++)]
        };

        cb(null, metadata);
      };
    });


  const xmlParser = new xml2js.Parser();
  const throttle = createThrottle(options.maxConcurrency);

  return Promise.all(
    items.map((item, idx) =>
      throttle(
        () =>
          new Promise((resolve, reject) => {
            if (item.srcPath) {
              // load from file
              const file = item.srcPath;
              const glyph = fs.createReadStream(file);
              let glyphContents = "";

              if (file.length === 0) {
                return reject(new Error(`Empty file ${file}`));
              }

              return glyph
                .on("error", glyphError => reject(glyphError))
                .on("data", data => {
                  glyphContents += data.toString();
                })
                .on("end", () => {
                  // Maybe bug in xml2js
                  if (glyphContents.length === 0) {
                    return reject(new Error(`Empty file ${file}`));
                  }

                  const glyphData = {
                    contents: glyphContents,
                    index: idx,
                    srcPath: file
                  };

                  return resolve(glyphData);
                });
            }

            const glyphContents = item.svg;

            if (glyphContents.length === 0) {
              return reject(new Error(`Empty svg at index ${idx}`));
            }

            return resolve({
              contents: glyphContents,
              index: idx,
              name: item.name
            });

          }).then(glyphData =>
            new Promise((resolve, reject) =>
              xmlParser.parseString(glyphData.contents, error => {
                if (error) {
                  return reject(error);
                }

                return resolve(glyphData);
              })))
      )
    )
  ).then(glyphsData => {
    const sortedGlyphsData = glyphsData;

    return Promise.all(
      sortedGlyphsData.map(
        glyphData =>
          new Promise((resolve, reject) => {
            metadataProvider(glyphData)(glyphData, (error, metadata) => {
              if (error) {
                return reject(error);
              }

              glyphData.metadata = metadata;

              return resolve(glyphData);
            });
            resolve(glyphData);
          })
      )
    );
  });
}

function svgIcons2svgFont(glyphsData, options) {
  let result = "";

  return new Promise((resolve, reject) => {
    const fontStream = new SVGIcons2SVGFontStream({
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
      log: options.verbose ? console.log.bind(console) : () => {
      },
      metadata: options.metadata,
      normalize: options.normalize,
      round: options.round
    })
      .on("finish", () => resolve(result))
      .on("data", data => {
        result += data;
      })
      .on("error", error => reject(error));

    glyphsData.forEach(glyphData => {
      const glyphStream = new Readable();

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
    configPath = path.resolve(process.cwd(), options.configFile);
  }

  const configExplorer = cosmiconfig("webfont");
  const searchForConfig = configPath
    ? configExplorer.load(configPath)
    : configExplorer.search(searchPath);

  return searchForConfig.then(result => {
    if (!result) {
      return {};
    }

    return result;
  });
}

export default function(initialOptions) {
  if (!initialOptions || (!initialOptions.files && !initialOptions.svgs)) {
    throw new Error("You must pass webfont a `files` glob or `svgs`");
  }

  let options = Object.assign(
    {},
    {
      ascent: undefined, // eslint-disable-line no-undefined
      centerHorizontally: false,
      descent: 0,
      files: [],
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
      maxConcurrency: os.cpus().length,
      metadata: null,
      metadataProvider: null,
      normalize: false,
      prependUnicode: false,
      round: 10e12,
      sort: true,
      startUnicode: 0xea01,
      svgs: [],
      template: null,
      templateClassName: null,
      templateFontName: null,
      templateFontPath: "./",
      verbose: false
    },
    initialOptions
  );

  let glyphsData = [];

  return buildConfig({
    configFile: options.configFile
  }).then(loadedConfig => {
    if (Object.keys(loadedConfig).length > 0) {
      options = merge({}, options, loadedConfig.config);
      options.filePath = loadedConfig.filepath;
    }

    let items = options.files.map(file => ({ srcPath: file }));

    items = items.concat(options.svgs);

    return (
      Promise.resolve()
        .then(() => getGlyphsData(items, options))
        .then(generatedDataInternal => {
          glyphsData = generatedDataInternal;

          return svgIcons2svgFont(generatedDataInternal, options);
        })
        // Maybe add ttfautohint
        .then(svgFont => {
          const result = {};

          result.svg = svgFont;
          result.glyphsData = glyphsData;

          result.ttf = Buffer.from(
            svg2ttf(
              result.svg.toString(),
              options.formatsOptions && options.formatsOptions.ttf
                ? options.formatsOptions.ttf
                : {}
            ).buffer
          );

          if (options.formats.indexOf("eot") !== -1) {
            result.eot = Buffer.from(ttf2eot(result.ttf).buffer);
          }

          if (options.formats.indexOf("woff") !== -1) {
            result.woff = Buffer.from(
              ttf2woff(result.ttf, {
                metadata: options.metadata
              }).buffer
            );
          }

          if (options.formats.indexOf("woff2") !== -1) {
            result.woff2 = ttf2woff2(result.ttf);
          }

          return result;
        })
        .then(result => {
          if (!options.template) {
            return result;
          }

          const buildInTemplateDirectory = path.join(__dirname, "../templates");
          const buildInTemplates = {
            css: {
              path: path.join(buildInTemplateDirectory, "template.css.njk")
            },
            html: {
              path: path.join(
                buildInTemplateDirectory,
                "template.preview-html.njk"
              )
            },
            scss: {
              path: path.join(buildInTemplateDirectory, "template.scss.njk")
            }
          };

          let templateFilePath = null;

          if (Object.keys(buildInTemplates).includes(options.template)) {
            result.usedBuildInTemplate = true;

            nunjucks.configure(path.join(__dirname, "../"));

            templateFilePath = `${buildInTemplateDirectory}/template.${
              options.template
              }.njk`;
          } else {
            const resolvedTemplateFilePath = path.resolve(options.template);

            nunjucks.configure(path.dirname(resolvedTemplateFilePath));

            templateFilePath = path.resolve(resolvedTemplateFilePath);
          }

          const nunjucksOptions = merge(
            {},
            {
              glyphs: glyphsData.map(glyphData => {
                if (typeof options.glyphTransformFn === "function") {
                  glyphData.metadata = options.glyphTransformFn(
                    glyphData.metadata
                  );
                }

                return glyphData.metadata;
              })
            },
            options,
            {
              className: options.templateClassName
                ? options.templateClassName
                : options.fontName,
              fontName: options.templateFontName
                ? options.templateFontName
                : options.fontName,
              fontPath: options.templateFontPath.replace(/\/?$/, "/")
            }
          );

          result.template = nunjucks.render(templateFilePath, nunjucksOptions);

          return result;
        })
        .then(result => {
          if (options.formats.indexOf("svg") === -1) {
            delete result.svg;
          }

          if (options.formats.indexOf("ttf") === -1) {
            delete result.ttf;
          }

          result.config = options;

          return result;
        })
    );
  });
}
