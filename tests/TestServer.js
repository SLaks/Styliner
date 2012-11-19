/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');
var path = require('path');
var qfs = require('q-fs');
var capsela = require('capsela');
var Styliner = require('..');
require('../Styliner-less');

var commander = require('commander');
commander.option('-c, --compact', "Minify generated HTML.");
commander.parse(process.argv);


var styliner = new Styliner(
	qfs.join(__dirname, 'TestFiles/'),
	{
		compact: commander.compact,
		url: function (relativePath, type) {
			return Q.resolve(relativePath + "?type=" + encodeURIComponent(type));

			//return Q.delay(relativePath + "?type=" + encodeURIComponent(type), 1000);
		}
	}
);

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
	.addStage(
		function (request) {
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
	.addStage(
		function (request) {
			var path = request.url.replace(/^\//, '');
			var filePath = qfs.join(styliner.baseDir, path);

			var self = this;
			if (/\/$/.test(path))
				return self.pass(request);

			return qfs.isDirectory(filePath).then(function (isDir) {
				if (isDir)
					return new capsela.Redirect(request.getBaseUrl() + "/" + path + "/");
				else
					return self.pass(request);
			});
		})
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
	.addStage(function (request) {
		return this.pass(request).then(function (response) {
			if (response && response.getContentType() === "text/html")
				return StylinerResponse.create(response);
			else
				return response;
		});
	})
	.addStage(new capsela.stages.FileServer("/", styliner.baseDir, "index.html"));


server.start();
console.log("Listening on port " + server.port);
