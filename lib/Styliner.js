"use strict";
var Q = require('q');
var Qx = require('qx');
var qfs = require('q-io/fs');
var qhttp = require('q-io/http');
var url = require('url');

var cheerio = require('cheerio');

var util = require('./Util');
var ParsedStyleSheet = require('./ParsedStyleSheet');
var applyStyles = require('./Style-Applicator');
var preprocessor = require('./Preprocessor');


/**
 * Creates a Styliner instances that reads CSS & LESS files from the specified base directory.
 * @param {String}	baseDir		The base directory that CSS paths are relative to.
 * @param {Object}	[options]	An optional hash of options to configure this object.
 * The following options are supported (all options default to false):
 *  compact: true		Minify all output
 *	noCSS: true			Don't emit <style> tags for rules that cannot be inlined
 *	keepRules: true		Keep all rules in <style> tags instead of inlining static rules into elements.
 *	keepInvalid: true	Don't skip properties that parserlib reports as invalid.
 *	fixYahooMQ: true	Add an attribute/ID selector to all rules in media queries to fix a bug in Yahoo Mail.
 *	urlPrefix: "dir/"	The path containing referenced URLs.  All non-absolute URLs in <a> tags, <img> tags, and stylesheets will have this path prepended.  For greater flexibility, pass a url() function instead.
 *	url: function(path, type)
			A function called to resolve URLs.  All non-absolute URLs in HTML or CSS will be replaced by the return value of this function.  
			The function is passed the relative path to the file and the source of the URL ("img" or "a" or other HTML tags; URLs from CSS pass "img")
			It can return a promise or a string
 *
 * @class Styliner
 * @constructor
 */
function Styliner(baseDir, options) {
	this.baseDir = baseDir;
	this.cachedFiles = {};
	this.options = options = options || {};

	options.url = options.url
		|| (options.urlPrefix && function (path) { return url.resolve(options.urlPrefix, path); })
		|| util.noopUrlTransform;
}

/**
 * Removes all parsed CSS from the cache.
 * Call this method if the CSS files change.
 */
Styliner.prototype.clearCache = function () {
	this.cachedFiles = {};
};

/**
 * Contains parser functions to transform stylesheet formats into CSS source.
 * To support formats like LESS or SASS, add a function that takes the source
 * code, and returns a promise of the generated CSS source.
 * The name of the function must match the file extension.
 */
Styliner.styleFormats = {
	css: function (source) { return source; }
};
function getExtension(path) {
	var match = /\.([^.]+)$/.exec(path);
	if (match)
		return match[1].toLowerCase();
	else
		return "";
}

/**
 * Asynchronously retrieves a parsed stylesheet
 * @param {String} path The relative path to the stylesheet to parse.
 * @returns {Promise<ParsedStylesheet>}
 */
Styliner.prototype.getStylesheet = function (path) {
	if (this.cachedFiles.hasOwnProperty(path))
		return this.cachedFiles[path];

	var format = getExtension(path);
	if (!Styliner.styleFormats.hasOwnProperty(format))
		throw new Error("'" + path + "' is of unsupported format " + format);

	var self = this;
	var fullPath = qfs.join(this.baseDir, path);
	var promise = qfs.read(fullPath)
		.then(function (stream) {
			return Styliner.styleFormats[format](
				stream.toString(),
				fullPath, self.options
			);
		})
		.then(function (source) {
			var pss = new ParsedStyleSheet(source, fullPath, self.options);
			return preprocessor.cachedStyleSheet(pss, self.options);
		});

	this.cachedFiles[path] = promise;
	return promise;
};

/**
 * Asynchronously parses all CSS and LESS source files in the base directory.
 * Call this method to pre-populate the cache for maximum performance.
 * @returns {Promise}
 */
Styliner.prototype.cacheAll = function () {
	var self = this;

	return qfs.listTree(this.baseDir, function (path) { return Styliner.styleFormats.hasOwnProperty(getExtension(path)); })
		.then(Qx.map(function (p) {
			return qfs.canonical(qfs.join(self.baseDir, p))
					  .then(self.getStylesheet.bind(self));
		}));
};

