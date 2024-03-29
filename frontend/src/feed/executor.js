module.exports = {
	setup: setup,
	get: getAction,
	dispatch: dispatch
};

// Actions Executor
// ================
var _actions = {};
var _mediaLinks; // links to items in the feed

// EXPORTED
function setup(mediaLinks) {
	_mediaLinks = mediaLinks;
}

// EXPORTED
// action lookup, validates against domain
function getAction(domain, id) {
	var act = _actions[id];
	if (act && (act.domain === domain || domain === true))
		return act;
}

// EXPORTED
// start an action with the given request
// - req: obj, the request
// - rendererLink: obj, the link to the renderer
// - $view: jquery element, the view element
function dispatch(req, rendererLink, $view) {
	var reqUrld      = local.parseUri(req.url);
	var reqDomain    = reqUrld.protocol + '://' + reqUrld.authority;
	var rendererUrld   = local.parseUri(rendererLink.href);
	var rendererDomain = rendererUrld.protocol + '://' + rendererUrld.authority;

	// audit request
	// :TODO:

	// allocate execution and gui space
	var actid = allocId();
	var act = createAction(actid, rendererDomain, rendererLink, $view);

	// prep request
	var body = req.body;
	delete req.body;
	req = new local.Request(req);

	if (!req.headers.Accept) { req.Accept('text/html, */*'); }
	req.Authorization('Action '+actid); // attach actid

	if (!local.isAbsUri(req.headers.url)) {
		req.headers.url = local.joinUri(rendererDomain, req.headers.url);
	}

	// dispatch
	req.end(body).always(handleActRes(actid));
	act.req = req;
	return act;
}

// produces callback to handle the response of an action
function handleActRes(actid) {
	return function(res) {
		var act = _actions[actid];
		if (!act) { return console.error('Action not in masterlist when handling response', actid, res); }

		if (res.ContentType == 'text/event-stream') {
			// stream update events into the GUI
			streamGui(res, act);
		} else {
			// output final response to GUI
			res.buffer(function() {
				var gui = res.body;
				if (!gui) {
					var reason;
					if (res.reason) { reason = res.reason; }
					else if (res.status >= 200 && res.status < 400) { reason = 'success'; }
					else if (res.status >= 400 && res.status < 500) { reason = 'bad request'; }
					else if (res.status >= 500 && res.status < 600) { reason = 'error'; }
					gui = reason + ' <small>'+res.status+'</small>';
				}
				act.setGui(gui);
			});
		}

		// end on response close
		res.on('close', act.stop.bind(act));
	};
}

// allocate unused id
function allocId() {
	var actid;
	do {
		actid = Math.round(Math.random()*1000000000); // :TODO: pretty weak PNRG, is that a problem?
	} while(actid in _actions);
	return actid;
}

// create action base-structure, store in masterlist
function createAction(actid, domain, meta, $view) {
	_actions[actid] = {
		meta: meta,
		domain: domain,
		id: actid,
		$view: $view,
		targetLinks: null,
		req: null,

		stop: stopAction,
		setGui: setActionGui,
		getTargetLinks: getActionTargetLinks
	};
	return _actions[actid];
}

// helper to get the items selected currently
function captureSelection() {
	var $selected = $('.directory-links-list > .selected');
	var arr = [];
	for (var i=0; i < $selected.length; i++) {
		arr.push(parseInt($selected[i].id.slice(5), 10)); // skip 'slot-' to extract id
	}
	return arr;
}

// helper to update an action's gui using an event-stream
function streamGui(res, act) {
	var buffer = '', eventDelimIndex;
	res.on('data', function(chunk) {
		chunk = buffer + chunk;
		// Step through each event, as its been given
		while ((eventDelimIndex = chunk.indexOf('\r\n\r\n')) !== -1) {
			var e = chunk.slice(0, eventDelimIndex);
			e = local.contentTypes.deserialize('text/event-stream', e);
			if (e.event == 'update') {
				act.setGui(e.data);
			}
			chunk = chunk.slice(eventDelimIndex+4);
		}
		buffer = chunk;
		res.body = '';
	});
}


// Action-object Methods
// =====================

// closes request, removes self from masterlist
function stopAction() {
	if (this.id in _actions) {
		this.req.close();
		delete _actions[this.id];
	}
}

// updates self's gui
function setActionGui(doc) {
	var html = (doc && typeof doc == 'object') ? JSON.stringify(doc) : (''+doc);
	if (html && this.$view)
		this.$view.html(html);
}

// helper gives a list of links for the selected items captured on the execution
function getActionTargetLinks() {
	return this.targetLinks;
}

// :TODO: ?
// // handle titlebar close button click
// function onActionGuiClose(e) {
// 	this.end();
// }