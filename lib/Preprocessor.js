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
var Qx = require('qx');
var path = require('path');
var ParsedStyleSheet = require('./ParsedStyleSheet');
var util = require('./Util');

// Inspired by
// http://www.emailonacid.com/blog/details/C13/stop_yahoo_mail_from_rendering_your_media_queries
var yahooRootClass = "YMQ-Fix-Root";

var cheerio = require('cheerio');

function escapeRegExp(str) {
	//http://stackoverflow.com/a/6969486/34397
	return str.replace(/[-\[\/{}()\\*+?.\^\$|]/g, "\\$&");
}

/**
 * Formats a URL to appear within a CSS url(...) value
 * If the URL contains characters that need to be escaped, this will return a quoted and escaped string.
 * See http://www.w3.org/TR/CSS21/grammar.html#scanner
 */
function applyQuotes(url) {
	// parserlib currently does not support escapes anyway, but
	// once it does, I'll be ready for it.
	if (/['"\s\(\)]/.test(url))
		return "'" + url.replace(/\n|\r\n|\r|\f/g, "\\$&") + "'";
	else
		return url;
}

var trblProperties = { padding: true, margin: true };
var trblOrder = ['top', 'right', 'bottom', 'left'];
/**
 * Splits a margin or padding shorthand property into its four component properties
 */
function splitTRBLProperty(prop) {
	var values = prop.valueParts;
	var retVal = [];
	for (var i = 0; i < trblOrder.length; i++) {
		var p = new ParsedStyleSheet.Property(prop);
		p.name += '-' + trblOrder[i];
		if (i === 3 && values.length === 3)
			p.value = values[1].text;	// t r b => t r b r
		else
			p.value = values[i % values.length].text;

		delete p.isClone;			// We use isClone to mean non-cached.
		p.fullUrls = [];			// All cached properties must have this.
		// TRBL properties cannot actually have URLs. (except border-image?)
		retVal.push(p);
	}
	return retVal;
}
//TODO: Split other shorthands

function processPropertyCached(prop, folder, forElement) {
	/// <summary>Modifies a property in a cached stylesheet.</summary>
	/// <param name="name" type="Property">The property to modify</param>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet containing the rule</param>
	/// <param name="forElement" type="Booleam">True if this is a CSS rule or style attribute; false if it's a property in an unsupported location (eg, animation or @page).</param>

	prop.fullUrls = [];

	prop.valueParts.forEach(function (part) {
		switch (part.type) {
			case "uri":
				prop.value = prop.value.replace(new RegExp("(['\"]?)(" + escapeRegExp(part.uri) + ")\\1"), function (full, quote, uri) {
					if (util.hasScheme(uri))
						return applyQuotes(uri);		// Skip absolute URLs.

					// If it's a relative path, normalize it to the base folder.
					var fullPath = uri[0] === '/' ? uri : path.join(folder, uri);
					prop.fullUrls.push(fullPath);
					return fullPath;
				});
				break;
			case "color":
				//TODO: Minify color literals
				break;
		}
	});

	if (forElement) {
		// Split all shorthand properties so that we can
		// catch non-inlined overrides and important-ize
		// them correctly.
		if (trblProperties.hasOwnProperty(prop.name))
			return splitTRBLProperty(prop);
	}
}

function processCachedStyleSheet(pss, options) {
	/// <summary>Pre-processes a shared ParsedStyleSheet object immediately after it is parsed.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to modify</param>
	// This function should perform global modifications that do not depend on the HTML document.

	util.modifyArraySync(pss.elements, function (elem) {
		if (elem instanceof ParsedStyleSheet.Rule) {
			util.modifyArraySync(elem.properties, function (prop) {
				return processPropertyCached(prop, pss.folder, true);
			});

			if (options.fixYahooMQ && elem.inMediaQuery)
				elem.selectorText = "." + yahooRootClass + " " + elem.selectorText;
		} else if (elem instanceof ParsedStyleSheet.Property) {
			return processPropertyCached(elem, pss.folder, false);
		}

		return undefined;
	});

	return pss;
}

function processPropertyDocument(prop, context) {
	/// <summary>Copies a property from a cached stylesheet before applying it to a document.</summary>
	/// <param name="name" type="Property">The property being applied</param>

	if (!prop.fullUrls.length)
		return undefined;

	var newProp = new ParsedStyleSheet.Property(prop);

	// Asynchronously resolve all URLs, and return a promise
	// for the cloned Property when they're all finished.
	return Qx.map(prop.fullUrls, function (url) {
		var relative = path.relative(context.folder, url).replace(/\\/g, '/');

		return Q.when(
			context.options.url(relative, "img"),
			function (resultUrl) {
				newProp.value = newProp.value.replace(url, applyQuotes(resultUrl));
			}
		);
	}).thenResolve(newProp);
}
function processDocumentStyleSheet(pss, context) {
	/// <summary>Pre-processes and transforms a shared ParseStyleSheet object into an array of rules and elements customized for this document.</summary>
	/// <param name="pss" type="ParsedStyleSheet">The parsed stylesheet to copy</param>

	return util.modifyArrayCopy(pss.elements, function (elem) {
		if (elem instanceof ParsedStyleSheet.Rule) {
			return ParsedStyleSheet.modifyRule(
				elem,
				null,		// We don't need to modify selectors
				function (prop) { return processPropertyDocument(prop, context); }
			);
		} else if (elem instanceof ParsedStyleSheet.Property) {
			return processPropertyDocument(elem, context);
		}
		return undefined;
	});
}

function processInlineProperty(prop, context) {
	/// <summary>Processes a property in an inline style="" attribute, returning a promise of an array of (potentially) new properties.</summary>

	var props = processPropertyCached(prop, context.folder, true) || prop;
	if (!(props instanceof Array))
		props = [props];

	return Qx.map(
		props,
		function (p) { return processPropertyDocument(p, context) || p; }
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
	video: ['poster', 'src'],

	table: ['background']
};
var urlTagsSelector = Object.keys(urlAttributes).join(',');
function processDocument(context) {
	/// <summary>Pre-processes a parsed HTML document.</summary>
	var promises = [];

	// Preprended to selectors inside media queries to
	// prevent them from matching after Yahoo mangles.
	if (context.options.fixYahooMQ)
		context.$('html').addClass(yahooRootClass);

	if (context.options.url !== util.noopUrlTransform) {
		//If we have a URL transformer, run it through every URL attribute in the document
		context.$(urlTagsSelector).each(function (index, elem) {
			var $elem = cheerio(elem);
			urlAttributes[elem.name].forEach(function (attr) {
				var url = $elem.attr(attr);
				if (!url || util.hasScheme(url) || /^#/.test(url))
					return;

				promises.push(Q.when(
					context.options.url(url, elem.name),
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