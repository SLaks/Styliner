var Q = require('q');
var qfs = require('q-fs');
var capsela = require('capsela');
var Styliner = require('..');
require('../Styliner-less');

var commander = require('commander');
commander.option('-c, --compact', "Minify generated HTML.");
commander.parse(process.argv);


var styliner = new Styliner(qfs.join(__dirname, 'TestFiles/'), { compact: commander.compact });

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
		return this.pass(request).then(function (response) {
			if (response && response.getContentType() === "text/html")
				return StylinerResponse.create(response);
			else
				return response;
		});
	})
	.addStage(new capsela.stages.FileServer("/", styliner.baseDir, "index.html"));

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

server.start();
console.log("Listening on port " + server.port);
