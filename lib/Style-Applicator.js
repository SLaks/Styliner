/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var _ = require('lodash');
var winston = require('winston');
var cssParser = require('parserlib').css;
var cheerio = require('cheerio');

var ParsedStyleSheet = require('./ParsedStyleSheet');
var preprocessor = require('./Preprocessor');
var util = require('./Util');

// This file contains code that applies parsed style rules
// to a parsed HTML document. This code runs after the CSS
// and HTML have been processed and transformed.
// All shorthand properties must have been expanded.  This
// happens in Preprocessor.js

// This code MUST NOT modify the original rules or properties

var inlineSpecifity = new cssParser.Specificity(1, 0, 0, 0);

/**
 * Checks whether a new CSS property should override the value from
 * an older occurrence of the same property
 *
 * The arguments are internal objects created in cascadeProperties()
 */
function overrides(oldInfo, newInfo) {
	// specificity.a is 1 for inline and 0 for CSS rule.
	if (oldInfo.specificity.a === newInfo.specificity.a) {
		// Both values are from the same source
		if (!newInfo.important && oldInfo.important)
			return false;
		if (oldInfo.index > newInfo.index || oldInfo.specificity.compare(newInfo.specificity) > 0)
			return false;
	} else if (oldInfo.specificity.a > newInfo.specificity.a) {
		// Old is from style=""; new is from CSS rule
		if (!newInfo.important || oldInfo.important)
			return false;
	} else {
		// Old is from CSS rule; new is from style=""
		if (!oldInfo.important || newInfo.important)
			return false;
	}

	return true;
}

/**
 * Finds the final set of CSS properties that should be applied to 
 * a specific element, going through all defined CSS rules.
 *
 * This function is the core of Styliner
 * @return {Array * Property} 
 */
function cascadeProperties(inlineProperties, elem, rules) {
	// Stores the current value(s) for each property name.
	// If there are multiple values from the same rule, we
	// keep all of them, to allow per-browser values.
	var propertyValues = {};

	var applyProperties = function (props, s, index) {
		_.chain(props).groupBy("name").forOwn(function (props, name) {
			var newInfo = {
				values: props,
				specificity: s,
				index: index,
				important: props.some(function (p) { return p.important; })
			};
			if (propertyValues.hasOwnProperty(name)) {
				// If we already have a value for this property,
				// check whether the new value needs to override
				// it.

				var oldInfo = propertyValues[name];

				if (!overrides(oldInfo, newInfo))
					return;
			}
			propertyValues[name] = newInfo;
		});
	};

	applyProperties(inlineProperties, inlineSpecifity, rules.length + 1);

	var dynamicRules = {};
	rules.forEach(function (rule, index) {
		if (!(rule instanceof ParsedStyleSheet.Rule))
			return;

		if (rule.isDynamic) {
			// If the rule is soft-dynamic, check whether we
			// need to ensure that it doesn't get overridden
			if (rule.staticSelector && rule.matches(elem[0])) {
				rule.properties.forEach(function (p) {
					(dynamicRules[p.name] = dynamicRules[p.name] || []).push({ prop: p, specificity: rule.specificity, index: index });
				});
			}
			return;
		}
		if (!rule.matches(elem[0]))
			return;

		applyProperties(rule.properties, rule.specificity, index);
	});

	// Make sure that all dynamic properties are not
	// getting incorrectly overridden by our inlined
	// properties.
	_.forOwn(propertyValues, function (appliedInfo, name) {
		if (!dynamicRules.hasOwnProperty(name))
			return;

		dynamicRules[name].forEach(function (dynamicInfo) {
			// If this dynamic rule should be overridden
			// by the static rule anyway, do nothing.
			if (dynamicInfo.prop.important || !overrides(appliedInfo, dynamicInfo))
				return;

			var rule = rules[dynamicInfo.index];
			var propIndex = rule.properties.indexOf(dynamicInfo.prop);	//Find the index before cloning the rule

			if (!rule.isClone)
				rule = rules[dynamicInfo.index] = new ParsedStyleSheet.Rule(rule);


			var newProp = new ParsedStyleSheet.Property(dynamicInfo.prop);
			newProp.important = true;
			rule.properties[propIndex] = newProp;
		});
	});
	//TODO: Add !important to inlined styles that just got overridden.

	return _.chain(propertyValues).values().map("values").flatten().value();
	//TODO: Use shorthand where possible.
}

