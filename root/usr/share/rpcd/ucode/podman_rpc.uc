#!/usr/bin/env ucode

'use strict';

import * as fs from 'fs';
import * as http from 'luci.http';
import * as socket from 'socket';

const CALLER = trim(fs.readfile('/proc/self/comm') || '');

const PODMAN_SOCKET = '/run/podman/podman.sock';
const PROTOCOL = 'HTTP/1.1';
const CLIENT_VER = '1';
const BLOCKSIZE = 8192;
const MAX_HEADER_BYTES = 16384;

const CONTRACT_FLOOR = '5.0.0';
const CONTRACT_MAJOR = 5;
const CONTRACT_PATH_VERSION = '5.0.0';

const MAX_REQUEST_BODY = 262144; // 256 KiB
const MAX_INSPECT_LIST_BODY = 1048576; // 1 MiB
const MAX_LOG_SNAPSHOT_BODY = 262144; // 256 KiB
const MAX_EVENTS_ROWS = 200;

const TIMEOUT_READ = 10000;
const TIMEOUT_MUTATE = 30000;
const TIMEOUT_IMAGE_LONG = 60000;

const ALLOWLIST = {
	'system.ping': {
		module: 'system', action: 'ping', method: 'GET', path: '/libpod/_ping', versioned: false,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 10240
	},
	'system.info': {
		module: 'system', action: 'info', method: 'GET', path: '/libpod/info', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'system.version': {
		module: 'system', action: 'version', method: 'GET', path: '/libpod/version', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'system.df': {
		module: 'system', action: 'df', method: 'GET', path: '/libpod/system/df', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'system.prune': {
		module: 'system', action: 'prune', method: 'POST', path: '/libpod/system/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['all', 'external', 'build']
	},

	'pod.list': {
		module: 'pods', action: 'list', method: 'GET', path: '/libpod/pods/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['all', 'filters']
	},
	'pod.create': {
		module: 'pods', action: 'create', method: 'POST', path: '/libpod/pods/create', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'pod.inspect': {
		module: 'pods', action: 'inspect', method: 'GET', path: '/libpod/pods/{name}/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'pod.exists': {
		module: 'pods', action: 'exists', method: 'GET', path: '/libpod/pods/{name}/exists', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 8192
	},
	'pod.start': {
		module: 'pods', action: 'start', method: 'POST', path: '/libpod/pods/{name}/start', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'pod.stop': {
		module: 'pods', action: 'stop', method: 'POST', path: '/libpod/pods/{name}/stop', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['timeout', 'ignore']
	},
	'pod.restart': {
		module: 'pods', action: 'restart', method: 'POST', path: '/libpod/pods/{name}/restart', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'pod.pause': {
		module: 'pods', action: 'pause', method: 'POST', path: '/libpod/pods/{name}/pause', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'pod.unpause': {
		module: 'pods', action: 'unpause', method: 'POST', path: '/libpod/pods/{name}/unpause', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'pod.kill': {
		module: 'pods', action: 'kill', method: 'POST', path: '/libpod/pods/{name}/kill', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['signal']
	},
	'pod.remove': {
		module: 'pods', action: 'remove', method: 'DELETE', path: '/libpod/pods/{name}', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['force', 'ignore', 'timeout']
	},
	'pod.prune': {
		module: 'pods', action: 'prune', method: 'POST', path: '/libpod/pods/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},

	'container.list': {
		module: 'containers', action: 'list', method: 'GET', path: '/libpod/containers/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['all', 'limit', 'size', 'filters', 'namespace', 'sync']
	},
	'container.create': {
		module: 'containers', action: 'create', method: 'POST', path: '/libpod/containers/create', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['name']
	},
	'container.inspect': {
		module: 'containers', action: 'inspect', method: 'GET', path: '/libpod/containers/{name}/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['size']
	},
	'container.exists': {
		module: 'containers', action: 'exists', method: 'GET', path: '/libpod/containers/{name}/exists', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 8192
	},
	'container.start': {
		module: 'containers', action: 'start', method: 'POST', path: '/libpod/containers/{name}/start', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'container.stop': {
		module: 'containers', action: 'stop', method: 'POST', path: '/libpod/containers/{name}/stop', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['timeout', 'ignore']
	},
	'container.restart': {
		module: 'containers', action: 'restart', method: 'POST', path: '/libpod/containers/{name}/restart', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['t', 'timeout']
	},
	'container.kill': {
		module: 'containers', action: 'kill', method: 'POST', path: '/libpod/containers/{name}/kill', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['signal']
	},
	'container.pause': {
		module: 'containers', action: 'pause', method: 'POST', path: '/libpod/containers/{name}/pause', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'container.unpause': {
		module: 'containers', action: 'unpause', method: 'POST', path: '/libpod/containers/{name}/unpause', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'container.remove': {
		module: 'containers', action: 'remove', method: 'DELETE', path: '/libpod/containers/{name}', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['force', 'v', 'depend', 'ignore']
	},
	'container.logs': {
		module: 'containers', action: 'logs', method: 'GET', path: '/libpod/containers/{name}/logs', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_LOG_SNAPSHOT_BODY,
		queryKeys: ['stdout', 'stderr', 'since', 'until', 'timestamps', 'tail', 'follow']
	},
	'container.prune': {
		module: 'containers', action: 'prune', method: 'POST', path: '/libpod/containers/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},

	'image.list': {
		module: 'images', action: 'list', method: 'GET', path: '/libpod/images/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['all', 'filters']
	},
	'image.search': {
		module: 'images', action: 'search', method: 'GET', path: '/libpod/images/search', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY,
		queryKeys: ['term', 'limit', 'filters', 'tlsVerify', 'listTags']
	},
	'image.inspect': {
		module: 'images', action: 'inspect', method: 'GET', path: '/libpod/images/{name}/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'image.exists': {
		module: 'images', action: 'exists', method: 'GET', path: '/libpod/images/{name}/exists', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 8192
	},
	'image.pull': {
		module: 'images', action: 'pull', method: 'POST', path: '/libpod/images/pull', versioned: true,
		mutating: true, timeout: TIMEOUT_IMAGE_LONG, maxResponseBytes: MAX_INSPECT_LIST_BODY,
		queryKeys: ['reference', 'quiet', 'compatMode', 'allTags', 'arch', 'os', 'variant', 'policy', 'tlsVerify', 'username', 'password', 'identitytoken']
	},
	'image.remove': {
		module: 'images', action: 'remove', method: 'DELETE', path: '/libpod/images/{name}', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['force', 'ignore']
	},
	'image.prune': {
		module: 'images', action: 'prune', method: 'POST', path: '/libpod/images/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_IMAGE_LONG, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['all', 'buildcache', 'external']
	},
	'image.tag': {
		module: 'images', action: 'tag', method: 'POST', path: '/libpod/images/{name}/tag', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['repo', 'tag']
	},
	'image.untag': {
		module: 'images', action: 'untag', method: 'POST', path: '/libpod/images/{name}/untag', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['repo', 'tag']
	},

	'network.list': {
		module: 'networks', action: 'list', method: 'GET', path: '/libpod/networks/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['filters']
	},
	'network.create': {
		module: 'networks', action: 'create', method: 'POST', path: '/libpod/networks/create', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'network.inspect': {
		module: 'networks', action: 'inspect', method: 'GET', path: '/libpod/networks/{name}/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'network.exists': {
		module: 'networks', action: 'exists', method: 'GET', path: '/libpod/networks/{name}/exists', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 8192
	},
	'network.connect': {
		module: 'networks', action: 'connect', method: 'POST', path: '/libpod/networks/{name}/connect', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536
	},
	'network.disconnect': {
		module: 'networks', action: 'disconnect', method: 'POST', path: '/libpod/networks/{name}/disconnect', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: 65536, queryKeys: ['force']
	},
	'network.remove': {
		module: 'networks', action: 'remove', method: 'DELETE', path: '/libpod/networks/{name}', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'network.prune': {
		module: 'networks', action: 'prune', method: 'POST', path: '/libpod/networks/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},

	'volume.list': {
		module: 'volumes', action: 'list', method: 'GET', path: '/libpod/volumes/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['filters']
	},
	'volume.create': {
		module: 'volumes', action: 'create', method: 'POST', path: '/libpod/volumes/create', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'volume.inspect': {
		module: 'volumes', action: 'inspect', method: 'GET', path: '/libpod/volumes/{name}/json', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},
	'volume.exists': {
		module: 'volumes', action: 'exists', method: 'GET', path: '/libpod/volumes/{name}/exists', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: 8192
	},
	'volume.remove': {
		module: 'volumes', action: 'remove', method: 'DELETE', path: '/libpod/volumes/{name}', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY, queryKeys: ['force']
	},
	'volume.prune': {
		module: 'volumes', action: 'prune', method: 'POST', path: '/libpod/volumes/prune', versioned: true,
		mutating: true, timeout: TIMEOUT_MUTATE, maxResponseBytes: MAX_INSPECT_LIST_BODY
	},

	'events.snapshot': {
		module: 'events', action: 'snapshot', method: 'GET', path: '/libpod/events', versioned: true,
		mutating: false, timeout: TIMEOUT_READ, maxResponseBytes: MAX_INSPECT_LIST_BODY,
		queryKeys: ['since', 'until', 'filters', 'stream']
	}
};

let capabilityCache = null;
let capabilityCacheTs = 0;

function now_epoch() {
	return int(time());
}

function shell_quote(v) {
	v = `${v}`;
	v = replace(v, /'/g, "'\\''");
	return `'${v}'`;
}

function contains(list, needle) {
	for (let item in list)
		if (item == needle)
			return true;
	return false;
}

function coerce_values_to_string(obj) {
	let out = {};
	for (let k, v in obj)
		out[k] = `${v}`;
	return out;
}

function parse_http_headers(h) {
	let headers = {};
	for (let line in split(h, /\r?\n/)) {
		let kv = match(line, /^([^:]+):\s*(.*)$/);
		if (kv && length(kv) > 2)
			headers[lc(kv[1])] = kv[2];
	}
	return headers;
}

function read_first_response_chunk(sock, timeoutMs) {
	let buf = '';

	while (index(buf, '\r\n\r\n') < 0) {
		if (length(buf) > MAX_HEADER_BYTES)
			return { err: 'HTTP header too large' };

		let ready = socket.poll(timeoutMs, [sock, socket.POLLIN]);
		if (!ready || !length(ready))
			return { err: 'Read timeout while waiting for response headers' };

		let data = sock.recv(BLOCKSIZE);
		if (!data)
			return { err: 'Connection closed before response headers' };

		buf += data;
	}

	let parts = split(buf, /\r?\n\r?\n/, 2);
	let head = parts[0] || '';
	let body = parts[1] || '';
	let statusLine = split(head, /\r?\n/)[0] || '';
	let statusMatch = match(statusLine, /HTTP\/\S+\s+(\d+)/);

	return {
		code: statusMatch ? int(statusMatch[1]) : 0,
		headers: parse_http_headers(head),
		initialBody: body
	};
}

function chunked_body_reader(sock, initial, timeoutMs) {
	let state = 0;
	let chunklen = 0;
	let buffer = initial || '';

	function poll_and_recv() {
		let ready = socket.poll(timeoutMs, [sock, socket.POLLIN]);
		if (!ready || !length(ready))
			return null;
		let data = sock.recv(BLOCKSIZE);
		if (!data)
			return null;
		buffer += data;
		return true;
	}

	return () => {
		while (true) {
			if (state == 0) {
				let m = match(buffer, /^([0-9a-fA-F]+)\r\n/);
				if (!m || length(m) < 2) {
					if (!poll_and_recv())
						return null;
					continue;
				}
				chunklen = int(m[1], 16);
				buffer = substr(buffer, length(m[0]));
				if (chunklen == 0)
					return null;
				state = 1;
			}

			if (state == 1 && length(buffer) >= chunklen + 2) {
				let chunk = substr(buffer, 0, chunklen);
				buffer = substr(buffer, chunklen + 2);
				state = 0;
				return chunk;
			}

			if (!poll_and_recv())
				return null;
		}
	};
}

function read_body_limited(sock, head, timeoutMs, maxBytes) {
	let headers = head.headers || {};
	let chunks = [];
	let total = 0;

	function push_chunk(chunk) {
		if (!chunk)
			return true;
		total += length(chunk);
		if (total > maxBytes)
			return false;
		push(chunks, chunk);
		return true;
	}

	if (!push_chunk(head.initialBody || ''))
		return { err: 'Response exceeded configured body limit' };

	if (headers['transfer-encoding'] == 'chunked') {
		let next = chunked_body_reader(sock, '', timeoutMs);
		let c;
		while ((c = next())) {
			if (!push_chunk(c))
				return { err: 'Response exceeded configured body limit' };
		}
		return { body: join('', chunks) };
	}

	if (headers['content-length']) {
		let expected = int(headers['content-length']);
		if (expected > maxBytes)
			return { err: 'Response exceeded configured body limit' };

		let remaining = expected - length(head.initialBody || '');
		while (remaining > 0) {
			let ready = socket.poll(timeoutMs, [sock, socket.POLLIN]);
			if (!ready || !length(ready))
				return { err: 'Read timeout while receiving response body' };

			let data = sock.recv(min(BLOCKSIZE, remaining));
			if (!data)
				break;
			if (!push_chunk(data))
				return { err: 'Response exceeded configured body limit' };
			remaining -= length(data);
		}
		return { body: join('', chunks) };
	}

	while (true) {
		let ready = socket.poll(timeoutMs, [sock, socket.POLLIN]);
		if (!ready || !length(ready))
			break;
		let data = sock.recv(BLOCKSIZE);
		if (!data)
			break;
		if (!push_chunk(data))
			return { err: 'Response exceeded configured body limit' };
	}

	return { body: join('', chunks) };
}

function parse_json_or_text(contentType, body) {
	if (!body)
		return null;

	if (index(lc(contentType || ''), 'application/json') >= 0) {
		try {
			return json(trim(body));
		}
		catch (e) {
			let lines = split(trim(body), /\n/);
			let events = [];
			for (let l in lines) {
				if (!trim(l))
					continue;
				try { push(events, json(trim(l))); } catch (e2) {}
			}
			if (length(events))
				return events;
		}
	}

	return body;
}

function normalized_error(status, code, message, details) {
	return {
		status: status,
		code: code,
		message: message,
		details: redact_payload(details || {})
	};
}

function parse_version(v) {
	let s = `${v || ''}`;
	let m = match(s, /(\d+)\.(\d+)\.(\d+)/);
	if (!m || length(m) < 4)
		return null;

	return {
		major: int(m[1]),
		minor: int(m[2]),
		patch: int(m[3]),
		text: `${m[1]}.${m[2]}.${m[3]}`
	};
}

function redact_key(k) {
	let key = lc(`${k}`);
	return match(key, /(pass|secret|token|auth|credential|identity|x-registry-auth|env)/) != null;
}

function redact_payload(value, depth) {
	depth = depth || 0;
	if (depth > 8)
		return '[truncated]';

	if (type(value) == 'array') {
		let out = [];
		for (let item in value)
			push(out, redact_payload(item, depth + 1));
		return out;
	}

	if (type(value) == 'object') {
		let out = {};
		for (let k, v in value)
			out[k] = redact_key(k) ? '[redacted]' : redact_payload(v, depth + 1);
		return out;
	}

	if (type(value) == 'string' && match(lc(value), /(bearer\s+|password=|token=|secret=)/))
		return '[redacted]';

	return value;
}

function extract_target(args) {
	if (!args)
		return '-';
	if (args.name)
		return `${args.name}`;
	if (args.id)
		return `${args.id}`;
	if (args.query && args.query.reference)
		return `${args.query.reference}`;
	return '-';
}

function audit_log(request, route, result, errorCode, details) {
	if (!route.mutating)
		return;

	let actor = request?.session || request?.sid || request?.ubus_rpc_session || request?.user || 'unknown';
	let entry = {
		actor: `${actor}`,
		session: `${request?.ubus_rpc_session || request?.sid || '-'}`,
		module: route.module,
		action: route.action,
		target: extract_target(request?.args),
		result: result,
		error_code: errorCode || '',
		timestamp: now_epoch(),
		details: redact_payload(details || {})
	};

	let line = sprintf('%J', entry);
	system(`logger -t luci-app-podman-rpc ${shell_quote(line)}`);
}

function sanitize_name(name) {
	let n = `${name || ''}`;
	if (!n)
		return null;
	if (!match(n, /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/))
		return null;
	return n;
}

function sanitize_query(route, query) {
	if (!query)
		return null;

	let out = {};
	let allowed = route.queryKeys || [];
	for (let k, v in query) {
		if (contains(allowed, k))
			out[k] = v;
	}

	if (route.module == 'events') {
		out.stream = false;
	}

	if (route.action == 'logs') {
		out.follow = false;
	}

	return out;
}

function build_route_path(route, args, capability) {
	let path = route.path;

	if (index(path, '{name}') >= 0) {
		let name = sanitize_name(args?.name);
		if (!name)
			return null;
		path = replace(path, /\{name\}/g, name);
	}

	if (route.versioned)
		return `/${capability.apiPathVersion}${path}`;

	return path;
}

function podman_http_call(route, req, capability) {
	let sock = socket.create(socket.AF_UNIX, socket.SOCK_STREAM);
	if (!sock)
		return { err: normalized_error('error', 'SOCKET_CREATE_FAILED', 'Failed to create Unix socket', { socket: PODMAN_SOCKET }) };

	if (!sock.connect({ family: socket.AF_UNIX, path: PODMAN_SOCKET })) {
		sock.close();
		return { err: normalized_error('error', 'SOCKET_CONNECT_FAILED', 'Failed to connect to Podman Unix socket', { socket: PODMAN_SOCKET }) };
	}

	let query = sanitize_query(route, req?.args?.query);
	let payload = req?.args?.body || null;
	let path = build_route_path(route, req?.args, capability);

	if (!path) {
		sock.close();
		return { err: normalized_error('error', 'INVALID_TARGET', 'Invalid target identifier', { target: req?.args?.name }) };
	}

	let reqHeaders = [
		`${route.method} ${path}${query ? http.build_querystring(coerce_values_to_string(query)) : ''} ${PROTOCOL}`,
		'Host: localhost',
		`User-Agent: luci-app-podman-rpc-ucode/${CLIENT_VER}`,
		'Connection: close'
	];

	if (payload != null) {
		if (type(payload) == 'object')
			payload = sprintf('%J', payload);
		payload = `${payload}`;
		if (length(payload) > MAX_REQUEST_BODY) {
			sock.close();
			return { err: normalized_error('error', 'REQUEST_TOO_LARGE', 'Request payload exceeds configured limit', { maxBytes: MAX_REQUEST_BODY }) };
		}
		push(reqHeaders, 'Content-Type: application/json');
		push(reqHeaders, `Content-Length: ${length(payload)}`);
	}

	push(reqHeaders, '', '');

	if (!sock.send(join('\r\n', reqHeaders))) {
		sock.close();
		return { err: normalized_error('error', 'REQUEST_SEND_FAILED', 'Failed to send request headers to Podman socket', { path: path }) };
	}

	if (payload != null && !sock.send(payload)) {
		sock.close();
		return { err: normalized_error('error', 'REQUEST_SEND_FAILED', 'Failed to send request payload to Podman socket', { path: path }) };
	}

	let head = read_first_response_chunk(sock, route.timeout);
	if (head.err) {
		sock.close();
		return { err: normalized_error('timeout', 'RESPONSE_HEADER_TIMEOUT', head.err, { timeoutMs: route.timeout }) };
	}

	let bodyRead = read_body_limited(sock, head, route.timeout, route.maxResponseBytes);
	sock.close();

	if (bodyRead.err)
		return { err: normalized_error('error', 'RESPONSE_LIMIT', bodyRead.err, { maxBytes: route.maxResponseBytes }) };

	let parsed = parse_json_or_text(head.headers['content-type'], bodyRead.body || '');

	return {
		code: head.code,
		headers: head.headers,
		body: parsed
	};
}

function normalize_upstream_error(resp, route) {
	let details = {
		http: resp?.code || 0,
		module: route.module,
		action: route.action
	};

	if (type(resp?.body) == 'object') {
		details.upstream = redact_payload(resp.body);
	}
	else if (resp?.body) {
		details.upstream = redact_payload({ body: resp.body });
	}

	let code = 'UPSTREAM_ERROR';
	if (resp?.code == 404)
		code = 'NOT_FOUND';
	else if (resp?.code == 409)
		code = 'CONFLICT';
	else if (resp?.code == 501)
		code = 'NOT_IMPLEMENTED';

	return normalized_error('error', code, `Podman API request failed (${resp?.code || 0})`, details);
}

function compute_capability() {
	let pingRoute = ALLOWLIST['system.ping'];
	let pingResp = podman_http_call(pingRoute, { args: {} }, { apiPathVersion: CONTRACT_PATH_VERSION });
	if (pingResp.err) {
		return {
			ok: false,
			healthy: false,
			supported: false,
			drift: 'unknown',
			apiPathVersion: CONTRACT_PATH_VERSION,
			error: pingResp.err
		};
	}

	let infoResp = podman_http_call(ALLOWLIST['system.info'], { args: {} }, { apiPathVersion: CONTRACT_PATH_VERSION });
	let versionResp = podman_http_call(ALLOWLIST['system.version'], { args: {} }, { apiPathVersion: CONTRACT_PATH_VERSION });

	let headerVersion = pingResp.headers['libpod-api-version'] || '';
	let bodyVersion = versionResp?.body?.Version || versionResp?.body?.version || versionResp?.body?.ApiVersion || '';
	let parsed = parse_version(headerVersion) || parse_version(bodyVersion);

	let drift = 'none';
	let supported = false;
	let pathVersion = CONTRACT_PATH_VERSION;

	if (parsed) {
		if (parsed.major < CONTRACT_MAJOR) {
			drift = 'unsupported';
			supported = false;
		}
		else if (parsed.major > CONTRACT_MAJOR) {
			drift = 'forward';
			supported = true;
			pathVersion = CONTRACT_PATH_VERSION;
		}
		else {
			drift = 'none';
			supported = true;
			pathVersion = parsed.text;
		}
	}

	return {
		ok: true,
		healthy: pingResp.code >= 200 && pingResp.code < 300,
		supported: supported,
		drift: drift,
		libpodApiVersion: parsed?.text || headerVersion || '',
		apiPathVersion: pathVersion,
		floor: CONTRACT_FLOOR,
		engine: 'podman',
		socket: PODMAN_SOCKET,
		info: type(infoResp?.body) == 'object' ? infoResp.body : null,
		version: type(versionResp?.body) == 'object' ? versionResp.body : null
	};
}

function get_capability(forceRefresh) {
	let t = now_epoch();
	if (!forceRefresh && capabilityCache && (t - capabilityCacheTs) <= 5)
		return capabilityCache;

	capabilityCache = compute_capability();
	capabilityCacheTs = t;
	return capabilityCache;
}

function normalize_success(route, resp, capability) {
	let body = resp.body;
	let meta = {
		maxResponseBytes: route.maxResponseBytes
	};

	if (route.module == 'events') {
		if (type(body) != 'array')
			body = [];
		meta.rowsBeforeTrim = length(body);
		if (length(body) > MAX_EVENTS_ROWS) {
			body = slice(body, length(body) - MAX_EVENTS_ROWS);
			meta.rowsTrimmed = true;
		}
		meta.rowsReturned = length(body);
	}

	if (route.action == 'logs' && type(body) == 'string')
		meta.bodyChars = length(body);

	return {
		status: 'ok',
		module: route.module,
		action: route.action,
		http: resp.code,
		capability: {
			healthy: capability.healthy,
			supported: capability.supported,
			drift: capability.drift,
			libpodApiVersion: capability.libpodApiVersion,
			apiPathVersion: capability.apiPathVersion
		},
		meta: meta,
		data: body
	};
}

function invoke_route(key, request) {
	let route = ALLOWLIST[key];
	if (!route)
		return normalized_error('denied', 'ALLOWLIST_DENIED', 'Requested action is not in the Podman MVP allowlist', { action: key });

	let capability = get_capability(false);
	if (route.mutating && !capability.supported) {
		let err = normalized_error('unsupported', 'UNSUPPORTED_PLATFORM_OR_VERSION', 'Mutating actions are disabled on unsupported Podman/Libpod versions', {
			floor: CONTRACT_FLOOR,
			libpodApiVersion: capability.libpodApiVersion,
			drift: capability.drift
		});
		audit_log(request, route, 'denied', err.code, err.details);
		return err;
	}

	let resp = podman_http_call(route, request || {}, capability);
	if (resp.err) {
		audit_log(request, route, 'error', resp.err.code, resp.err.details);
		return resp.err;
	}

	if (resp.code < 200 || resp.code >= 300) {
		let err = normalize_upstream_error(resp, route);
		audit_log(request, route, 'error', err.code, err.details);
		return err;
	}

	let ok = normalize_success(route, resp, capability);
		audit_log(request, route, 'ok', '', { http: resp.code });
	return ok;
}

const system_methods = {
	probe: { call: (req) => {
		let cap = get_capability(req?.args?.refresh == true);
		if (!cap.ok)
			return cap.error;
		return {
			status: 'ok',
			data: {
				engine: cap.engine,
				socket: cap.socket,
				healthy: cap.healthy,
				supported: cap.supported,
				drift: cap.drift,
				floor: cap.floor,
				libpodApiVersion: cap.libpodApiVersion,
				apiPathVersion: cap.apiPathVersion,
				capabilities: {
					system: true,
					pods: true,
					containers: true,
					images: true,
					networks: true,
					volumes: true,
					events: true,
					mutatingEnabled: cap.supported
				}
			}
		};
	}},
	ping: { call: (req) => invoke_route('system.ping', req) },
	info: { call: (req) => invoke_route('system.info', req) },
	version: { call: (req) => invoke_route('system.version', req) },
	df: { call: (req) => invoke_route('system.df', req) },
	prune: { call: (req) => invoke_route('system.prune', req) }
};

const pod_methods = {
	list: { call: (req) => invoke_route('pod.list', req) },
	create: { call: (req) => invoke_route('pod.create', req) },
	inspect: { args: { name: '' }, call: (req) => invoke_route('pod.inspect', req) },
	exists: { args: { name: '' }, call: (req) => invoke_route('pod.exists', req) },
	start: { args: { name: '' }, call: (req) => invoke_route('pod.start', req) },
	stop: { args: { name: '', query: {} }, call: (req) => invoke_route('pod.stop', req) },
	restart: { args: { name: '' }, call: (req) => invoke_route('pod.restart', req) },
	pause: { args: { name: '' }, call: (req) => invoke_route('pod.pause', req) },
	unpause: { args: { name: '' }, call: (req) => invoke_route('pod.unpause', req) },
	kill: { args: { name: '', query: {} }, call: (req) => invoke_route('pod.kill', req) },
	remove: { args: { name: '', query: {} }, call: (req) => invoke_route('pod.remove', req) },
	prune: { call: (req) => invoke_route('pod.prune', req) }
};

const container_methods = {
	list: { call: (req) => invoke_route('container.list', req) },
	create: { call: (req) => invoke_route('container.create', req) },
	inspect: { args: { name: '' }, call: (req) => invoke_route('container.inspect', req) },
	exists: { args: { name: '' }, call: (req) => invoke_route('container.exists', req) },
	start: { args: { name: '' }, call: (req) => invoke_route('container.start', req) },
	stop: { args: { name: '', query: {} }, call: (req) => invoke_route('container.stop', req) },
	restart: { args: { name: '', query: {} }, call: (req) => invoke_route('container.restart', req) },
	kill: { args: { name: '', query: {} }, call: (req) => invoke_route('container.kill', req) },
	pause: { args: { name: '' }, call: (req) => invoke_route('container.pause', req) },
	unpause: { args: { name: '' }, call: (req) => invoke_route('container.unpause', req) },
	remove: { args: { name: '', query: {} }, call: (req) => invoke_route('container.remove', req) },
	logs: { args: { name: '', query: {} }, call: (req) => invoke_route('container.logs', req) },
	prune: { call: (req) => invoke_route('container.prune', req) }
};

const image_methods = {
	list: { call: (req) => invoke_route('image.list', req) },
	search: { args: { query: {} }, call: (req) => invoke_route('image.search', req) },
	inspect: { args: { name: '' }, call: (req) => invoke_route('image.inspect', req) },
	exists: { args: { name: '' }, call: (req) => invoke_route('image.exists', req) },
	pull: { args: { query: {} }, call: (req) => invoke_route('image.pull', req) },
	remove: { args: { name: '', query: {} }, call: (req) => invoke_route('image.remove', req) },
	prune: { args: { query: {} }, call: (req) => invoke_route('image.prune', req) },
	tag: { args: { name: '', query: {} }, call: (req) => invoke_route('image.tag', req) },
	untag: { args: { name: '', query: {} }, call: (req) => invoke_route('image.untag', req) }
};

const network_methods = {
	list: { call: (req) => invoke_route('network.list', req) },
	create: { call: (req) => invoke_route('network.create', req) },
	inspect: { args: { name: '' }, call: (req) => invoke_route('network.inspect', req) },
	exists: { args: { name: '' }, call: (req) => invoke_route('network.exists', req) },
	connect: { args: { name: '', body: {} }, call: (req) => invoke_route('network.connect', req) },
	disconnect: { args: { name: '', body: {}, query: {} }, call: (req) => invoke_route('network.disconnect', req) },
	remove: { args: { name: '' }, call: (req) => invoke_route('network.remove', req) },
	prune: { call: (req) => invoke_route('network.prune', req) }
};

const volume_methods = {
	list: { call: (req) => invoke_route('volume.list', req) },
	create: { call: (req) => invoke_route('volume.create', req) },
	inspect: { args: { name: '' }, call: (req) => invoke_route('volume.inspect', req) },
	exists: { args: { name: '' }, call: (req) => invoke_route('volume.exists', req) },
	remove: { args: { name: '', query: {} }, call: (req) => invoke_route('volume.remove', req) },
	prune: { call: (req) => invoke_route('volume.prune', req) }
};

const events_methods = {
	snapshot: {
		args: { query: { stream: false } },
		call: (req) => invoke_route('events.snapshot', req)
	}
};

const methods = {
	'podman': system_methods,
	'podman.system': system_methods,
	'podman.pod': pod_methods,
	'podman.container': container_methods,
	'podman.image': image_methods,
	'podman.network': network_methods,
	'podman.volume': volume_methods,
	'podman.events': events_methods
};

if (CALLER != 'rpcd') {
	print('podman_rpc.uc is intended for rpcd ubus usage\n');
}

return methods;
