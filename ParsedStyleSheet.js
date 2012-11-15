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
function ParsedStyleSheet(source, fullPath) {
	this.complexSource = source;
	this.rules = [];

	// Expose the folder to this.createParser()
	this.folder = path.dirname(fullPath);

	var parser = this.createParser();

	winston.verbose("Started parsing " + fullPath);
	parser.parse(source);
	winston.verbose("Finished parsing " + fullPath);

	delete this.folder;
}

ParsedStyleSheet.prototype.createParser = function () {
	var self = this;
	var parser = new cssParser.Parser({ starHack: true, underscoreHack: true });

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
		self.rules.push.apply(self.rules, e.selectors.map(function (s) {
			return new Rule(s, currentPropertySet);
		}));
		currentPropertySet = null;
	});
	//#endregion

	return parser;
};

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
Property.prototype.toString = function (compact) {
	if (compact)
		return this.name + ":" + this.value + (this.important ? "!important" : "");
	else
		return this.name + ":\t" + this.value + (this.important ? " !important" : "");
};

module.exports = ParsedStyleSheet;