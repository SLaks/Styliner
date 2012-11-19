/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var fs = require('fs');
var path = require('path');
var cssParser = require('parserlib').css;
var winston = require('winston');

var util = require('./Util');

/**
 * Parses a CSS file into the object model needed to apply to an HTML document.
 * @param {String}	source		The CSS source.
 * @param {String}	fullPath	The full path to the file; used to resolve imported files.
 *
 * @class ParsedStyleSheet
 * @constructor
 */
function ParsedStyleSheet(source, fullPath, options) {
	// Contains all elements found in the stylesheet.  This array will hold
	// strings for literal CSS source that isn't a rule (eg, a font-face or
	// keyframes declaration, as well as the opening and closing lines of a
	// media query). All rules (even those inside of media queries) will be
	// parsed into Rule objects in this array.
	this.elements = [];

	this.options = options;

	// Expose the folder to this.createParser()
	this.folder = path.dirname(fullPath);

	var parser = this.createParser();

	winston.verbose("Started parsing " + fullPath);
	parser.parse(source);
	winston.verbose("Finished parsing " + fullPath);
}

/**
 * Creates a parserlib CSS parser instance that parses into this
 * instance's state.
 * This is called recursively to handle @import-ed CSS files.
 */
ParsedStyleSheet.prototype.createParser = function () {
	var self = this;
	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true, ieFilters: true });

	parser.addListener('import', function (e) {
		// If we encounter an imported file, parse it into our existing instance
		// I need to read the file synchronously, so that its rules get inserted
		// immediately.  (before parsing the rest of the original file)

		var fullImportPath = path.join(self.folder, e.uri);
		var nestedParser = self.createParser();

		winston.verbose("Started parsing imported file " + fullImportPath);
		nestedParser.parse(fs.readFileSync(fullImportPath));
		winston.verbose("Finished parsing imported file " + fullImportPath);
	});

	//#region Output Helpers
	var openBlock = function () {
		if (self.options.compact)
			self.elements.push("{");
		else
			self.elements.push(" {\n");
	};
	var closeBlock = function () {
		if (self.options.compact)
			self.elements.push("}");
		else
			self.elements.push("}\n");
	};
	//#endregion

	//TODO: Log error events with line and message

	// True if we're in the middle of a media query, in which
	// case all selectors are at least soft-dynamic.
	var inDynamicContext = false;

	//#region Media Queries
	parser.addListener('startmedia', function (e) {
		inDynamicContext = true;
		self.elements.push("@media ");

		self.elements.push(e.media.join(self.options.compact ? ',' : ', ').trim());
		openBlock();
	});

	parser.addListener('endmedia', function (e) {
		inDynamicContext = false;
		closeBlock();
	});
	//#endregion

	//#region @page
	parser.addListener('startpage', function (e) {
		self.elements.push("@page");

		if (e.id)
			self.elements.push(" ", e.id.toString());
		if (e.pseudo)
			self.elements.push(" ", e.pseudo.toString());

		openBlock();
	});

	parser.addListener('endpage', closeBlock);
	//#endregion

	//#region @font-face
	parser.addListener('startfontface', function (e) {
		self.elements.push("@font-face");

		openBlock();
	});

	parser.addListener('endfontface', closeBlock);
	//#endregion

	//#region Read rules
	var currentPropertySet = null;
	parser.addListener('startrule', function (e) {
		currentPropertySet = [];
	});
	parser.addListener('property', function (e) {
		if (e.invalid) {
			console.error("Property " + new Property(e).toString() + " at line " + e.invalid.line + " is invalid: " + e.invalid.message);
			// Proceed anyway
		}

		if (currentPropertySet)
			currentPropertySet.push(new Property(e));
		else {
			// If we're not inside a rule (eg, properties in a keyframes declaration), 
			// add the property text directly to the output source.
			self.elements.push(new Property(e).toString(self.options.compact) + ";");
			if (!self.options.compact)
				self.elements.push('\n');
		}
	});
	parser.addListener('endrule', function (e) {

		// Each rule can have multiple comma-separated Selectors.
		// In these cases, I create a separate rule for each one,
		// each referencing the same properties array.
		// I don't combine the dynamic ones because each selector
		// may overlap different static selectors for importance.
		// (static selectors don't end up in the HTML anyway)
		self.elements.push.apply(self.elements, e.selectors.map(function (s) {
			return new Rule(s, currentPropertySet, inDynamicContext);
		}));

		currentPropertySet = null;
	});
	//#endregion

	return parser;
};

//#region Check for dynamic selectors

// This hash contains all pseudo-classes & elements that cannot be
// applied statically.  Any CSS rules that contain these selectors
// will be left as-is in a <style> tag.
// The value of each property in the hash indicates whether it's a
// pseudo-element (true) or pseudo-class (false).  CSS rules which
// contain pseudo-elements do not need to be accounted for in when
// calculating the cascade (since they will never be overridden by
// inline styles).  Rules with pseudo-classes may need !important,
// to override earlier rules that were inlined on the same element
var dynamicPseudos = {
	//Allow selectors to specify that they need Javascript enabled
	".js": false,

	// Form element selectors
	":checked": false,
	":enabled": false,
	":disabled": false,
	":indeterminate": false,

	":default": false,

	":valid": false,
	":invalid": false,
	":in-range": false,
	":out-of-range": false,
	":required": false,
	":optional": false,
	":read-only": false,
	":read-write": false,

	// Link state selectors
	":visited": false,
	":active": false,
	":hover": false,
	":focus": false,
	":target": false,

	// Pseudo-elements
	":first-line": true,
	":first-letter": true,
	":before": true,
	":after": true
};
/**
 * Sets the isDynamic and staticSelector properties of a rule, by checking 
 * whether its Selector instance contains complex selector parts that can't
 * be evaluated in advance.
 * (eg, ::after, :hover, :target)
 */
