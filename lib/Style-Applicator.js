/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var winston = require('winston');
var _ = require('lodash');
var cssParser = require('parserlib').css;
var cheerio = require('cheerio');

var ParsedStyleSheet = require('./ParsedStyleSheet');

// This file contains code that applies parsed style rules
// to a parsed HTML document. This code runs after the CSS
// and HTML have been processed and transformed.

function appendStyleSource(doc, styleSource, options) {
	/// <summary>Appends an array of non-static CSS elements (strings and rules) to a document.</summary>

	styleSource = styleSource
		.map(function (o) {
			// If we aren't compacting source, add a newline after each rule.
			return o.toString(options.compact)
				+ (!options.compact && o instanceof ParsedStyleSheet.Rule ? '\n' : '');
		})
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

/**
 * Parses any CSS properties in the style="" attribute of an HTML element.
 * @returns {Array * ParsedStyleSheet.Property}
 */
function parseStyle(elem) {
	if (!elem.attribs || !elem.attribs.style)
		return [];

	var properties = [];

	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true, ieFilters: true });

	parser.addListener('property', function (e) {
		var prop = new ParsedStyleSheet.Property(e);
		if (e.invalid) {
			winston.error("Property " + prop.toString().replace(/\t/g, ' ') + " in element " + cheerio(elem).html() + " is invalid: " + e.invalid.message);
			// Proceed anyway
		}

		properties.push(prop);
	});

	parser.parseStyleAttribute(elem.attribs.style);

	return properties;
}

/**
 * Applies a set of CSS rules and strings to a single element.
 */
function applyTo(elem, rules, options) {
	//TODO
}

/**
 * Applies a set of CSS rules and strings to an element
 * and to all of its descendant elements.
 */
function applyRecursive(elem, rules, options) {
	if (elem.cheerio) {
		// If we were passed a wrapped Cheerio object,
		// recurse into each elements inside of it.
		elem = { children: elem };
	} else
		applyTo(cheerio(elem), rules, options);

	for (var i = 0; i < elem.children.length; i++) {
		var child = elem.children[i];
		if (child.type === 'tag')
			applyRecursive(child, rules, options);
	}
}

function applyStyles(doc, rules, options) {
	/// <summary>Applies a collection of parsed CSS rules and sources to an HTML document.</summary>
	if (!rules.length)
		return;

	//TODO: Apply non-dynamic rules as per specificity
	//TODO: Add importance to dynamic rules

	var styleSource;

	if (options.keepRules) {
		styleSource = rules;
	} else {
		styleSource = rules.slice();

		var body = doc('body');

		if (!body) {
			// If we don't have a <body>, apply CSS
			// to the entire document.
			applyRecursive(doc.root(), rules, options);
		} else {

			// Apply any styles for the <html> tag
			applyTo(doc.root()[0], rules, options);
			// Do not touch the <head> tag at all.

			// Apply CSS to the entire <body> tree
			applyRecursive(body, rules, options);
		}
	}
	appendStyleSource(doc, styleSource, options);
}


module.exports = applyStyles;