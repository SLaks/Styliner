/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var qfs = require('q-fs');

var cheerio = require('cheerio');
var ParsedStyleSheet = require('./ParsedStyleSheet');


/**
 * Creates a Styliner instances that reads CSS & LESS files from the specified base directory.
 * @param {String}	baseDir		The base directory that CSS paths are relative to.
 * @param {Object}	[options]	An optional hash of options to configure this object.
 * The following options are supported (all options default to false):
 *  compact: true		Minify all output
 *	noCSS: true			Don't emit <style> tags for rules that cannot be inlined
 *	fixYahooMQ: true	Add an attribute/ID selector to all rules in media queries to fix a bug in Yahoo Mail.
 *
 * @class Styliner
 * @constructor
 */
function Styliner(baseDir, options) {
	this.baseDir = baseDir;
	this.cachedFiles = {};
	this.options = options || {};
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
		.then(function (source) { return new ParsedStyleSheet(source, fullPath); });

	this.cachedFiles[path] = promise;
	return promise;
};


function appendStyleSource(doc, sheets) {
	/// <summary>Inserts non-trivial CSS source (eg, media queries) from a collection of parsed stylesheets into a style tag.</summary>
	var styleSource = sheets.map(function (s) { return s.complexSource; })
							.join('');
	if (styleSource) {
		var head = doc('head');
		if (!head)
			head = doc.root().append('<head />');
		head.append('<style>\n\t\t' + styleSource + '</style>');
	}
}

function applyRules(doc, rules) {
	/// <summary>Applies a collection of parsed CSS rules to an HTML document.</summary>
	if (!rules.length)
		return;
	//TODO: Apply rules as per specificity
}

/**
 * Asynchronously parses all CSS and LESS source files in the base directory.
 * Call this method to pre-populate the cache for maximum performance.
 * @returns {Promise}
 */
Styliner.prototype.cacheAll = function () {
	var self = this;

	return qfs.listTree(this.baseDir, function (path, stat) { return Styliner.styleFormats.hasOwnProperty(getExtension(path)); })
		.then(function (paths) {
			return Q.all(paths.map(function (p) {
				return qfs.canonical(qfs.join(self.baseDir, p))
						  .then(self.getStylesheet.bind(self));
			}));
		});
};

/**
 * Asynchronously parses an HTML document and inlines styles as appropriate.
 * 
 * @param {String}			source				The HTML source code to parse.
 * @param {String}			[relativePath]		The path to the directory containing the source file.  Relative paths to CSS files will be resolved from this path.  Defaults to (and relative to) the base directory. 
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

	var doc = cheerio.load(source);
	//TODO: Handle fixYahooMQ: true by adding an ID to the <html> element

	var stylesheetHrefs = doc('link[rel^="stylesheet"]')
		.remove()
		.map(function (index, elem) {
			var href = cheerio(elem).attr('href');
			return qfs.join(relativePath, href);
		});

	var self = this;
	var stylesheetsLoaded = Q.all(
		stylesheetHrefs.concat(stylesheetPaths)
			.map(function (path) {
				path = qfs.join(self.baseDir, path);

				return qfs.canonical(path)
						  .then(self.getStylesheet.bind(self));
			})
	);
	return stylesheetsLoaded.then(function (sheets) {
		appendStyleSource(doc, sheets);

		var allRules = Array.prototype.concat.apply([], sheets.map(function (s) { return s.rules; }));
		applyRules(doc, allRules);
		return doc.html();
	});
};

module.exports = Styliner;