"use strict";

var path = require('path');
var qfs = require('q-io/fs');
var capsela = require('capsela');
var Styliner = require('..');
require('styliner-less')(Styliner);

var vash = require('vash');

var commander = require('commander');
commander.option('-c, --compact', "Minify generated HTML.");
commander.option('-k, --keep-rules', "Don't inline static CSS rules.");
commander.parse(process.argv);


var styliner = new Styliner(
	qfs.join(__dirname, 'TestFiles/'),
	{
		compact: commander.compact,
		keepRules: commander.keepRules,
		url: function (relativePath, type) {
			return relativePath + "?type=" + encodeURIComponent(type);

			//return Q.delay(relativePath + "?type=" + encodeURIComponent(type), 2000);
		}
	}
);

var VashViewEngine = capsela.View.extend({}, {
	init: function (template) {
		this._super(template);
		this.render = vash.compile(template);
	},
	isComplete: function () { return true; }
});


var StylinerResponse = capsela.Response.extend({
	create: function (filePath) {
		if (filePath instanceof capsela.FileResponse)
			filePath = filePath.path;

		return qfs.read(filePath)
			.then(function (source) {
				// Pass the directory containing the file for relative paths.
				return styliner.processHTML(source, qfs.directory(filePath));
			})
			.then(function (final) {
				return new StylinerResponse(
					200,
					{},
					final,
					"text/html"
				);
			});
	}
});

var server = new capsela.Server(8774)
	// Include stack traces in error pages.
	.addStage(function (request) {
		return this.pass(request).then(null, function (err) {
			if (err instanceof capsela.Response)
				return err;

			return new capsela.Response(
				500,
				{},
				err.stack || err.message,
				"text/plain"
			);
		});
	})

	// Render ViewResponses from all subsequent stages
	.addStage(new capsela.stages.ViewRenderer(qfs.join(__dirname, 'Views/'), VashViewEngine))
	// Show a list of pages at /
	.addStage(function (request) {
		if (request.path !== '/')
			return this.pass(request);

		return qfs.list(styliner.baseDir)
				.then(function (names) {
					return new capsela.ViewResponse("List", names);
				});
	})
	// Override the Content-Type header for some files from the Acid3 test
	.addStage(function (request) {
		var contentTypeOverride = {
			"acid3/empty.css": 'text/html',
			"acid3/support-b.png": 'text/html',
			"acid3/empty.xml": 'application/xml',
			"acid3/svg.xml": 'image/svg+xml',
			"acid3/xhtml.1": 'text/xml',
			"acid3/xhtml.2": 'text/xml',
			"acid3/xhtml.3": 'text/xml'
		};

		return this.pass(request).then(function (response) {
			if (!response || !response.path)
				return response;
			var relative = path.relative(styliner.baseDir, response.path).replace(/\\/g, '/');
			if (contentTypeOverride.hasOwnProperty(relative))
				response.setContentType(contentTypeOverride[relative]);
			return response;
		});
	})
	// Run all text/html files from subsequent stages through Styliner
	.addStage(function (request) {
		return this.pass(request).then(function (response) {
			if (response instanceof capsela.FileResponse && response.getContentType() === "text/html")
				return StylinerResponse.create(response);
			else
				return response;
		});
	})
	// Serve all files in the TestFiles folder
	.addStage(new capsela.stages.FileServer("/", styliner.baseDir, "index.html"));


server.start();
console.log("Listening on port " + server.port);
