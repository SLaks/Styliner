var Q = require('q');
var qfs = require('q-fs');
var capsela = require('capsela');
var Styliner = require('..');

var styliner = new Styliner(qfs.join(__dirname, 'TestFiles/'));

var server = new capsela.Server(8774)
	.addStage(
		function (request) {
			var path = request.url.replace(/^\//, '');

			var filePath = qfs.join(styliner.baseDir, path);
			return qfs.isFile(filePath)
					.then(function (exists) {
						if (!exists)
							return new capsela.Response(404);

						return qfs.read(filePath)
					})
					.then(function (source) {
						return styliner.processHTML(source);
					})
					.then(function (final) {
						return new capsela.Response(
							200,
							{},
							final,
							"text/html"
						);
					})
					.then(null, function (err) {
						return new capsela.Response(
							500,
							{},
							err.stack,
							"text/plain"
						);
					})
		});

server.start();
console.log("Listening on port " + server.port);
