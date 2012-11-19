module.exports = {
	/**
	 * Checks whether a URL string starts with a scheme.
	 */
	hasScheme: function (uri) {
		return (/^[a-z][a-z.+-]+:/i).test(uri);
	},

	noopUrlTransform: function (url) { return url; }
};