var globals = require('../globals');
var util = require('../util');
var gui = require('./gui');
var mediaLinks = local.queryLinks(document, 'stdrel.com/media');
var indexLinks = local.queryLinks(document, 'layer1.io/index');

// Environment Setup
// =================
local.logAllExceptions = true;
require('../auth').setup();
require('../http-headers').setup();
require('./feedcfg').setup(indexLinks);

require('./renderers'); // :DEBUG:
require('./feedcfg').addIndex({ href: '#', rel: 'layer1.io/index', title: 'Builtins' }).then(function() {
	gui.setup(mediaLinks);

	require('./feedcfg').addIndex({ href: '#test-index', rel: 'layer1.io/index', title: 'Test' })
		.then(gui.render.bind(gui, null, null));
}).fail(function() {
	console.error('Failed to setup builtins index');
});


local.bindRequestEvents(document);
$(document).on('request', function(e) {
	// dispatch and log
	var req = new local.Request(e.originalEvent.detail);
	if (!req.headers.Accept) { req.Accept('text/html, */*'); }
	req.end(e.originalEvent.detail.body);
	return false;
});

// :TEMP:
local.at('#todo', function(req, res) { alert('Todo'); res.s204().end(); });

// server starting-point
function auth(req, res, worker) {
	// check action id
	req.actid = extractActId(req);
	if (req.actid === false) {
		res.s401('must reuse Authorization header in incoming request for all outgoing requests').end();
		return false;
	}
	// :TODO:
	req.act = null;// executor.get(worker ? worker.getUrl() : true, req.actid); // worker DNE, req came from page so allow
	if (!req.act) {
		res.s403('invalid actid - expired or not assigned to this worker').end();
		return false;
	}
	return true;
}

// toplevel
local.at('#', function (req, res, worker) {
	res.link(
		['href',    'id',      'rel',                          'title'],
		'#',        undefined, 'self service layer1.io/index', 'Host Page',
		'#target',  'target',  'service layer1.io/target',     'Target for Rendering',
		'#feed',    'feed',    'service layer1.io/feed',       'Current Feed',
		'#service', 'service', 'service layer1.io/service',    'Layer1 Toplevel Service'
	);
	res.link(
		['href',           'rel',                'title',       'for'],
		'#thing-renderer', 'layer1.io/renderer', 'Thing',       'schema.org/Thing',
		'#about-renderer', 'layer1.io/renderer', 'About',       'stdrel.com/media',
		'#test-render',    'layer1.io/renderer', 'Test2',       'stdrel.com/media',
		'#hn-renderer',    'layer1.io/renderer', 'HN Renderer', 'stdrel.com/media text/html news.ycombinator.com'
	);
	res.s204().end();
});
// :DEBUG
local.at('#test-index', function (req, res, worker) {
	res.link(
		['href',           'rel',                'title',       'for'],
		'/user/test.js#',  'layer1.io/renderer', 'Test1',       'stdrel.com/media'
	);
	res.s204().end();
});

// public web servers
require('./publicweb.js');

// feed items
local.at('#feed/?(.*)', function (req, res, worker) {
	// :TODO:
	// if (!auth(req, res, worker)) return;
	var itemid = req.pathd[1];

	if (itemid) {
		if (!mediaLinks[itemid]) { return res.s404().end(); }
		var link = local.util.deepClone(mediaLinks[itemid]);
		res.link(
			['href', 'id',      'rel',                       'title'],
			'/',     undefined, 'service via',               'Host Page',
			'/feed', 'feed',    'up service layer1.io/feed', 'Current Feed'
		);
		serveItem(req, res, worker, link);
	}
	else {
		var links = local.util.deepClone(mediaLinks);
		res.link(
			['href', 'id',      'rel',                         'title'],
			'/',     undefined, 'up service via',              'Host Page',
			'/feed', 'feed',    'self service layer1.io/feed', 'Current Feed'
		);
		serveCollection(req, res, worker, links);
	}
});

// service proxy
local.at('#service', function (req, res, worker) {
	if (!auth(req, res, worker)) return;
	// :TODO:
	res.s501().end();
});

// collection behavior
function serveCollection(req, res, worker, links) {
	var uris = {};

	// set headers
	res.link(links);

	// :TODO: check permissions

	// route method
	if (req.HEAD) return res.s204().end();
	if (req.GET)  return res.s204().end(); // :TODO:
	if (req.POST) {
		var post = globals.pageClient
			.POST(req.params)
			.ContentType(req.ContentType)
			.then(function(res2) {
				res.Location(res2.Location);
				res.s201('created').end();
			}, function(res2) { res2.pipe(res); });
		req.pipe(post);
		return;
	}

	res.Allow('HEAD, GET, POST');
	res.s405('bad method').end();
}

// item behavior
function serveItem(req, res, worker, link) {
	// update link references to point to this service
	var url = link.href;
	link.rel = 'self '+link.rel;

	// set headers
	res.link(link);

	// :TODO: check permissions

	// route method
	if (req.HEAD) return res.s204().end();
	if (req.GET) return GET(url, req.params).Accept(req.Accept).pipe(res);
	res.Allow('HEAD, GET');
	res.s405('bad method').end();
}

// helper
function extractActId(req) {
	var auth = req.Authorization;
	if (!auth) return false;

	var parts = auth.split(' ');
	if (parts[0] != 'Action' || !parts[1]) return false;

	return +parts[1] || false;
}