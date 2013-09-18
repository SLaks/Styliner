"use strict";

var Q = require('q');
var winston = require('winston');
var fs = require('fs');
var path = require('path');
var cssParser = require('parserlib').css;
var CSSselect = require('CSSselect');

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

	// Don't parse empty files
	if (!source) return;

	// Expose the filename to this.createParser()
	this.folder = path.dirname(fullPath);

	var parser = this.createParser(fullPath);

	winston.verbose("Started parsing " + fullPath);
	parser.parse(source);
	winston.verbose("Finished parsing " + fullPath);
}

/**
 * Creates a parserlib CSS parser instance that parses into this
 * instance's state.
 * This is called recursively to handle @import-ed CSS files.
 *
 * @param {String} fileName	The name of the file being parsed.  This is only used for logging purposes.
 */
ParsedStyleSheet.prototype.createParser = function (fileName) {
	var self = this;
	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true, ieFilters: true });

	parser.addListener('import', function (e) {
		// If we encounter an imported file, parse it into our existing instance
		// I need to read the file synchronously, so that its rules get inserted
		// immediately.  (before parsing the rest of the original file)

		var fullImportPath = path.join(self.folder, e.uri);
		var nestedParser = self.createParser(fullImportPath);

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
	var inMediaQuery = false;

	//#region Media Queries
	parser.addListener('startmedia', function (e) {
		inMediaQuery = true;
		self.elements.push("@media ");
		self.elements.push(e.media.join(self.options.compact ? ',' : ', '));
		openBlock();
	});

	parser.addListener('endmedia', function () {
		inMediaQuery = false;
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

	//TODO: startpagemargin, startkeyframes, startkeyframerule

	//#region @font-face
	parser.addListener('startfontface', function () {
		self.elements.push("@font-face");

		openBlock();
	});

	parser.addListener('endfontface', closeBlock);
	//#endregion

	//#region Read rules
	var currentPropertySet = null;
	parser.addListener('startrule', function () {
		currentPropertySet = [];
	});
	parser.addListener('property', function (e) {
		if (e.invalid) {
			winston.error("Property " + new Property(e).toString().replace(/\t/g, ' ') + " at " + fileName + "#" + e.invalid.line + " is invalid: " + e.invalid.message);

			// Skip the property; this allows earlier valid properties to cascade down
			if (!self.options.keepInvalid)
				return;
		}

		if (currentPropertySet)
			currentPropertySet.push(new Property(e));
		else {
			// If we're not inside a rule (eg, properties in a keyframes declaration), 
			// add the property directly to the output source.
			// We'll also need a terminating semicolon.
			self.elements.push(new Property(e), ";");
			if (!self.options.compact)
				self.elements.push('\n');
		}
	});
	parser.addListener('endrule', function (e) {

		// Each rule can have multiple comma-separated Selectors.
		// In these cases, I create a separate rule for each one.
		// I don't combine the dynamic ones because each selector
		// may overlap different static selectors for importance.
		// (static selectors don't end up in the HTML anyway)
		self.elements.push.apply(self.elements, e.selectors.map(function (s, i) {
			// Make sure that each rule gets a different properties array.
			if (i > 0)
				currentPropertySet = currentPropertySet.slice();

			return new Rule(s, currentPropertySet, inMediaQuery);
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
	":link": false,	//We don't know whether the user visited the link.  Perhaps I should change this.
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
		if (!(part instanceof cssParser.SelectorPart)) {
			rule.staticSelector.push(part.text);
			continue;
		}

		if (part.elementName !== null)
			rule.staticSelector.push(part.elementName.toString());

		for (var e = 0; e < part.modifiers.length; e++) {
			checkDynamicElement(rule, part.modifiers[e]);
			// If we found a hard-dynamic selector, stop immediately
			if (rule.staticSelector === null)
				return;
		}
	}
}
/**
 * Checks whether a selector modifier is dynamic,
 * modifying the rule appropriately.
 * This function is recursive for :not selectors.
 */
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


function Rule(s, properties, inMediaQuery) {
	if (arguments.length !== 3) {
		if (!(s instanceof Rule))
			throw new Error("new Rule(s) can only be used to clone rules");
		this.selectorText = s.selectorText;
		this.specificity = s.specificity;
		this.inMediaQuery = s.inMediaQuery;
		this.isDynamic = s.isDynamic;
		this.staticSelector = s.staticSelector;
		this.matches = s.matches;
		this.isClone = true;

		this.properties = properties || s.properties;

		if (this.properties === s.properties)
			this.properties = this.properties.slice();

		return;
	}

	this.properties = properties;

	this.inMediaQuery = !!inMediaQuery;

	this.parseSelector(s);
}

Rule.prototype.parseSelector = function (selector) {
	if (!(selector instanceof cssParser.Selector))
		selector = new cssParser.Parser().parseSelector(selector);

	this.selectorText = selector.text;
	this.specificity = selector.specificity;

	// True if this selector cannot be evaluated in advance
	this.isDynamic = this.inMediaQuery;

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
	if (this.staticSelector)
		this.matches = CSSselect.parse(this.staticSelector);
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

	var selectorResult = (selectorCallback && selectorCallback(rule))
						|| rule.selectorText;

	// If we get synchronous responses, don't call Q.spread() (which does a nextTick())
	if (propertiesResult === rule.properties && selectorResult === rule.selectorText)
		return rule;

	return Q.spread([selectorResult, propertiesResult],
		function (selector, properties) {
			// In case the callbacks return promises of the original values
			if (typeof selector === "undefined")
				selector = rule.selectorText;
			if (selector === rule.selectorText && properties === rule.properties)
				return rule;

			if (!rule.isClone) {
				rule = new Rule(rule, properties);
			} else
				rule.properties = properties;

			if (selector !== rule.selectorText)
				rule.parseSelector(selector);

			return rule;
		});
};
module.exports = ParsedStyleSheet;
module.exports.Rule = Rule;
module.exports.Property = Property;
