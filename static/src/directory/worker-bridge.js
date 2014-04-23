var executor = require('./executor');
var globals = require('../globals');

module.exports = function(mediaLinks) {
	// toplevel
	function root(req, res, worker) {
		var links = table(
			['href',      'id',        'rel',                         'title'],
			'/',          undefined,   'self service via',            'Host Page',
			'/selection', 'selection', 'service layer1.io/selection', 'Selected Items at Time of Execution',
			'/feed',      'feed',      'service layer1.io/feed',      'Current Feed',
			'/service',   'service',   'service layer1.io/service',   'Layer1 Toplevel Service'
		);

		// Respond
		res.setHeader('Link', links);
		res.writeHead(204).end();
	}

	// selected items
	function selection(req, res, worker) {
		var pathd = req.path.split('/');
		var itemid = pathd[2];
		var convLink = function(uri, i) { return '/selection/'+i; };

		var headerLinks;
		var selLinks = req.exec.getSelectedLinks();

		if (itemid) {
			if (!selLinks[itemid]) { return res.writeHead(404).end(); }
			var link = local.util.deepClone(selLinks[itemid]);
			headerLinks = table(
				['href',      'id',        'rel',                            'title'],
				'/',          undefined,   'via',                            'Host Page',
				'/selection', 'selection', 'up service layer1.io/selection', 'Selected Items at Time of Execution'
			);
			serveItem(req, res, headerLinks, link, { conv: function(uri) { return '/selection/'+itemid; } });
		}
		else {
			var links = local.util.deepClone(selLinks);
			headerLinks = table(
				['href',      'id',        'rel',                              'title'],
				'/',          undefined,   'up service via',                   'Host Page',
				'/selection', 'selection', 'self service layer1.io/selection', 'Selected Items at Time of Execution'
			);
			serveCollection(req, res, headerLinks, links, { noPost: true, conv: convLink });
		}
	}

	// feed items
	function feed(req, res, worker) {
		var pathd = req.path.split('/');
		var itemid = pathd[2];
		var convLink = function(uri) { return '/feed/'+getPathEnd(uri); };

		if (itemid) {
			if (!mediaLinks[itemid]) { return res.writeHead(404).end(); }
			var link = local.util.deepClone(mediaLinks[itemid]);
			headerLinks = table(
				['href', 'id',      'rel',                       'title'],
				'/',     undefined, 'service via',               'Host Page',
				'/feed', 'feed',    'up service layer1.io/feed', 'Current Feed'
			);
			serveItem(req, res, headerLinks, link, { conv: convLink });
		}
		else {
			var links = local.util.deepClone(mediaLinks);
			headerLinks = table(
				['href', 'id',      'rel',                         'title'],
				'/',     undefined, 'up service via',              'Host Page',
				'/feed', 'feed',    'self service layer1.io/feed', 'Current Feed'
			);
			serveCollection(req, res, headerLinks, links, { conv: convLink });
		}
	}

	// service proxy
	function service(req, res, worker) {
		// :TODO:
		res.writeHead(501).end();
	}

	// collection behavior
	function serveCollection(req, res, headerLinks, links, opts) {
		opts = opts || {};
		var uris = {};
		links.forEach(function(link, i) {
			// update link references to point to this service
			uris[i] = link.href;
			link.href = opts.conv(link.href, i);
		});

		// set headers
		res.header('Link', headerLinks.concat(links));

		// :TODO: check permissions

		// route method
		switch (req.method) {
			case 'HEAD': return res.writeHead(204).end();
			case 'GET':  return res.writeHead(204).end(); // :TODO:
			case 'POST':
				if (opts.noPost) {
					res.header('Allow', 'HEAD, GET');
					return res.writeHead(405, 'bad method').end();
				}
				req.on('end', function() {
					globals.pageAgent.POST(req.body, {
						Content_Type: req.header('Content-Type'),
						query: req.query
					}).then(function(res2) {
						res.header('Location', opts.conv(res2.header('Location')));
						res.writeHead(201, 'created').end();
					}, function(res2) {
						res.writeHead(res2.status, res2.reason).end(res2.body);
					});
				});
				break;
			default:
				res.header('Allow', 'HEAD, GET'+((!opts.noPost)?', POST':''));
				res.writeHead(405, 'bad method').end();
		}
	}

	// item behavior
	function serveItem(req, res, headerLinks, link, opts) {
		opts = opts || {};
		// update link references to point to this service
		var uri = link.href;
		link.href = opts.conv(uri);
		link.rel = 'self '+link.rel;

		// set headers
		res.header('Link', headerLinks.concat(link));

		// :TODO: check permissions

		// route method
		switch (req.method) {
			case 'HEAD': return res.writeHead(204).end();
			case 'GET':
				local.GET({
					url: uri,
					Accept: req.header('Accept'),
					query: req.query,
					stream: true
				}).then(function(res2) {
					res.writeHead(200, 'ok', {'Content-Type': res2.header('Content-Type')});
					local.pipe(res, res2);
				}, function(res2) {
					res.writeHead(res2.status, res2.reason);
					local.pipe(res, res2);
				});
				break;
			default:
				res.header('Allow', 'HEAD, GET');
				res.writeHead(405, 'bad method').end();
		}
	}

	// helper
	function getPathEnd(url) {
		var parts = url.split('/');
		return parts[parts.length - 1];
	}

	// helper
	function extractExecId(req) {
		var auth = req.header('Authorization');
		if (!auth) return false;

		var parts = auth.split(' ');
		if (parts[0] != 'Exec' || !parts[1]) return false;

		return +parts[1] || false;
	}

	// server starting-point
	return function(req, res, worker) {
		// check execution id
		req.execid = extractExecId(req);
		if (req.execid === false) {
			return res.writeHead(401, 'must set Authorization header to "Exec <execid>"').end();
		}
		req.exec = executor.get(worker.getUrl(), req.execid);
		if (!req.exec) {
			return res.writeHead(403, 'invalid execid - expired or not assigned to this worker').end();
		}

		// route
		var pathbase = '/'+req.path.split('/')[1];
		switch (pathbase) {
			case '/':          return root(req, res, worker);
			case '/selection': return selection(req, res, worker);
			case '/feed':      return feed(req, res, worker);
			case '/service':   return service(req, res, worker);
			default: res.writeHead(404).end();
		}
	};
};

// helper to make an array of objects
function table(keys) {
	var obj, i, j=-1;
	var arr = [];
	for (i=1, j; i < arguments.length; i++, j++) {
		if (!keys[j]) { if (obj) { arr.push(obj); } obj = {}; j = 0; } // new object
		obj[keys[j]] = arguments[i];
	}
	arr.push(obj); // dont forget the last one
	return arr;
}