function checkDynamic(rule, selector) {
	for (var p = 0; p < selector.parts.length; p++) {
		var part = selector.parts[p];

		if (rule.staticSelector.length)
			rule.staticSelector.push(' ');

		// Skip combinators, which are never dynamic
		if (!(part instanceof cssParser.SelectorSubPart)) {
			rule.staticSelector.push(part.text);
			continue;
		}

		if (part.elementName !== null)
			rule.staticSelector.push(part.elementName.text);

		for (var e = 0; e < part.modifiers.length; e++) {
			checkDynamicElement(rule, part.modifiers[e]);
			// If we found a hard-dynamic selector, stop immediately
			if (rule.staticSelector === null)
				return;
		}
	}
}
function checkDynamicElement(rule, elem) {
	if (/^::/.test(elem.text)) {
		// All pseudo-elements are hard-dynamic
		rule.isDynamic = true;
		rule.staticSelector = null;
	} else if (elem.type === "not") {
		rule.staticSelector.push(":not(");
		for (var i = 0; i < elem.args.length; i++) {
			checkDynamicElement(rule, elem.args[i]);
		}
		rule.staticSelector.push(")");	//:not() arguments can never be hard-dynamic

	} else if (dynamicPseudos.hasOwnProperty(elem.text)) {
		rule.isDynamic = true;
		if (dynamicPseudos[elem.text])	//If it's hard-dynamic
			rule.staticSelector = null;

	} else {
		// If the modifier isn't dynamic, add it to the static selector.
		rule.staticSelector.push(elem.text);
	}
}
//#endregion


function Rule(s, properties, isDynamicContext) {
	if (arguments.length === 1) {
		if (!(s instanceof Rule))
			throw new Error("new Rule(s) can only be used to clone rules");
		this.selectorText = s.selectorText;
		this.specificity = s.specificity;
		this.properties = s.properties;
		this.isDynamicContext = s.isDynamicContext;
		this.isDynamic = s.isDynamic;
		this.staticSelector = s.staticSelector;
		this.isClone = true;

		return;
	}

	this.properties = properties;


	// True if this selector cannot be evaluated in advance
	this.isDynamicContext = !!isDynamicContext;

	this.parseSelector(s);
}

Rule.prototype.parseSelector = function (selector) {
	if (!(selector instanceof cssParser.Selector))
		selector = new cssParser.Parser().parseSelector(selector);

	this.selectorText = selector.text;
	this.specificity = selector.specificity;

	this.isDynamic = this.isDynamicContext;

	// A statically-applicable selector that will match all
	// elements that might be matched by the actual dynamic
	// selector, or null if the dynamic selector contains a
	// pseudo-element (a hard-dynamic selector).
	// If this is non-null, the rules in the selector might
	// need !important to preserve cascade. (at application
	// time)
	this.staticSelector = [];	//StringBuilder
	checkDynamic(this, selector);
	if (this.staticSelector !== null)
		this.staticSelector = this.staticSelector.join('');

	//TODO: Create compactSelectorText without whitespace.
};

Rule.prototype.toString = function (compact) {
	var retVal = [];

	retVal.push(this.selectorText);
	if (compact)
		retVal.push("{");
	else
		retVal.push(" {");

	for (var i = 0; i < this.properties.length; i++) {
		if (!compact)
			retVal.push("\n\t");
		retVal.push(this.properties[i].toString(compact));

		if (!compact || i < this.properties.length - 1)
			retVal.push(';');
	}

	if (compact)
		retVal.push("}");
	else
		retVal.push("\n}");

	return retVal.join('');
};

function Property(ev) {
	if (ev instanceof Property) {
		this.name = ev.name;
		this.value = ev.value;
		this.important = ev.important;
		this.isClone = true;

		return;
	}

	this.name = ev.property.toString();
	this.value = ev.value.text;
	this.valueParts = ev.value.parts;
	this.important = ev.important;
}
Property.prototype.toString = function (compact) {
	if (compact)
		return this.name + ":" + this.value + (this.important ? "!important" : "");
	else
		return this.name + ":\t" + this.value + (this.important ? " !important" : "");
};

/**
 * Modifies a Rule instance, cloning it if the original is not itself a clone.
 * Each callback is optional.
 */
ParsedStyleSheet.modifyRule = function (rule, selectorCallback, propertyCallback) {
	var propertiesResult;
	if (!propertyCallback)
		propertiesResult = rule.properties;
	else if (!rule.isClone)
		propertiesResult = util.modifyArrayCopy(rule.properties, propertyCallback);
	else
		propertiesResult = util.modifyArray(rule.properties, propertyCallback);

	return Q.spread([selectorCallback ? selectorCallback(rule) : rule.selector, propertiesResult],
		function (selector, properties) {
			if (typeof selector === "undefined")
				selector = rule.selector;

			if (selector === rule.selector && properties === rule.properties)
				return rule;

			if (!rule.isClone)
				rule = new Rule(rule);

			if (selector !== rule.selector)
				rule.parseSelector(selector);

			rule.properties = properties;

			return rule;
		});
};
module.exports = ParsedStyleSheet;
module.exports.Rule = Rule;
module.exports.Property = Property;
