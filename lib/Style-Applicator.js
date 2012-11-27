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
function cascadeProperties(inlineProperties, elem, context) {
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

	applyProperties(inlineProperties, inlineSpecifity, context.rules.length + 1);

	var dynamicRules = {};
	context.rules.forEach(function (rule, index) {
		if (!(rule instanceof ParsedStyleSheet.Rule))
			return;

		if (rule.isDynamic) {
			// If the rule is soft-dynamic, check whether we
			// need to ensure that it doesn't get overridden
			if (rule.staticSelector && rule.matches(elem[0])) {
				rule.properties.forEach(function (p) {
					// Skip properties that are already important, since there's nothing we can do further.
					if (p.important) return;

					(dynamicRules[p.name] = dynamicRules[p.name] || []).push({
						prop: p,
						specificity: rule.specificity,
						index: index,
						important: p.important,
						// Special properties for dynamicOverrides:
						rule: rule
					});
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

			var rule = dynamicInfo.rule;
			var propIndex = rule.properties.indexOf(dynamicInfo.prop);	//Find the index before cloning the rule

			// Unless we copied it earlier, copy the rule
			// so that we don't modify the cached version
			if (!dynamicInfo.rule.isClone)
				dynamicInfo.rule = context.rules[dynamicInfo.index] = new ParsedStyleSheet.Rule(rule);

			var newProp = new ParsedStyleSheet.Property(dynamicInfo.prop);
			newProp.important = true;
			dynamicInfo.rule.properties[propIndex] = newProp;

			var selector = dynamicInfo.rule.staticSelector;
			(context.dynamicOverrides[selector] = context.dynamicOverrides[selector] || []).push(dynamicInfo);
		});
	});
	//TODO: Add !important to inlined styles that just got overridden.

	elem.propertyValues = propertyValues;
	return _.chain(propertyValues).values().map("values").flatten().value();
	//TODO: Use shorthand where possible.
}

/**
 * Adds !important to any inline styles that were overridden by !important
 * dynamic rules from less-specific selectors.
 */
function fixDynamicOverrides(context) {
	_.forOwn(context.dynamicOverrides, function (props, selector) {
		var compiledSelector = props[0].rule.matches;
		var matchingElems = context.root.find(compiledSelector);
		matchingElems.each(function (i, elem) {
			props.forEach(function (dynamicInfo) {
				// If this element doesn't have that property anyway,
				// there's nothing to do.
				if (!elem.propertyValues || !elem.propertyValues.hasOwnProperty(dynamicInfo.prop.name))
					return;
				// If the selector containing the inlined property is
				// less specific than the dynamic selector, there is nothing to do
				if (!overrides(dynamicInfo, elem.propertyValues[name]))
					return;
				elem.propertyValues[dynamicInfo.prop.name].prop.important = true;
			});
		});
	});
}

function appendStyleSource(context) {
	/// <summary>Appends an array of non-static CSS elements (strings and rules) to a document.</summary>
	if (!context.rules.length)
		return;

	var compact = context.options.compact;
	var styleSource = context.rules
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

	var head = context.$('head');
	if (head.length)
		head.append(styleSource);
	else {
		var body = context.$('body');
		if (body.length)
			body.before(styleSource);
		else
			context.root.prepend(styleSource);
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
function processStyle(elem, context) {
	var properties = parseStyle(elem);
	if (!properties.length)
		return Q.resolve([]);
	return util.modifyArray(
		properties,
		function (prop) { return preprocessor.inlineProperty(prop, context); }
	);
}
//#endregion

/**
 * Applies a set of CSS rules and strings to a single element.
 * @returns {Promise}
 */
function applyTo(elem, context) {
	elem = cheerio(elem);
	return processStyle(elem, context)
		.then(function (properties) {
			if (!context.options.keepRules)
				properties = cascadeProperties(properties, elem, context);

			var compact = context.options.compact;
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
function applyRecursive(elem, context) {
	var promises = [];

	if (elem.cheerio) {
		// If we were passed a wrapped Cheerio object,
		// recurse into each element inside of it.
		elem = { children: elem };
	} else
		promises.push(applyTo(cheerio(elem), context));

	for (var i = 0; i < elem.children.length; i++) {
		var child = elem.children[i];

		// Skip the entire <head> tree
		if (child.name === 'head') continue;

		//TODO: Remove unused classes & IDs. 
		//(build dynamicClasses array in Preprocessor, then build list of removable elements)
		if (child.type === 'tag')
			promises.push(applyRecursive(child, context));
	}
	return Q.all(promises);
}

/**
 * Applies a collection of parsed CSS rules and sources to an HTML document.
 *
 * @returns {Promise}
 */
function applyStyles(context) {
	/// <summary>Applies a collection of parsed CSS rules and sources to an HTML document.</summary>

	// Holds all properties from dynamic rules that were made important in order
	// to override inline styles. The properties are grouped by static selector.
	context.dynamicOverrides = {};

	return applyRecursive(context.root.children(), context)
		.then(function () {
			fixDynamicOverrides(context);

			if (!context.options.keepRules) {
				// If we're inlining styles, remove all static rules
				context.rules = context.rules.filter(function (rule) {
					return !(rule instanceof ParsedStyleSheet.Rule) || rule.isDynamic;
				});
			}

			appendStyleSource(context);
		});
}


module.exports = applyStyles;