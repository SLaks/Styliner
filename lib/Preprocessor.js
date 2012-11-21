/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";

// This file contains code that modifies parsed HTML
// and CSS source before applying the styles.

// This file has four entry points:
// processCachedStyleSheet() is called after parsing each
// stylesheet, to perform context-free modifications that
// do not depend on an HTML document.  It will modify the
// object model in-place.

// processDocumentStyleSheet() is called while processing
// a document.  It is called for each stylesheet included
// in the document, and should return an array of strings
// and rules to inline into the document. This method can
// not modify the ParsedStyleSheet object model; instead,
// it should make a copy of any Rule that must be changed

// Finally, processDocument() is called when processing a
// document to modify the HTML DOM (using cheerio).  This
// method should perform arbitrary modifications in-place
// and return a promise when it's finished.

// After everything else is done, processInlineProperty()
// is called to modify all CSS properties inside style=""
// attributes.

var Q = require('q');
var path = require('path');
var ParsedStyleSheet = require('./ParsedStyleSheet');
var util = require('./Util');

var cheerio = require('cheerio');

function processPropertyCached(prop, folder) {
	/// <summary>Modifies a property in a cached stylesheet.</summary>
	/// <param name="name" type="Property">The property to modify</param>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet containing the rule</param>

	prop.fullUrls = [];

	prop.valueParts.forEach(function (part) {
		switch (part.type) {
			case "uri":
				prop.value = prop.value.replace(part.uri, function (uri) {
					if (util.hasScheme(uri))
						return uri;		//Skip absolute URLs.

					var fullPath = path.join(folder, uri);
					prop.fullUrls.push(fullPath);
					return fullPath;
				});
				break;
			case "color":
				//TODO: Minify color literals
				break;
		}
	});
}

function processCachedStyleSheet(pss) {
	/// <summary>Pre-processes a shared ParsedStyleSheet object immediately after it is parsed.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to modify</param>
	// This function should perform global modifications that do not depend on the HTML document.

	pss.elements.forEach(function (elem) {
		if (elem instanceof ParsedStyleSheet.Rule) {
			elem.properties.forEach(function (prop) {
				processPropertyCached(prop, pss.folder);
			});
		}

		//TODO: Handle fixYahooMQ: true by modifying all selectors inside media queries
	});

	return pss;
}

function processPropertyDocument(prop, doc) {
	/// <summary>Copies a property from a cached stylesheet before applying it to a document.</summary>
	/// <param name="name" type="Property">The property being applied</param>

	if (!prop.fullUrls.length) 
		return undefined;

	var newProp = new ParsedStyleSheet.Property(prop);

	// Asynchronously resolve all URLs, and return a promise
	// for the cloned Property when they're all finished.
	return Q.all(prop.fullUrls.map(function (url) {
		var relative = path.relative(doc.folder, url).replace(/\\/g, '/');

		return doc.options.url(relative, "img")
			.then(function (resultUrl) {
				newProp.value = newProp.value.replace(url, resultUrl);
			});
	})).then(function () {
		return newProp;
	});
}
function processDocumentStyleSheet(pss, doc) {
	/// <summary>Pre-processes and transforms a shared ParseStyleSheet object into an array of rules and elements customized for this document.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to copy</param>

	return util.modifyArrayCopy(pss.elements, function (elem) {
		if (elem instanceof ParsedStyleSheet.Rule) {
			return ParsedStyleSheet.modifyRule(
				elem,
				null,		// We don't need to modify selectors
				function (prop) { return processPropertyDocument(prop, doc); }
			);
		}
		return undefined;
	});
}

function processInlineProperty(prop, doc) {
	/// <summary>Processes a property in an inline style="" attribute, returning a promise of a (potentially) new property.</summary>

	processPropertyCached(prop, doc.folder);
	return Q.when(
		processPropertyDocument(prop, doc),
		function (newProp) { return newProp || prop; }
	);
}

var urlAttributes = {
	a: ['href'],
	applet: ['codebase'],
	area: ['href'],
	base: ['href'],
	blockquote: ['cite'],
	body: ['background'],
	del: ['cite'],
	form: ['action'],
	frame: ['longdesc', 'src'],
	head: ['profile'],
	iframe: ['longdesc', 'src'],
	img: ['longdesc', 'src', 'usemap'],
	input: ['src', 'usemap', 'formaction'],
	ins: ['cite'],
	link: ['href'],
	object: ['classid', 'codebase', 'data', 'usemap'],
	q: ['cite'],
	script: ['src'],
	audio: ['src'],
	button: ['formaction'],
	command: ['icon'],
	embed: ['src'],
	html: ['manifest'],
	source: ['src'],
	video: ['poster', 'src']
};
var urlTagsSelector = Object.keys(urlAttributes).join(',');
function processDocument(doc) {
	/// <summary>Pre-processes a parsed HTML document.</summary>

	var promises = [];

	//TODO: Handle fixYahooMQ: true by adding an ID to the <html> element

	if (doc.options.url !== util.noopUrlTransform) {
		//If we have a URL transformer, run it through every URL attribute in the document
		doc(urlTagsSelector).each(function (index, elem) {
			var $elem = cheerio(elem);
			urlAttributes[elem.name].forEach(function (attr) {
				var url = $elem.attr(attr);
				if (!url || util.hasScheme(url) || /^#/.test(url))
					return;

				promises.push(Q.when(
					doc.options.url(url, elem.name),
					function (result) { $elem.attr(attr, result); }
				));
			});
		});
	}

	return Q.all(promises);
}

module.exports = {
	cachedStyleSheet: processCachedStyleSheet,
	documentStyleSheet: processDocumentStyleSheet,
	htmlDocument: processDocument,
	inlineProperty: processInlineProperty
};