function appendStyleSource(doc, styleSource) {
	/// <summary>Appends an array of non-static CSS elements (strings and rules) to a document.</summary>
	if (!styleSource.length)
		return;

	var compact = doc.options.compact;
	styleSource = styleSource
		.map(function (o) {
			// If we aren't compacting source, add a newline after each rule.
			return o.toString(compact)
				+ (!compact && o instanceof ParsedStyleSheet.Rule ? '\n' : '');
		})
		.join("");
	if (compact)
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

//#region Read style="" 
/**
 * Parses any CSS properties in the style="" attribute of an HTML element.
 * @returns {Array * ParsedStyleSheet.Property}
 */
function parseStyle(elem) {
	var style = elem.attr('style');
	if (!style)
		return [];

	var properties = [];

	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true, ieFilters: true });

	parser.addListener('property', function (e) {
		var prop = new ParsedStyleSheet.Property(e);
		if (e.invalid) {
			winston.error("Property " + prop.toString().replace(/\t/g, ' ') + " in element " + cheerio.html(elem) + " is invalid: " + e.invalid.message);
			// Proceed anyway
		}

		properties.push(prop);
	});

	parser.parseStyleAttribute(style);

	return properties;
}

/**
 * Parses and transforms any CSS properties in the style="" attribute of an HTML element.
 * @returns {Promise * Array * ParsedStyleSheet.Property}
 */
function processStyle(elem, doc) {
	var properties = parseStyle(elem);
	if (!properties.length)
		return Q.resolve([]);
	return util.modifyArray(
		properties,
		function (prop) { return preprocessor.inlineProperty(prop, doc); }
	);
}
//#endregion

/**
 * Applies a set of CSS rules and strings to a single element.
 * @returns {Promise}
 */
function applyTo(elem, rules, doc) {
	elem = cheerio(elem);
	return processStyle(elem, doc)
		.then(function (properties) {
			if (!doc.options.keepRules)
				properties = cascadeProperties(properties, elem, rules);

			var compact = doc.options.compact;
			// if compact, we want "a:b;c:d"
			// otherwise, we want  "a: b; c: d;", with a trailing semicolon and a space between each property.
			elem.attr('style',
				properties.map(function (r) { return r.toString(compact).replace(/\t/g, ' ') + (compact ? '' : ';'); })
						  .join(compact ? ';' : ' ') || undefined
			);
		});
}

/**
 * Applies a set of CSS rules and strings to an element
 * and to all of its descendant elements.
 *
 * @returns {Promise}
 */
function applyRecursive(elem, rules, doc) {
	var promises = [];

	if (elem.cheerio) {
		// If we were passed a wrapped Cheerio object,
		// recurse into each element inside of it.
		elem = { children: elem };
	} else
		promises.push(applyTo(cheerio(elem), rules, doc));

	for (var i = 0; i < elem.children.length; i++) {
		var child = elem.children[i];

		// Skip the entire <head> tree
		if (child.name === 'head') continue;

		//TODO: Remove unused classes & IDs.
		if (child.type === 'tag')
			promises.push(applyRecursive(child, rules, doc));
	}
	return Q.all(promises);
}

/**
 * Applies a collection of parsed CSS rules and sources to an HTML document.
 *
 * @returns {Promise}
 */
function applyStyles(doc, rules) {
	/// <summary>Applies a collection of parsed CSS rules and sources to an HTML document.</summary>
	if (!rules.length)
		return;
	//TODO: Add importance to dynamic rules

	var styleSource = rules;

	// If keepRules is true, all we need to do
	// is modify inline style="" attributes.
	// Otherwise, we need to modify the styles
	// to remove static selectors.  Therefore,
	// we need to copy the array first.
	if (!doc.options.keepRules)
		styleSource = styleSource.slice();

	return applyRecursive(doc.root().children(), styleSource, doc)
		.then(function () {
			if (!doc.options.keepRules) {
				// Remove all static rules
				styleSource = styleSource.filter(function (rule) {
					return !(rule instanceof ParsedStyleSheet.Rule) || rule.isDynamic;
				});
			}

			appendStyleSource(doc, styleSource);
		});
}


module.exports = applyStyles;