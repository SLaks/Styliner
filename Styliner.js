/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var qfs = require('q-fs');

var cssParser = require('parserlib').css;
var cheerio = require('cheerio');

var less = require('less');
var parseLess = Q.nbind(less.render, less);

/**
 * Parses a CSS file into the object model needed to apply to an HTML document.
 * @param {String}	source	The CSS source.
 *
 * @class ParsedStyleSheet
 * @constructor
 */
function ParsedStyleSheet(source) {
	this.complexSource = source;
	this.rules = [];
	//TODO: Parse CSS.
}

/**
 * Creates a Styliner instances that reads CSS & LESS files from the specified base directory.
 * @param {String}	baseDir	The base directory that CSS paths are relative to.
 *
 * @class Styliner
 * @constructor
 */
function Styliner(baseDir) {
	this.baseDir = baseDir;
	this.cachedFiles = {};
}

/**
 * Removes all parsed CSS from the cache.
 * Call this method if the CSS files change.
 */
Styliner.prototype.clearCache = function () {
	this.cachedFiles = {};
};

/**
 * Asynchronously retrieves a parsed stylesheet
 * @param {String} path The relative path to the stylesheet to parse.
 * @returns {Promise<ParsedStylesheet>}
 */
Styliner.prototype.getStylesheet = function (path) {
	if (this.cachedFiles.hasOwnProperty(path))
		return this.cachedFiles[path];

	var promise = qfs.read(qfs.join(this.baseDir, path));

	if (qfs.extension(path).toUpperCase() === '.LESS') {
		promise = promise.then(parseLess);
	}

	promise = promise.then(function (source) { return new ParsedStyleSheet(source); });

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
 * Asynchronously parses an HTML document and inlines styles as appropriate.
 * 
 * @param {String}			source				The HTML soruce code to parse.
 * @param {Array<String>}	[stylesheetPaths]	An optional list of relative paths to stylesheets to include with the document.
 *
 * @returns {Promise<String>} A promise for the inlined HTML source.
 */
Styliner.prototype.processHTML = function (source, stylesheetPaths) {
	var doc = cheerio.load(source);

	stylesheetPaths = stylesheetPaths || [];
	doc('link[rel^="stylesheet"]').each(function (index, elem) {
		stylesheetPaths.push(cheerio(elem).attr('href'));
	}).remove();

	var self = this;
	return Q.all(stylesheetPaths.map(this.getStylesheet.bind(this)))
		.then(function (sheets) {
			appendStyleSource(doc, sheets);

			var allRules = Array.prototype.concat.apply([], sheets.map(function (s) { return s.rules; }));
			applyRules(doc, allRules);
			return doc.html();
		});
};

module.exports = Styliner;