function parseDataUri(uri) {
	var parsed = /data:([a-zA-Z]+\/[a-zA-Z-]+)(;base64)?,(.*)/.exec(uri);
	if (!parsed)
		return null;

	if (parsed[2])
		return new Buffer(parsed[3], 'base64').toString('utf-8');
	else
		return decodeURIComponent(parsed[3]);
}


/**
 * Asynchronously parses an HTML document and inlines styles as appropriate.
 * 
 * @param {String}			source				The HTML source code to parse.
 * @param {String}			[relativePath]		The path to the directory containing the source file.  Relative paths to CSS files and images will be resolved from this path.  Defaults to (and relative to) the base directory. 
 * @param {Array<String>}	[stylesheetPaths]	An optional list of relative paths to stylesheets to include with the document.
 *
 * @returns {Promise<String>} A promise for the inlined HTML source.
 */
Styliner.prototype.processHTML = function (source, relativePath, stylesheetPaths) {
	if (relativePath instanceof Array) {
		stylesheetPaths = relativePath;
		relativePath = ".";
	} else if (arguments.length === 1) {
		relativePath = ".";
	}

	stylesheetPaths = stylesheetPaths || [];

	var context = {
		$: cheerio.load(source, { ignoreWhitespace: this.options.compact }),
		options: this.options,
		folder: qfs.join(this.baseDir, relativePath)
	};
	context.root = context.$.root();

	var stylesheets = context.$('link[rel~="stylesheet"], style')
		.remove()
		.map(function (index, elem) {
			if (elem.name === "style") {
				return {
					type: 'source',
					text: cheerio(this).text()
				};
			}

			var href = cheerio(elem).attr('href');
			if (util.hasScheme(href)) {
				return {
					type: "absolute",
					url: href
				};
			} else {
				// If it doesn't have a protocol, assume it's a relative path.
				// Normalize the path to match stylesheetPaths.
				return {
					type: "relative",
					path: qfs.join(relativePath, href)
				};
			}
		}).concat(
			stylesheetPaths.map(function (p) {
				return { type: "relative", path: p };
			})
		);

	var self = this;

	var htmlPath = qfs.join(context.folder, '-html-');

	var stylesheetsLoaded = Q.all(
		stylesheets.map(function (ss) {
			// First, take all stylesheets that give us new source
			// (as opposed to cacheable local paths) and turn them
			// into promises.
			if (ss.type === "absolute") {
				if (/^data:/.test(ss.url))
					ss = { type: "source", text: qfs.resolve(parseDataUri(ss.url)) };
				else if (/^file:/.test(ss.url)) {
					ss = { type: "source", text: qfs.read(url.parse(ss.url).pathname.replace(/^\/+/,'')) };
				} else {
					ss = { type: "source", text: qhttp.read(ss.url) };
				}
			}

			if (ss.type === "source") {
				// source-type stylesheets can be promises (external URLs)
				// or raw strings (<style> tags or data: URLs)
				return Q.when(ss.text, function (source) {
					var pss = new ParsedStyleSheet(source, htmlPath, context.options);
					return preprocessor.cachedStyleSheet(pss, context.options);
				});
			} else if (ss.type === "relative") {
				var path = qfs.join(self.baseDir, ss.path);

				return qfs.canonical(path)
						  .then(self.getStylesheet.bind(self));
			} else {
				throw new Error("Unrecognized stylesheet " + JSON.stringify(ss));
			}
		}).map(function (p) {
			return p.then(function (pss) {
				return preprocessor.documentStyleSheet(pss, context);
			});
		})
	);

	return Q.spread(
		[
			stylesheetsLoaded,
			preprocessor.htmlDocument(context)
		],
		function (elements) {
			/// <param name="elements" type="Array">An array of pre-processed arrays of stylesheet elements.  (One array for each stylesheet)</param>
			context.rules = Array.prototype.concat.apply([], elements);
			return applyStyles(context);
		}
	).then(function () { return context.root.html(); });
};


module.exports = Styliner;