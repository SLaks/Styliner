#Styliner
Styliner is a Node.js library that reads CSS rules from external stylesheets and converts them to inline `style=""` attributes in an HTML document.  

Styliner is intended for use with HTML emails.  With it, you can write regular CSS or LESS (with the Styliner-less package) stylesheets, then merge them into your HTML and create emails that work with Gmail (which drops all `<style>` tags).  Unfortunately, though, you'll still need to use `<table>`s to get complex layout.

You can also use advanced features ("dynamic rules") like `:hover` selectors or media queries, and Styliner will leave them in a `<style>` tag.  This way, you can build interactive emails that will light up when viewed in an email client that supports `<style>` tags, while still maintaining Gmail support.  

In effect, you get graceful degradation for your email designs.

##Usage
Styliner uses the [Q](https://github.com/kriskowal/q) promise library.

```javascript
var styliner = new Styliner(baseDir, { options });
styliner.processHTML(htmlSource, directory)
    .then(function(source) { ... });
//Pass filePath to processHTML
styliner.parseFile(filePath)
      .then(function(source) { ... });
```

The `baseDir` parameter specifies the base directory for relative paths.  When processing an HTML source file, you can optionally specify a directory for that source, and any relative paths within the file will be treated as relative to that directory (instead of relative to the `Styliner` instance's `baseDir`).  
The `processHTML` method returns a Q promise of the inlined HTML source.

You can pass an options hash as the second parameter to the `Styliner` constructor with the following options: (all options default to false):

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
  - A function called to resolve URLs.  All non-absolute URLs in HTML or CSS will be replaced by the return value of this function. The function is passed the relative path to the file and the source of the URL ("img" or "a" or other HTML tags; URLs from CSS pass "img"). It can return a promise or a string

##Known Issues
 - Browser property fallbacks don't cascade
  - If you specify `background: red;` in one rule, and `background: linear-gradient(...)` in a more specific rule, Styliner will replace the property from the first rule with the more specific one.  This means that browsers that don't support `linear-gradient()` won't see any background at all.
  - Instead, put both properties in the same rule, and Styliner will know to keep both of them.  To make this easier, you can use a LESS mixin
 - Except for `margin` and `padding`, shorthand inlined properties that are overridden by non-inlined non-shorthand counterparts will not be overridden correctly.
  - To fix this, add splitter methods in Preprocessor.js to split other shorthand properties.
 - If one element receives a property from a soft-dynamic (pseudo-class) rule and a static rule, and a different element receives a property from an earlier static rule that overrides that soft-dynamic rule, the soft-dynamic rule will incorrectly override the static rule on the second element.
  - This happens because I need to make the dynamic rule `!important` in order to override the inlined static rule on the first element.
  - I could do another pass to find the and `!important`-ize the inline property in the second element, but that would leave an unfixable problem if there is another dynamic rule that should override that property on the second element.
 - Similarly, if one element receives a property from a soft-dynamic (pseudo-class) rule and a static rule, and a different element receives a property from an _later_ static rule that overrides that soft-dynamic rule, but is in turn overridden by a second soft-dynamic rule, the second soft-dynamic rule will be incorrectly overridden.
  - This happens because the inlined property from its static rule is made `!important` to override the already-`!important`-ized less-specific soft-dynamic rule.  It is then impossible to make the more-specific soft-dynamic rule override the inlined property.
  - This is impossible to fix.  This issue could be flipped (to match the previous issue) by only setting `important = true` after the first pass.
 - These issues could be made fixable by adding additional levels of importance to the CSS spec (`!important1`, `!important2`, etc), and changing Styliner to keep running additional passes and making overridden rules more and more important until it stabilizes.
  - This would probably [not be a good idea](http://blogs.msdn.com/b/oldnewthing/archive/2011/03/10/10138969.aspx).

###Acid Test Issues
Acid3 doesn't work because most of its rules need to be applied dynamically (for elements created in Javascript).  I can fix this by adding `.js` to those rules.

Acid2 has the following issues:

 - `background: red pink` (which is an invalid value) incorrectly overrides the valid `background: yellow` for `.parser`, resulting in a white background.
  - This happens because parserlib does not validate the `background` property at all.  (this would be a complex validation rule to add)

 - `width: 200` (which is an invalid value) incorrectly overrides the valid `width: 2em` for `.parser`, resulting in the element stretching to fit the browser.
  - This is fixed by [parserlib#48](https://github.com/nzakas/parser-lib/pull/48), which has not been merged.

 - `* html .parser` incorrectly matches `.parser`, resulting in a gray background.
  - This is caused by [CSSselect#8](https://github.com/fb55/CSSselect/issues/8) and [cheerio#162](https://github.com/MatthewMueller/cheerio/issues/162).



#License
[MIT](http://opensource.org/licenses/MIT)
