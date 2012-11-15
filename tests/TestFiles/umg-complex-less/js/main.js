// Hide address bar on mobile devices
(function (win) {
    if (!/mobile/i.test(navigator.userAgent)) return;
    var doc = win.document;
    if (!location.hash || !win.addEventListener) {
        window.scrollTo(0, 1);
        var scrollTop = 1,
            getScrollTop = function () {
                return "scrollTop" in doc.body ? doc.body.scrollTop : 1;
            },
            bodycheck = setInterval(function () {
                if (doc.body) {
                    clearInterval(bodycheck);
                    scrollTop = getScrollTop();
                    win.scrollTo(0, scrollTop === 1 ? 0 : 1);
                }
            }, 15);
        win.addEventListener("load", function () {
            setTimeout(function () {
                if (getScrollTop() < 20) {
                    win.scrollTo(0, scrollTop === 1 ? 0 : 1);
                }
            }, 0);
        }, false);
    }
})(this);
