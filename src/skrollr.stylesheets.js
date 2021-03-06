/*!
 * skrollr stylesheets.
 * Parses stylesheets and searches for skrollr keyframe declarations.
 * Converts them to data-attributes.
 * Is an AMD module; returns an object that can be called with the
 * skrollr instance when the dom is loaded.
 */
define(['skrollr'], function(skrollr) {
	'use strict';

	var sheets = [];
	var lastCall;
	var resizeThrottle = 30;
	var resizeDefer;
	var lastMatchingStylesheetsKey = '';
	var processedMatchingStylesheetsKeys = {};
	var ssPrefix = 'ss';
	var skrollrInst;

	//Finds the declaration of an animation block.
	var rxAnimation = /@-skrollr-keyframes\s+([\w-]+)/g;

	//Finds the block of keyframes inside an animation block.
	//http://regexpal.com/ saves your ass with stuff like this.
	var rxKeyframes = /\s*\{\s*((?:[^{]+\{[^}]*\}\s*)+?)\s*\}/g;

	//Gets a single keyframe and the properties inside.
	var rxSingleKeyframe = /([\w\-]+)\s*\{([^}]+)\}/g;

	//Finds usages of the animation.
	var rxAnimationUsage = /-skrollr-animation-name\s*:\s*([\w-]+)/g;

	var fetchRemote = function(url) {
		var xhr = new XMLHttpRequest();

		/*
		 * Yes, these are SYNCHRONOUS requests.
		 * Simply because skrollr stylesheets should run while the page is loaded.
		 * Get over it.
		 */
		try {
			xhr.open('GET', url, false);
			xhr.send(null);
		} catch (e) {
			//Fallback to XDomainRequest if available
			if (window.XDomainRequest) {
				xhr = new XDomainRequest();
				xhr.open('GET', url, false);
				xhr.send(null);
			}
		}

		return xhr.responseText;
	};

	//"main"
	var kickstart = function(sheetElms, instance) {
		skrollrInst = instance;

		//Iterate over all stylesheets, embedded and remote.
		for(var i = 0, len = sheetElms.length; i < len; i++) {
			var sheetElm = sheetElms[i];
			var content;

			if(sheetElm.getAttribute('data-skrollr-stylesheet') === null) {
				continue;
			}

			if(sheetElm.tagName === 'LINK') {
				//Remote stylesheet, fetch it (synchrnonous).
				content = fetchRemote(sheetElm.href);
			} else {
				//Embedded stylesheet, grab the node content.
				content = sheetElm.textContent || sheetElm.innerText || sheetElm.innerHTML;
			}

			if(content) {
				sheets.push({
					'content':content,
					'media': sheetElm.getAttribute('media'),
					'animations': {},
					'selectors': [],
					'id': sheetElm.getAttribute('id')
				});
			}
		}

		//We take the stylesheets in reverse order.
		//This is needed to ensure correct order of stylesheets and inline styles.
		sheets.reverse();

		//Now parse all stylesheets.
		for(var sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
			content = sheets[sheetIndex].content;
			parseDeclarations(content, sheets[sheetIndex].animations);
			parseUsage(content, sheets[sheetIndex].selectors);
		}

		run(false);
	};

	var run = function(fromResize) {
		var now = (new Date()).getTime();
		var matchingStylesheetsKey;

		if(fromResize && lastCall && now - lastCall < resizeThrottle) {
			window.clearTimeout(resizeDefer);
			resizeDefer = window.setTimeout(run, resizeThrottle);
			return;
		}
		else {
			lastCall = now;
		}

		matchingStylesheetsKey = getMatchingStylesheetsKey(sheets);

		//the active stylesheets have changed, so we have to do something.
		if(matchingStylesheetsKey !== lastMatchingStylesheetsKey) {

			resetSkrollrElements();

			//if we haven't seen this set of matching stylesheets before,
			//we need to save the keyframes into the dom for future reference.
			if(!processedMatchingStylesheetsKeys[matchingStylesheetsKey]) {
				saveKeyframesToDOM(sheets, matchingStylesheetsKey);
				processedMatchingStylesheetsKeys[matchingStylesheetsKey] = true;
			}

			//Apply the keyframes to the elements.
			applyKeyframes(matchingStylesheetsKey);
			skrollrInst.refresh();

			//update lastMatchingStylesheetsKey
			lastMatchingStylesheetsKey = matchingStylesheetsKey;
		}
	};

	//Finds animation declarations and puts them into the output map.
	var parseDeclarations = function(input, output) {
		rxAnimation.lastIndex = 0;

		var animation;
		var rawKeyframes;
		var keyframe;
		var curAnimation;

		while((animation = rxAnimation.exec(input)) !== null) {
			//Grab the keyframes inside this animation.
			rxKeyframes.lastIndex = rxAnimation.lastIndex;
			rawKeyframes = rxKeyframes.exec(input);

			//Grab the single keyframes with their CSS properties.
			rxSingleKeyframe.lastIndex = 0;

			//Save the animation in an object using it's name as key.
			curAnimation = output[animation[1]] = {};

			while((keyframe = rxSingleKeyframe.exec(rawKeyframes[1])) !== null) {
				//Put all keyframes inside the animation using the keyframe (like botttom-top, or 100) as key
				//and the properties as value (just the raw string, newline stripped).
				curAnimation[keyframe[1]] = keyframe[2].replace(/[\n\r\t]/g, '');
			}
		}
	};

	//Finds usage of animations and puts the selectors into the output array.
	var parseUsage = function(input, output) {
		rxAnimationUsage.lastIndex = 0;

		var match;
		var begin;
		var end;

		while((match = rxAnimationUsage.exec(input)) !== null) {
			//This match is inside a style declaration.
			//We need to walk backwards to find the selector.

			//First find the curly bracket that opens this block.
			end = rxAnimationUsage.lastIndex;
			while(end-- && input.charAt(end) !== '{') {}

			//Now walk farther backwards until we grabbed the whole selector.
			//This either ends at beginning of string or at end of next block.
			begin = end;
			while(begin-- && input.charAt(begin - 1) !== '}') {}

			//Associate this selector with the animation name.
			output.push([input.substring(begin, end).replace(/[\n\r\t]/g, ''), match[1]]);
		}
	};

	//Applies the keyframes (as data-attributes) to the elements.
	var applyKeyframes = function(matchingStylesheetsKey) {
		var attrName   = 'data-'+ ssPrefix + '-'+ matchingStylesheetsKey;
		var lastAttr   = 'data-' + ssPrefix + '-' + lastMatchingStylesheetsKey;
		var elements   = document.querySelectorAll('['+attrName+'], ['+lastAttr+']');
		var currElement;
		var styler = function(v) { skrollr.setStyle(currElement, v, ''); }; //use skrollr's built in function to handle prefixes etc.
		var easingStripper = function(propertyWithEasing) { return propertyWithEasing.replace(/\[.*\]/, ''); };

		for(var i=0, len = elements.length; i < len; i++) {
			currElement  = elements[i];

			//create the new data attrs
			var keyframeData = JSON.parse(currElement.getAttribute(attrName)) || {};
			for(var keyframeName in keyframeData) {
				currElement.setAttribute('data-' + keyframeName, keyframeData[keyframeName]);
			}

			//remove old style settings (from the lastMatchingStylesheetKey's keyframes) in the style attribute
			var theseKeyframes = JSON.parse(currElement.getAttribute(lastAttr)) || {};
			for(var thisKeyframe in theseKeyframes) {
				propertiesFinder(theseKeyframes[thisKeyframe]).map(easingStripper).forEach(styler);
			}
		}
	};

	function resetSkrollrElements() {
		var elements = document.body.querySelectorAll('*');
		var attrArray = [];
		var curElement;

		for(var elementIndex = 0, elementsLength = elements.length; elementIndex < elementsLength; elementIndex++) {
			curElement = elements[elementIndex];

			for(var k = 0; k < curElement.attributes.length; k++) {
				var attr = curElement.attributes[k];

				if(/^data-\-?[0-9]+$/.test(attr.name)) {
					attrArray.push(attr.name);
				}
			}

			for(k = 0; k < attrArray.length; k++) {
				curElement.removeAttribute(attrArray[k]);
			}
		}
	}

	function saveKeyframesToDOM(sheets, matchingStylesheetsKey) {
		var selectors = [];
		var animations = {};
		var attrName = 'data-'+ ssPrefix + '-' + matchingStylesheetsKey;
		var curSheet;
		var curSelector;
		var elements;
		var curElement;
		var curData;
		var keyframes;
		var keyframeName;

		for(var i = 0, len = sheets.length; i < len; i++) {
			curSheet = sheets[i];

			//find the stylesheets that match the current media query, and apply them.
			if(matchingStylesheetsKey.charAt(i)=='1') {
				selectors = selectors.concat(curSheet.selectors);

				for(var key in curSheet.animations) {
					if (curSheet.animations.hasOwnProperty(key)) {
						animations[key] = curSheet.animations[key];
					}
				}
			}
		}

		for(var j = 0, len2 = selectors.length; j < len2; j++) {
			curSelector = selectors[j];
			elements = document.querySelectorAll(curSelector[0]);

			if(!elements) {
				continue;
			}

			keyframes = animations[curSelector[1]];

			for(var k = 0, len3 = elements.length; k < len3; k++) {
				curElement = elements[k];
				curData = JSON.parse(curElement.getAttribute(attrName) || '{}');

				for(keyframeName in keyframes) {
					//add a semicolon onto the end to make sure we can append more properties later without corruption
					if(keyframes[keyframeName].charAt(keyframes[keyframeName].length - 1) != ';') {
						keyframes[keyframeName] += ';';
					}

					//If the element already has this keyframe inline, give the inline one precedence by putting it on the right side.
					//The inline one may actually be the result of the keyframes from another stylesheet.
					//Since we reversed the order of the stylesheets, everything comes together correctly here.
					if(curData[keyframeName]) {
						curData[keyframeName] = keyframes[keyframeName] + curData[keyframeName];
					}
					else {
						curData[keyframeName] = keyframes[keyframeName];
					}
				}

				curElement.setAttribute(attrName, JSON.stringify(curData));
			}
		}
	}

	function getStylesheetsKey(sheets, testFunc) {
		var key = '';

		for(var i = 0, len = sheets.length; i < len; i++) {
			key = key.concat(testFunc(sheets[i]) ? '1' : '0');
		}

		return key;
	}

	function getMatchingStylesheetsKey(sheets) {
		return getStylesheetsKey(sheets, function(currentSheet) {
			return !currentSheet.media || !matchMedia || matchMedia(currentSheet.media).matches;
		});
	}

	//returns an array of properties from a string of inline css
	function propertiesFinder(cssString) {
		cssString = cssString.trim();
		var propValStrings = (cssString.charAt(cssString.length-1) == ';' ? cssString.substring(0, cssString.length - 1) : cssString).split(';');
		var properties = [];

		for(var i = 0, len = propValStrings.length; i < len; i++) {
			properties.push(propValStrings[i].split(':')[0]);
		}

		return properties;
	}

	//adjust on resize
	function resizeHandler() {
		run(true);
	}

	return {
		'init': function(skrollrInst) {
			//start her up
			kickstart(document.querySelectorAll('link, style'), skrollrInst || skrollr.get() || skrollr.init());

			if(window.addEventListener) {
				window.addEventListener('resize', resizeHandler, false);
			}

			else if(window.attachEvent) {
				window.attachEvent('onresize', resizeHandler);
			}
		},

		'getParsedSheets': function() {
			return sheets;
		},

		'getStylesheetsKey': function(ids) {
			if (ids.length === undefined) {
				ids = [ids];
			}

			return getStylesheetsKey(sheets, function(currentSheet) {
				return ids.indexOf(currentSheet.id) !== -1;
			});
		},

		//call if you've changed the keyframes object in the dom for a given stylesheetsKey
		'registerKeyframeChange': function() {
			var matchingStylesheetsKey = getMatchingStylesheetsKey(sheets);

			if(matchingStylesheetsKey === lastMatchingStylesheetsKey) {
				applyKeyframes(matchingStylesheetsKey);
				skrollrInst.refresh();
			}
		}
	};
});
