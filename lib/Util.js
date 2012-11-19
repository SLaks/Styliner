/*jshint node: true, camelcase: true, eqeqeq: true, forin: true, immed: true, latedef: true, newcap: true, noarg: true, undef: true, globalstrict: true*/
"use strict";
var Q = require('q');

module.exports = {
	/**
	 * Checks whether a URL string starts with a scheme.
	 */
	hasScheme: function (uri) {
		return (/^[a-z][a-z.+-]+:/i).test(uri);
	},

	/**
	 * Copies and modifies an array, returning the original array if nothing was modified.
	 * @param {Array}		arr			The original array to loop through.  Neither the array nor its elements will be changed.
	 * @param {Function}	callback	A function that may modify elements.  The function is passed the original item and its index.  
	 *									Returning undefined will cause the item to remain unchanged; returning null will remove the item entirely.
	 *									The function can also return a promise.
	 */
	modifyArrayCopy: function (arr, callback) {
		var newArray = null;
		var promise = Q.resolve(arr);

		arr.forEach(function (oldVal, i) {
			promise = Q.spread(
				[promise, callback(oldVal, i)],
				// Wait for both all previous operations and the result of this callback
				function (_, newVal) {

					if (typeof newVal === "undefined" || newVal === arr[i]) {
						// If the item didn't change, but we had an earlier
						// change, push the original item to the new array.
						newArray && newArray.push(arr[i]);
					} else {
						// If the item was changed, and this is the first change,
						// create the new array, filling it with all of the prior
						// items
						if (!newArray)
							newArray = arr.slice(0, i);

						// If the item wasn't removed, push the new value on
						// to the new array.
						if (newVal !== null)
							newArray.push(newVal);
					}

					// Make sure the final promise returns the correct array.
					return newArray || arr;
				}
			);
		});

		return promise;
	},
	/**
	 * Modifies an array in-place.
	 * @param {Array}		arr			The original array to loop through.  Neither the array nor its elements will be changed.
	 * @param {Function}	callback	A function that may modify elements.  The function is passed the original item and its index.  
	 *									Returning undefined will cause the item to remain unchanged; returning null will remove the item entirely.
	 *									The function can also return a promise.
	 */
	modifyArray: function (arr, callback) {
		var promise = Q.resolve(arr);

		var indexOffset = 0;
		arr.forEach(function (oldVal, i) {
			promise = Q.spread(
				[promise, callback(oldVal, i)],
				// Wait for both all previous operations and the result of this callback
				// I need to wait for all previous operations in case removals happen in
				// the wrong order.  (I need to use the original index)
				function (_, newVal) {
					if (typeof newVal === "undefined")
						newVal = oldVal;

					if (newVal !== null)
						arr[i - indexOffset] = newVal;
					else {
						arr.splice(i - indexOffset, 1);
						indexOffset++;	//All future indices must be decremented to fill the gap.
					}

					// Make sure the final promise returns the correct array.
					return arr;
				}
			);
		});

		return promise;
	},

	noopUrlTransform: function (url) { return url; }
};