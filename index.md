---
layout: default
title: Styliner – Making HTML emails sane again
stylesheets: ["syntax-highlighting", "content"]
---
<header>
	<div class="container">
		<div class="title">
			<h1>Styliner</h1>
			<h2>Making HTML emails sane again</h2>
		</div>
		<nav>
			<ul>
				<li><a href="#about">About</a></li>
				<li><a href="#features">Features</a></li>
				<li><a href="#usage">Usage</a></li>
				<li><a href="#options">Options</a></li>
				<li><a href="#faq">FAQ</a></li>
				<li><a href="#limitations">Limitations</a></li>
				<li><a href="https://github.com/SLaks/Styliner"><strong>GitHub</strong></a></li>
			</ul>
		</nav>
	</div>
</header>
<div class="container">
<article>
<h1 id="about">About</h1>
Styliner is a Node.js library that takes HTML documents with regular CSS stylesheets, and moves all of the CSS properties into inline styles.

This lets you write your emails using regular CSS stylesheets and selectors, and have it generate the ugly inline `style=""` for Gmail automatically.

<h1 id="features">Features</h1>
Styliner uses [CSSselect](https://github.com/fb55/CSSselect) to match CSS selectors; this should support all CSS2 selectors and most CSS3 selectors.

Styliner fully passes Acid1, and passes almost all of Acid2 (except for a few places where my [CSS parser](https://github.com/nzakas/parser-lib) doesn't handle invalid syntax according to spec.  
Acid3 is primarily driven by Javascript, so it isn't applicable to Styliner.

<h1 id="usage">Usage</h1>
First, grab Styliner from npm:

```
npm install styliner
```

Next, create a new `Styliner` instance.  This instance stores the base directory for relative paths (used to read external stylesheets from disk or HTTP), as well as configuration settings (see [below](#options)):

```js
var styliner = new Styliner(__dirname + '/html');
```

The `Styliner` instance also caches parsed CSS files so that they can be referenced from other HTML files without re-parsing.

Finally, call the `processHTML()` method with the HTML source code to process.  This function returns a [promise](https://github.com/kriskowal/q) of the resuling inlined source:

```js
var originalSource = require('fs').readFileSync(__dirname + '/html/source.html', 'utf8');

styliner.processHTML(originalSource)
		.then(function(processedSource) {
			// Do something with this string
		});
```

You would typically write the processed HTML source to a file, or send it in an email or HTTP response.

**Coming soon**: Standalone command-line utilities and a web-based demo for testing.

<h1 id="options">Options</h1>
The optional second parameter to the Styliner constructor is an object that can have the following options: (all options default to false)

 - `compact: true`
  - True to minify all output.  This option removes all extraneous whitespace from the generated HTML (including any remaining inline stylesheets)   
 - `noCSS: true`
  - True to not emit `<style>` tags for rules that cannot be inlined.  This option will completely drop any dynamic CSS rules. (such as media queries, pseudo-elements, or `@font-face`s)
 - `keepRules: true`
  - True to keep all rules in `<style>` tags instead of inlining static rules into elements.  This results in smaller files, but will not work with Gmail.
 - `fixYahooMQ: true`
  - True to add an attribute/ID selector to all rules in media queries to fix a bug in Yahoo Mail.  Yahoo Mail drops all media queries, converting their contents to regular rules that will always be applied.  This option adds a workaround for that.
 - `keepInvalid: true`
  - Don't skip properties that parserlib reports as invalid. (all invalid properties are always logged as winston errors)
  - Pass this option if you're using features that parser doesn't recognize, or if you come across a bug in parserlib
  - This option breaks Acid2, which tests that valid properties from earlier rules replace invalid properties from later rules.  (see also the first known issue)
 - `urlPrefix: "dir/"`
  - The path containing referenced URLs.  All non-absolute URLs in `<a>` tags, `<img>` tags, and stylesheets will have this path prepended.  For greater flexibility, pass a `url()` function instead.
 - `url: function(path, type)`
  - A function called to resolve URLs.  All non-absolute URLs in HTML or CSS will be replaced by the return value of this function. The function is passed the relative path to the file and the source of the URL ("img" or "a" or other HTML tags; URLs from CSS pass "img"). It can return a promise or a string.

<h1 id="faq">Frequently Asked Questions</h1>
##What happens to relative URLs?

Styliner will resolve relative paths to referenced stylesheets relative to the `baseDirectory` (passed to the Styliner constructor or as the second parameter to `processHTML()`).  It will read stylesheets from disk or HTTP using the resulting absolute path.

Relative URLs (in HTML tags or as image URLs in stylesheets) will remain relative to the document being processed.  Styliner will expand relative URLs in referenced stylesheets to include the path to the stylesheet; URLs in the HTML itself are left untouched.

To customize URLs in the final output, pass a `urlPrefix` of `url()` options (see [above](#options)).

##What about pseudo-classes or media queries?
Selectors that involve pseudo-classes or pseudo-elements, as well as all selectors within media queries, cannot be inlined into `style=""` attributes, since they don't always apply to the target element (or, for pseudo-elements, because there is no target element in source).  
Therefore, Styliner will leave these rules in place, so they can work in environments that do recognize stylesheets (in particular, the iOS Mail app).

You can create responsive emails the same way you would create responsive websites, and they will work in both Gmail and more fully-featured mail clients.

##What if my media query overrides a rule that was inlined?
Styliner will automatically add `!important` to media queries that should override rules that were inlined.  

This has some limitations; see [below](#limitations).

##Can I use [LESS](http://lesscss.org)?
[Yup](https://github.com/SLaks/Styliner-less).

You can easily add support for other preprocessors; see the [source](https://github.com/SLaks/Styliner-less/blob/master/Styliner-less.js) for Styliner-less to get started.

##Can Styliner minify the generated source too?

Sure; just pass `compact: true`.  Note that the minifier currently does little more than removing extraneous whitespace; in particular, it won't do CSS tricks like shortening colors or combining shorthand properties.
Some CSS tricks are done implicitly by Styliner (eg, removing unused selectors), except in media queries.

##What if I don't want to inline some rules?
Just wrap them in any kind of media query (eg, `@media all`).
Styliner will also not inline any selectors that contain `.js`, under the assumption that they're meant to apply when Javascript adds a `js` class to the root element.

<h1 id="limitations">Limitations &amp; Known issues</h1>
 - Browser property fallbacks don't cascade
  - If you specify `background: red;` in one rule, and `background: linear-gradient(...)` in a more specific rule, Styliner will replace the property from the first rule with the more specific one.  This means that browsers that don't support `linear-gradient()` won't see any background at all. 
  - Instead, put both properties in the same rule, and Styliner will know to keep both of them.  To make this easier, you can use a LESS mixin.
 - Except for `margin` and `padding`, shorthand inlined properties that are overridden by non-inlined non-shorthand counterparts will not be overridden correctly.
  - To fix this, add splitter methods in Preprocessor.js to split other shorthand properties.
 - If one element receives a property from a soft-dynamic (pseudo-class) rule and a static rule, and a different element receives a property from an earlier static rule that overrides that soft-dynamic rule, the soft-dynamic rule will incorrectly override the static rule on the second element.
  - This happens because I need to make the dynamic rule `!important` in order to override the inlined static rule on the first element.
  - I could do another pass to find the and `!important`-ize the inline property in the second element, but that would leave an unfixable problem if there is another dynamic rule that should override that property on the second element.
 - Similarly, if one element receives a property from a soft-dynamic (pseudo-class) rule and a static rule, and a different element receives a property from an _later_ static rule that overrides that soft-dynamic rule, but is in turn overridden by a second soft-dynamic rule, the second soft-dynamic rule will be incorrectly overridden.
  - This happens because the inlined property from its static rule is made `!important` to override the already-`!important`-ized less-specific soft-dynamic rule.  It is then impossible to make the more-specific soft-dynamic rule override the inlined property.
</article>
</div>