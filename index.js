/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var qfs = require('q-fs');

var cssParser = require('parserlib').css;

/**
 * Parses a CSS file into the object model needed to apply to an HTML document.
 * @param {String}	source	The CSS source.
 *
 * @class ParsedStyleSheet
 * @constructor
 */
function ParsedStyleSheet(source) {

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
Styliner.getStylesheet = function (path) {
	if (this.cachedFiles.hasOwnProperty(path))
		return this.cachedFiles[path];
	return this.cachedFiles[path]
		= qfs.read(qfs.join(this.baseDir, path))
			.then(function (source) { return new ParsedStyleSheet(source); });
};

/**
 * Asynchronously parses an HTML document and inlines styles as appropriate.
 * 
 * @param {String}			source			The HTML soruce code to parse.
 * @param {Array<String>}	[stylesheets]	An optional list of relative paths to stylesheets to include with the document.

 * @returns {Promise<String>} A promise for the inlined HTML source.
 */
Styliner.prototype.processHTML = function (source, stylesheets) {

};

module.exports = Styliner;