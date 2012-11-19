/// <reference path="ParsedStyleSheet.js" />

// This file contains code that modifies parsed HTML
// and CSS source before applying the styles.

var Q = require('q');
var path = require('path');
var ParsedStyleSheet = require('./ParsedStyleSheet');
var util = require('./Util');

var cheerio = require('cheerio');

function processCachedStyleSheet(pss) {
	/// <summary>Pre-processes a shared ParsedStyleSheet object immediately after it is parsed.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to modify</param>
	// This function should perform global modifications that do not depend on the HTML document.

	pss.elements.forEach(function (elem) {
		if (elem instanceof ParsedStyleSheet.Rule) {
			elem.properties.forEach(function (prop) {
				processPropertyCached(prop, pss);
			});
		}

		//TODO: Handle fixYahooMQ: true by modifying all selectors inside media queries
	});

	return pss;
}

function processPropertyCached(prop, pss) {
	/// <summary>Modifies a property in a cached stylesheet.</summary>
	/// <param name="name" type="Property">The property to modify</param>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet containing the rule</param>

	prop.relativeUrls = [];

	prop.valueParts.forEach(function (part) {
		switch (part.type) {
			case "uri":
				prop.value = prop.value.replace(part.uri, function (uri) {
					if (util.hasScheme(uri))
						return url;		//Skip absolute URLs.

					var fullPath = path.join(pss.folder, uri);
					prop.relativeUrls.push(fullPath);
					return fullPath;
				});
				break;
			case "color":
				//TODO: Minify color literals
				break;
		}
	});
}

function processDocumentStyleSheet(pss, doc) {
	/// <summary>Pre-processes and transforms a shared ParseStyleSheet object into an array of rules and elements customized for this document.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to copy</param>

	return pss.elements;
}

function processPropertyDocument(prop, pss, doc) {
	/// <summary>Modifies a property in a cached stylesheet.</summary>
	/// <param name="name" type="Property">The property to modify</param>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet containing the rule</param>

	var changed;
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
	input: ['src', 'usemap'],
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
	input: ['formaction'],
	source: ['src'],
	video: ['poster', 'src'],
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
				if (!url || util.hasScheme(url))
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
	htmlDocument: processDocument
};