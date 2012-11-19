/// <reference path="ParsedStyleSheet.js" />

// This file contains code that modifies parsed HTML
// and CSS source before applying the styles.

var Q = require('q');
var path = require('path');


function processCachedStyleSheet(pss) {
	/// <summary>Pre-processes a shared ParsedStyleSheet object immediately after it is parsed.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to modify</param>
	// This function should perform global modifications that do not depend on the HTML document.

	return pss;
}

function processDocumentStyleSheet(pss, doc, docPath, options) {
	/// <summary>Pre-processes and transforms a shared ParseStyleSheet object into an array of rules and elements customized for this document.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to copy</param>

	return pss.elements;
}

function processDocument(doc, docPath, options) {
	/// <summary>Pre-processes a parsed HTML document.</summary>
}

module.exports = {
	cachedStyleSheet: processCachedStyleSheet,
	documentStyleSheet: processDocumentStyleSheet,
	htmlDocument: processDocument
};