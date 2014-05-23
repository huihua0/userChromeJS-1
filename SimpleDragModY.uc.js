// ==UserScript==
// @name           SimpleDragModY
// @description    简单拖曳修改版 By ywzhiqi
// @include        chrome://browser/content/browser.xul
// @charset        UTF-8
// @version        1.1
// @homepageURL    https://github.com/ywzhaiqi/userChromeJS
// @note           2014-5-23，忽略 javascript: 开头的链接，完善百度盘特殊密码链接，
// 							  增加文字链接、file:// 开头的链接和 about:config?filter 开头的链接的识别。
// @note           2014-5-21，增加：向下后台搜索文字。
// @note           2014-5-20，增加：“http://pan.baidu.com/s/1bn7uGmb 密码: jl4b” 的识别
// @note           2014-5-20，增加：如果在链接上选择文字，会优先打开该文字而不是链接。
// ==/UserScript==

if (window.SimpleDragModY) {  // 方便修改调试用，无需重启
	window.SimpleDragModY.uninit();
	delete window.SimpleDragModY;
}

if (!window.Services) Cu.import("resource://gre/modules/Services.jsm");

window.SimpleDragModY = {
	init: function() {
		gBrowser.mPanelContainer.addEventListener("dragstart", this, false);
		gBrowser.mPanelContainer.addEventListener("dragover", this, false);
		gBrowser.mPanelContainer.addEventListener("drop", this, false);
		window.addEventListener("unload", this, false);
	},
	uninit: function() {
		gBrowser.mPanelContainer.removeEventListener("dragstart", this, false);
		gBrowser.mPanelContainer.removeEventListener("dragover", this, false);
		gBrowser.mPanelContainer.removeEventListener("drop", this, false);
		window.removeEventListener("unload", this, false);
	},
	handleEvent: function(event) {
		switch (event.type) {
			case "dragstart":
				this.startPoint = [event.screenX, event.screenY];
				this.sourceNode = event.target;
				event.target.localName == "img" && event.dataTransfer.setData("application/x-moz-file-promise-url", event.target.src);

				if (event.target.nodeName == "A") {
					var selectLinkText = document.commandDispatcher.focusedWindow.getSelection().toString();
					if (selectLinkText != "" && event.explicitOriginalTarget == document.commandDispatcher.focusedWindow.getSelection().focusNode) {
						event.dataTransfer.setData("text/plain", selectLinkText);
						event.dataTransfer.clearData("text/x-moz-url");
						event.dataTransfer.clearData("text/x-moz-url-desc");
						event.dataTransfer.clearData("text/x-moz-url-data");
						event.dataTransfer.clearData("text/uri-list");
					}
				}
				
				break;
			case "dragover":
				this.startPoint && (Components.classes["@mozilla.org/widget/dragservice;1"].getService(Components.interfaces.nsIDragService).getCurrentSession().canDrop = true);
				break;
			case "drop":
				if (this.startPoint && event.target.localName != "textarea" && (!(event.target.localName == "input" && (event.target.type == "text" || event.target.type == "password"))) && event.target.contentEditable != "true") {
					event.preventDefault();
					event.stopPropagation();
					var [subX, subY] = [event.screenX - this.startPoint[0], event.screenY - this.startPoint[1]];
					var [distX, distY] = [(subX > 0 ? subX : (-subX)), (subY > 0 ? subY : (-subY))];
					var direction;
					if (distX > distY)
						direction = subX < 0 ? "L" : "R";
					else
						direction = subY < 0 ? "U" : "D";

					var url, searchText, 
						inBackground = (direction == "D") ? true : false;

					if (event.dataTransfer.types.contains("application/x-moz-file-promise-url")) {
						// 图片
						url = event.dataTransfer.getData("application/x-moz-file-promise-url");
					} else if (event.dataTransfer.types.contains("text/x-moz-url")) {
						// 链接
						url = event.dataTransfer.getData("text/x-moz-url")
								.replace(/[\n\r]+/g, "\n").split("\n")[0];
						if (url.indexOf('javascript:') == 0) {
							url = null;
							this.startPoint = 0;
							return;
						}
					} else {
						// 文字，包括链接文字、非链接文字、百度盘密码链接等
						// http://pan.baidu.com/s/1bn7uGmb 密码: jl4b
						searchText = event.dataTransfer.getData("text/unicode").trim();
						// console.log(searchText)
						if (searchText.match(/^(?:http:|pan\.|百度网盘下载链接).*[\n\s]*(?:提取)?密?[码|碼][:：]?/i)) {
							url = searchText.replace(/\s*(提取)?密?[码|碼][:：]?\s*/, '#');
							if (url.match(/...|百度网盘/)) {  // url 不完整的
								let html = event.dataTransfer.getData("text/html");
								let node = new DOMParser().parseFromString(html, 'text/html');
								if (node.links.length > 0)
									url = node.links[0].href + '#' + url.split('#')[1];
							}
						} else if (this.seemAsURL(searchText)) {
							// url = this.fixupSchemer(searchText, true);
							url = this.getDroppedURL_Fixup(searchText);
						} else if (/^file:\/\/\/[\S]+$/.test(searchText)) {
							url = searchText;
						}  else if (searchText.indexOf('about:config?filter=') == 0) {
							url = searchText;
						}
					}

					if (url) {
						let doc = event.target.ownerDocument || getBrowser().contentDocument;
						// openUILinkIn(data, 'tab');
						// gBrowser.addTab(data);
						gBrowser.loadOneTab(url, {
							referrerURI: doc.documentURIObject, 
							inBackground: inBackground, 
							relatedToCurrent: true
						});
					} else {
						// 搜索框搜索选中文字
						searchText = event.dataTransfer.getData("text/unicode");

						let useNewTab = true;
						// BrowserSearch.loadSearch(searchText, true);
						let engine = Services.search.defaultEngine;
						let submission = engine.getSubmission(searchText, null); // HTML response
						if (submission) {
							openLinkIn(submission.uri.spec,
						               useNewTab ? "tab" : "current",
						               { postData: submission.postData,
						                 inBackground: inBackground,
						                 relatedToCurrent: true });
						}
					}

					this.startPoint = 0;
				}
		}
	},
	seemAsURL: function(url) {  // 以下几个函数来自 Easy DragToGo+ 扩展
		// url test
		var DomainName = /(\w+(\-+\w+)*\.)+\w{2,7}/;
		var HasSpace = /\S\s+\S/;
		var KnowNameOrSlash = /^(www|bbs|forum|blog)|\//;
		var KnowTopDomain1 = /\.(com|net|org|gov|edu|info|mobi|mil|asia)$/;
		var KnowTopDomain2 = /\.(de|uk|eu|nl|it|cn|be|us|br|jp|ch|fr|at|se|es|cz|pt|ca|ru|hk|tw|pl|me|tv|cc)$/;
		var IsIpAddress = /^([1-2]?\d?\d\.){3}[1-2]?\d?\d/;
		var seemAsURL = !HasSpace.test(url) && DomainName.test(url) && (KnowNameOrSlash.test(url) || KnowTopDomain1.test(url) || KnowTopDomain2.test(url) || IsIpAddress.test(url));
		return seemAsURL;
	},
	fixupSchemer: function (aURI,isURL) {
	    var RegExpURL = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
	    if (aURI.match(RegExpURL)) return aURI;

	     if (isURL && /^(?::\/\/|\/\/|\/)?(([1-2]?\d?\d\.){3}[1-2]?\d?\d(\/.*)?|[a-z]+[\-\w]+\.[\-\w\.]+(\/.*)?)$/i.test(aURI)) aURI = "http://" + RegExp.$1;
	    else if (/^\w+[\-\.\w]*@(\w+(\-+\w+)*\.)+\w{2,7}$/.test(aURI) && !easyDragUtils.getPref("dragtogoEmailSearch", true)) aURI = "mailto:" + aURI;
	    else {
	        var table = "ttp=>http,tp=>http,p=>http,ttps=>https,tps=>https,ps=>https,s=>https";
	        var regexp = new RegExp();
	        if (aURI.match(regexp.compile('^(' + table.replace(/=>[^,]+|=>[^,]+$/g, '').replace(/\s*,\s*/g, '|') + '):', 'g'))) {
	            var target = RegExp.$1;
	            table.match(regexp.compile('(,|^)' + target + '=>([^,]+)'));
	            aURI = aURI.replace(target, RegExp.$2);
	        }
	    }
	    return aURI;
	},
	getDroppedURL_Fixup: function(url) {  // URL 的修正，来自 DragNgoModoki_Fx3.7.uc.js
		if (!url) return null;
		if (/^h?.?.p(s?):(.+)$/i.test(url)) {
			url = "http" + RegExp.$1 + ':' + RegExp.$2;
			if (!RegExp.$2) return null;
		}
		var URIFixup = Components.classes['@mozilla.org/docshell/urifixup;1']
			.getService(Components.interfaces.nsIURIFixup);
		try {
			url = URIFixup.createFixupURI(url, URIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP).spec;
			// valid urls don't contain spaces ' '; if we have a space it
			// isn't a valid url, or if it's a javascript: or data: url,
			// bail out
			if (!url ||
				!url.length ||
				url.indexOf(" ", 0) != -1 ||
				/^\s*javascript:/.test(url) ||
				/^\s*data:/.test(url) && !/^\s*data:image\//.test(url))
				return null;
			return url;
		} catch (e) {
			return null;
		}
	},
};

window.SimpleDragModY.init();