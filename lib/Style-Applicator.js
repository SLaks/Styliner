/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";

// This file contains code that applies parsed style rules
// to a parsed HTML document. This code runs after the CSS
// and HTML have been processed and transformed.

function appendStyleSource(doc, styleSource, options) {
	/// <summary>Appends an array of non-static CSS elements (strings and rules) to a document.</summary>

	styleSource = styleSource.map(function (o) { return o.toString(options.compact); })
							 .join("");
	if (options.compact)
		styleSource = "<style>" + styleSource + "</style>";
	else
		styleSource = "<style>\n" + styleSource + "\n</style>";

	var head = doc('head');
	if (head.length)
		head.append(styleSource);
	else {
		var body = doc('body');
		if (body.length)
			body.before(styleSource);
		else
			doc.root().prepend(styleSource);
	}
}
function applyStyles(doc, rules, options) {
	/// <summary>Applies a collection of parsed CSS rules and sources to an HTML document.</summary>
	if (!rules.length)
		return;

	//TODO: Apply non-dynamic rules as per specificity
	//TODO: Add importance to dynamic rules

	var styleSource = [];
	//TODO: Populate from strings & non-static rules
	//TODO: Add newlines after rules if !options.compact
	styleSource = rules;
	appendStyleSource(doc, styleSource, options);
}


module.exports = applyStyles;