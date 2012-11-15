var fs = require('fs');
var path = require('path');
var cssParser = require('parserlib').css;
var winston = require('winston');

/**
 * Parses a CSS file into the object model needed to apply to an HTML document.
 * @param {String}	source		The CSS source.
 * @param {String}	fullPath	The full path to the file; used to resolve imported files.
 *
 * @class ParsedStyleSheet
 * @constructor
 */
function ParsedStyleSheet(source, fullPath, options) {
	// Contains the CSS source that cannot be inlined and must be emitted in a <style> tag.
	// This is used a a string builder to avoid costly string concatenations.
	this.sourceBuilder = [];

	// Contains the parsed rules that can be inlined into the document.
	this.rules = [];

	this.options = options;

	// Expose the folder to this.createParser()
	this.folder = path.dirname(fullPath);

	var parser = this.createParser();

	winston.verbose("Started parsing " + fullPath);
	parser.parse(source);
	winston.verbose("Finished parsing " + fullPath);

	delete this.folder;

	this.complexSource = this.sourceBuilder.join('');
}

ParsedStyleSheet.prototype.createParser = function () {
	var self = this;
	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true, ieFilters: true });

	parser.addListener('import', function (e) {
		// If we encounter an imported file, parse it into our existing instance
		// I need to read the file synchronously, so that its rules get inserted
		// immediately.  (before parsing the rest of the original file)

		var fullImportPath = path.join(self.folder, e.uri);
		var nestedParser = self.createParser();

		winston.verbose("Started parsing imported file  " + fullImportPath);
		nestedParser.parse(fs.readFileSync(fullImportPath));
		winston.verbose("Finished parsing imported file  " + fullImportPath);
	});

	//TODO: Log error events with line and message

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

		if (!currentPropertySet) return;
		currentPropertySet.push(new Property(e));
	});
	parser.addListener('endrule', function (e) {
		if (!currentPropertySet) return;

		// Each rule can have multiple comma-separated Selectors.
		// In these cases, I create a separate rule for each one,
		// each referencing the same properties array.

		for (var i = 0; i < e.selectors.length; i++) {
			var rule = new Rule(e.selectors[i], currentPropertySet);

			if (isDynamic(e.selectors[i]))
				self.sourceBuilder.push(rule.toString(self.options.compact));
			else
				self.rules.push(rule);
		}
		currentPropertySet = null;
	});
	//#endregion

	return parser;
};

var dynamicPseudos = {
	// Allow selectors to specify that they need Javascript enabled
	".js": true,	

	// Form element selectors
	":checked": true,
	":enabled": true,
	":disabled": true,
	":indeterminate": true,

	":default": true,

	":valid": true,
	":invalid": true,
	":in-range": true,
	":out-of-range": true,
	":required": true,
	":optional": true,
	":read-only": true,
	":read-write": true,

	// Link state selectors
	":visited": true,
	":active": true,
	":hover": true,
	":focus": true,
	":target": true,

	":first-line": true,
	":first-letter": true,
	":before": true,
	":after": true
};
/**
 * Checks whether a parsed Selector instance contains complex selector parts that cannot be evaluated in advance.
 * (eg, ::after, :hover, :target)
 */
function isDynamic(selector) {
	return selector.parts.some(function (part) {
		// Skip combinators, which are never dynamic
		return part instanceof cssParser.SelectorSubPart 
			&& part.modifiers.some(function (part) {
				//TODO: Recurse into :not()
				return dynamicPseudos.hasOwnProperty(part.text)
					|| /^::/.test(part.text)	// All psuedo-elements are dynamic
		});
	});
}

function Rule(s, properties) {
	this.selectorText = s.text;
	this.specificity = s.specificity;
	this.properties = properties;
}
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
	this.name = ev.property.toString();
	this.value = ev.value.text;
	this.important = ev.important;
}
// TODO: Image urls
Property.prototype.toString = function (compact) {
	if (compact)
		return this.name + ":" + this.value + (this.important ? "!important" : "");
	else
		return this.name + ":\t" + this.value + (this.important ? " !important" : "");
};

module.exports = ParsedStyleSheet;