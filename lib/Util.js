"use strict";

var Q = require('q');

module.exports = {
	/**
	 * Checks whether a URL string starts with a scheme (or is protocol-relative).
	 */
	hasScheme: function (uri) {
		return (/^([a-z][a-z.+-]+:|\/\/)/i).test(uri);
	},

	/**
	 * Copies and modifies an array, returning the original array if nothing was modified.
	 * @param {Array}		arr			The original array to loop through.  Neither the array nor its elements will be changed.
	 * @param {Function}	callback	A function that may modify elements.  The function is passed the original item and its index.
	 *									Returning undefined will cause the item to remain unchanged; returning null will remove the item entirely.
	 *									Returning an array will insert the items in the array instead of the original element.
	 *									The function can also return a promise.
	 * @return  An array, if the callback never returned a promise, or a promise of an array if it did.
	 */
	modifyArrayCopy: function (arr, callback) {
		if (!arr.length) return arr;

		var newArray = null;
		var index = -1;

		function traverse(newVal) {
			while (true) {
				// Unless we just got started, process the result of
				// the previous iteration, or the promise we resumed
				// traverse() from.
				if (index >= 0) {
					if (typeof newVal === "undefined" || newVal === arr[index]) {
						// If the item didn't change, but we had an earlier
						// change, push the original item to the new array.
						newArray && newArray.push(arr[index]);
					} else {
						// If the item was changed, and this is the first change,
						// create the new array, filling it with all of the prior
						// items
						if (!newArray)
							newArray = arr.slice(0, index);

						// If the item wasn't removed, push the new value on
						// to the new array.
						if (newVal instanceof Array)
							newArray.push.apply(newArray, newVal);
						else if (newVal !== null)
							newArray.push(newVal);
					}
				}
				index++;

				// Once we finish the entire array, return
				// the final result to the caller.
				if (index === arr.length)
					return newArray || arr;

				newVal = callback(arr[index], index);
				// If the next transformation is a promise,
				// break out of this call, then resume when
				// the result comes back.
				if (Q.isPromiseAlike(newVal))
					return Q.when(newVal, traverse);
				// Otherwise, process the actual value next
				// time around the loop
			}
		}
		return traverse();
	},
	/**
	 * Modifies an array in-place.
	 * @param {Array}		arr			The original array to loop through.
	 * @param {Function}	callback	A function that may modify elements.  The function is passed the original item and its index.
	 *									Returning undefined will cause the item to remain unchanged; returning null will remove the item entirely.
	 *									Returning an array will insert the items in the array instead of the original element.
	 *									The function can also return a promise.
	 */
	modifyArray: function (arr, callback) {
		if (!arr.length) return Q.resolve(arr);
		var promise = arr;

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

					if (newVal instanceof Array) {
						newVal.unshift(i + indexOffset, 1);
						arr.splice.apply(arr, newVal);
						// All future indices must be incremented because of the extra items.
						// newVal.length includes the two parameters to splice.
						indexOffset += newVal.length - 3;
					} else if (newVal !== null)
						arr[i + indexOffset] = newVal;
					else {
						arr.splice(i + indexOffset, 1);
						indexOffset--;	//All future indices must be decremented to fill the gap.
					}

					// Make sure the final promise returns the correct array.
					return arr;
				}
			);
		});

		return promise;
	},

	/**
	 * Modifies an array in-place, synchronously.
	 * @param {Array}		arr			The original array to loop through.
	 * @param {Function}	callback	A function that may modify elements.  The function is passed the original item and its index.
	 *									Returning undefined will cause the item to remain unchanged; returning null will remove the item entirely.
	 *									Returning an array will insert the items in the array instead of the original element.
	 *									Promises are not accepted.
	 */
	modifyArraySync: function (arr, callback) {
		var indexOffset = 0;
		for (var i = 0; i < arr.length; i++) {
			//Pass the original index to the callback
			var newVal = callback(arr[i], i - indexOffset);
			if (typeof newVal === "undefined")
				continue;

			if (newVal instanceof Array) {
				newVal.unshift(i, 1);
				arr.splice.apply(arr, newVal);
				// All future indices must be incremented because of the extra items.
				// newVal.length includes the two parameters to splice.
				indexOffset += newVal.length - 3;
				i += newVal.length - 3;
			} else if (newVal !== null) {
				arr[i] = newVal;
			} else {
				arr.splice(i + indexOffset, 1);
				indexOffset--;	//All future indices must be decremented to fill the gap.
				i--;
			}
		}
		return arr;
	},

	/**
	 * A URL transform function that does not modify URLs.
	 * This is used as a default if no other options are specified.
	 * The function is shared with other files so that the preprocessor 
	 * can skip crawling the HTML if no URL option was passed.
	 */
	noopUrlTransform: function (url) { return url; }
};