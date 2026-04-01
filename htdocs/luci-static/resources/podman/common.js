'use strict';
'require rpc';
'require ui';

const basePath = 'admin/services/podman';

const system_probe = rpc.declare({
	object: 'podman.system',
	method: 'probe',
	params: { refresh: false }
});

const system_ping = rpc.declare({ object: 'podman.system', method: 'ping' });
const system_info = rpc.declare({ object: 'podman.system', method: 'info' });
const system_version = rpc.declare({ object: 'podman.system', method: 'version' });
const system_df = rpc.declare({ object: 'podman.system', method: 'df' });
const system_prune = rpc.declare({
	object: 'podman.system',
	method: 'prune',
	params: { query: {} }
});

const pod_list = rpc.declare({ object: 'podman.pod', method: 'list', params: { query: {} } });
const pod_create = rpc.declare({ object: 'podman.pod', method: 'create', params: { body: {} } });
const pod_inspect = rpc.declare({ object: 'podman.pod', method: 'inspect', params: { name: '' } });
const pod_exists = rpc.declare({ object: 'podman.pod', method: 'exists', params: { name: '' } });
const pod_start = rpc.declare({ object: 'podman.pod', method: 'start', params: { name: '' } });
const pod_stop = rpc.declare({ object: 'podman.pod', method: 'stop', params: { name: '', query: {} } });
const pod_restart = rpc.declare({ object: 'podman.pod', method: 'restart', params: { name: '' } });
const pod_pause = rpc.declare({ object: 'podman.pod', method: 'pause', params: { name: '' } });
const pod_unpause = rpc.declare({ object: 'podman.pod', method: 'unpause', params: { name: '' } });
const pod_kill = rpc.declare({ object: 'podman.pod', method: 'kill', params: { name: '', query: {} } });
const pod_remove = rpc.declare({ object: 'podman.pod', method: 'remove', params: { name: '', query: {} } });
const pod_prune = rpc.declare({ object: 'podman.pod', method: 'prune' });

const container_list = rpc.declare({ object: 'podman.container', method: 'list', params: { query: {} } });
const container_create = rpc.declare({ object: 'podman.container', method: 'create', params: { body: {}, query: {} } });
const container_inspect = rpc.declare({ object: 'podman.container', method: 'inspect', params: { name: '', query: {} } });
const container_exists = rpc.declare({ object: 'podman.container', method: 'exists', params: { name: '' } });
const container_start = rpc.declare({ object: 'podman.container', method: 'start', params: { name: '' } });
const container_stop = rpc.declare({ object: 'podman.container', method: 'stop', params: { name: '', query: {} } });
const container_restart = rpc.declare({ object: 'podman.container', method: 'restart', params: { name: '', query: {} } });
const container_kill = rpc.declare({ object: 'podman.container', method: 'kill', params: { name: '', query: {} } });
const container_pause = rpc.declare({ object: 'podman.container', method: 'pause', params: { name: '' } });
const container_unpause = rpc.declare({ object: 'podman.container', method: 'unpause', params: { name: '' } });
const container_remove = rpc.declare({ object: 'podman.container', method: 'remove', params: { name: '', query: {} } });
const container_logs = rpc.declare({ object: 'podman.container', method: 'logs', params: { name: '', query: {} } });
const container_prune = rpc.declare({ object: 'podman.container', method: 'prune' });

const image_list = rpc.declare({ object: 'podman.image', method: 'list', params: { query: {} } });
const image_search = rpc.declare({ object: 'podman.image', method: 'search', params: { query: {} } });
const image_inspect = rpc.declare({ object: 'podman.image', method: 'inspect', params: { name: '' } });
const image_exists = rpc.declare({ object: 'podman.image', method: 'exists', params: { name: '' } });
const image_pull = rpc.declare({ object: 'podman.image', method: 'pull', params: { query: {} } });
const image_remove = rpc.declare({ object: 'podman.image', method: 'remove', params: { name: '', query: {} } });
const image_prune = rpc.declare({ object: 'podman.image', method: 'prune', params: { query: {} } });
const image_tag = rpc.declare({ object: 'podman.image', method: 'tag', params: { name: '', query: {} } });
const image_untag = rpc.declare({ object: 'podman.image', method: 'untag', params: { name: '', query: {} } });

const network_list = rpc.declare({ object: 'podman.network', method: 'list', params: { query: {} } });
const network_create = rpc.declare({ object: 'podman.network', method: 'create', params: { body: {} } });
const network_inspect = rpc.declare({ object: 'podman.network', method: 'inspect', params: { name: '' } });
const network_exists = rpc.declare({ object: 'podman.network', method: 'exists', params: { name: '' } });
const network_connect = rpc.declare({ object: 'podman.network', method: 'connect', params: { name: '', body: {} } });
const network_disconnect = rpc.declare({ object: 'podman.network', method: 'disconnect', params: { name: '', body: {}, query: {} } });
const network_remove = rpc.declare({ object: 'podman.network', method: 'remove', params: { name: '' } });
const network_prune = rpc.declare({ object: 'podman.network', method: 'prune' });

const volume_list = rpc.declare({ object: 'podman.volume', method: 'list', params: { query: {} } });
const volume_create = rpc.declare({ object: 'podman.volume', method: 'create', params: { body: {} } });
const volume_inspect = rpc.declare({ object: 'podman.volume', method: 'inspect', params: { name: '' } });
const volume_exists = rpc.declare({ object: 'podman.volume', method: 'exists', params: { name: '' } });
const volume_remove = rpc.declare({ object: 'podman.volume', method: 'remove', params: { name: '', query: {} } });
const volume_prune = rpc.declare({ object: 'podman.volume', method: 'prune' });

const events_snapshot = rpc.declare({ object: 'podman.events', method: 'snapshot', params: { query: { stream: false } } });

const STATUS_BADGES = Object.freeze({
	running: { label: _('Running'), tone: 'success', className: 'podman-status--running' },
	paused: { label: _('Paused'), tone: 'warning', className: 'podman-status--paused' },
	restarting: { label: _('Restarting'), tone: 'warning', className: 'podman-status--restarting' },
	stopped: { label: _('Stopped'), tone: 'inactive', className: 'podman-status--stopped' },
	created: { label: _('Created'), tone: 'info', className: 'podman-status--created' },
	exited: { label: _('Exited'), tone: 'inactive', className: 'podman-status--exited' },
	error: { label: _('Error'), tone: 'danger', className: 'podman-status--error' },
	unknown: { label: _('Unknown'), tone: 'neutral', className: 'podman-status--unknown' }
});

const POLL_DEFAULT_INTERVAL_MS = 5000;
const POLL_MAX_INTERVAL_MS = 30000;
const POLL_BACKOFF_STEP_MS = 5000;
const POLL_MAX_FAILURES = 5;
const TEXT_PREVIEW_MAX_CHARS = 65536;
const JSON_PREVIEW_MAX_CHARS = 131072;

function isObject(value) {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isOkEnvelope(value) {
	return isObject(value) && value.status === 'ok';
}

function isErrorEnvelope(value) {
	return isObject(value) && value.status !== 'ok' && typeof value.code === 'string' && typeof value.message === 'string';
}

function normalizeDetails(details) {
	if (isObject(details) || Array.isArray(details))
		return details;
	if (details == null)
		return {};
	return { value: details };
}

function normalizeError(value, fallbackMessage) {
	if (isErrorEnvelope(value)) {
		return {
			status: value.status,
			code: value.code,
			message: value.message,
			details: normalizeDetails(value.details)
		};
	}

	if (isObject(value) && typeof value.message === 'string') {
		return {
			status: 'error',
			code: 'RPC_EXCEPTION',
			message: value.message,
			details: normalizeDetails(value)
		};
	}

	return {
		status: 'error',
		code: 'UNKNOWN_ERROR',
		message: fallbackMessage || _('Unexpected error while calling Podman RPC'),
		details: normalizeDetails(value)
	};
}

function normalizeResult(value, fallbackMessage) {
	if (isOkEnvelope(value)) {
		return {
			ok: true,
			data: value.data,
			meta: value.meta || null,
			capability: value.capability || null,
			raw: value
		};
	}

	return {
		ok: false,
		error: normalizeError(value, fallbackMessage),
		raw: value
	};
}

async function callRpc(method, args, fallbackMessage) {
	try {
		const value = (args == null) ? await method() : await method(args);
		return normalizeResult(value, fallbackMessage);
	}
	catch (err) {
		return {
			ok: false,
			error: normalizeError(err, fallbackMessage),
			raw: null
		};
	}
}

function formatError(error) {
	const normalized = normalizeError(error);
	const parts = [ normalized.message ];

	if (normalized.code)
		parts.push(`(${normalized.code})`);

	if (normalized.details && Object.keys(normalized.details).length) {
		try {
			parts.push(JSON.stringify(normalized.details));
		}
		catch (e) {
			parts.push(String(normalized.details));
		}
	}

	return parts.join(' ');
}

function unavailableRemediation(error) {
	const normalized = normalizeError(error);
	const code = String(normalized.code || '');
	const floor = normalized.details?.floor || '';

	if (code === 'SOCKET_CONNECT_FAILED' || code === 'SOCKET_CREATE_FAILED')
		return _('Ensure luci-podman-service is running and /run/podman/podman.sock is available.');

	if (code === 'UNHEALTHY_BACKEND')
		return _('Check Podman service/socket health, then retry.');

	if (code === 'RESPONSE_HEADER_TIMEOUT')
		return _('Podman API did not respond in time; check service load or restart luci-podman-service.');

	if (code === 'UNSUPPORTED_PLATFORM_OR_VERSION')
		return floor ? _('Upgrade Podman/Libpod to %s or newer.').format(String(floor)) : _('Upgrade Podman/Libpod to a supported version.');

	if (code === 'MUTATING_DISABLED')
		return _('Compatibility policy currently enforces read-only mode.');

	if (code === 'RESOURCE_UNAVAILABLE' || code === 'NOT_IMPLEMENTED' || code === 'NOT_FOUND')
		return _('This capability is unavailable on the current Podman API surface.');

	if (code === 'RESPONSE_LIMIT')
		return _('Response exceeded safety limits; narrow request scope and retry.');

	if (code === 'REQUEST_TOO_LARGE')
		return _('Request body exceeded safety limits; reduce payload size and retry.');

	return '';
}

function formatUnavailable(error, fallbackMessage) {
	const normalized = normalizeError(error, fallbackMessage || _('Podman capability is unavailable'));
	const remediation = unavailableRemediation(normalized);
	if (!remediation)
		return normalized.message;
	return _('%s Remediation: %s').format(normalized.message, remediation);
}

function truncateText(value, maxChars) {
	const raw = value == null ? '' : String(value);
	const limit = Math.max(256, Number(maxChars || TEXT_PREVIEW_MAX_CHARS));
	if (raw.length <= limit) {
		return {
			text: raw,
			truncated: false,
			totalChars: raw.length,
			limitChars: limit
		};
	}

	return {
		text: raw.substring(0, limit),
		truncated: true,
		totalChars: raw.length,
		limitChars: limit
	};
}

function stringifyJsonPreview(value, maxChars) {
	let text = '';
	try {
		text = JSON.stringify(value == null ? {} : value, null, 2);
	}
	catch (err) {
		text = String(value == null ? '' : value);
	}

	return truncateText(text, maxChars || JSON_PREVIEW_MAX_CHARS);
}

function notify(title, message, level, durationMs) {
	const messages = Array.isArray(message) ? message : [ message ];
	const safeMessages = messages.map((entry) => (entry == null ? '' : String(entry))).filter((entry) => entry !== '');

	if (!safeMessages.length)
		safeMessages.push(_('No details provided'));

	if (typeof ui.addTimeLimitedNotification === 'function') {
		ui.addTimeLimitedNotification(title, safeMessages, durationMs || 5000, level || 'info');
		return;
	}

	if (typeof ui.addNotification === 'function')
		ui.addNotification(null, E('p', {}, [ safeMessages.join('\n') ]));
}

function normalizeStatus(value) {
	return String(value || '').trim().toLowerCase();
}

function statusBadgeMeta(status, fallbackLabel) {
	const key = normalizeStatus(status);
	const known = STATUS_BADGES[key] || STATUS_BADGES.unknown;

	return {
		label: fallbackLabel || known.label,
		tone: known.tone,
		className: known.className,
		key: key || 'unknown'
	};
}

function renderStatusBadge(status, fallbackLabel) {
	const meta = statusBadgeMeta(status, fallbackLabel);
	return E('span', {
		'class': `podman-status-badge ${meta.className}`,
		'data-tone': meta.tone
	}, [ meta.label ]);
}

function toCapabilityShape(capability) {
	const src = capability && capability.capability ? capability.capability : capability;
	const caps = src?.capabilities || {};
	const mutatingEnabled = caps.mutatingEnabled != null ? !!caps.mutatingEnabled : !!src?.supported;

	return {
		healthy: src?.healthy !== false,
		supported: src?.supported !== false,
		drift: src?.drift || 'unknown',
		mutatingEnabled: mutatingEnabled,
		capabilities: {
			system: caps.system !== false,
			pods: caps.pods !== false,
			containers: caps.containers !== false,
			images: caps.images !== false,
			networks: caps.networks !== false,
			volumes: caps.volumes !== false,
			events: caps.events !== false,
			mutatingEnabled: mutatingEnabled
		}
	};
}

function gateAction(capability, options) {
	const policy = options || {};
	const cap = toCapabilityShape(capability || {});
	const resource = String(policy.resource || '').toLowerCase();
	const mutating = policy.mutating === true;

	if (!cap.healthy) {
		return {
			allowed: false,
			code: 'UNHEALTHY_BACKEND',
			message: _('Podman backend is not healthy')
		};
	}

	if (!cap.supported) {
		return {
			allowed: false,
			code: 'UNSUPPORTED_PLATFORM_OR_VERSION',
			message: _('Podman version is below the supported contract floor')
		};
	}

	if (mutating && !cap.mutatingEnabled) {
		return {
			allowed: false,
			code: 'MUTATING_DISABLED',
			message: _('Mutating actions are disabled by capability policy')
		};
	}

	if (resource && cap.capabilities[resource] === false) {
		return {
			allowed: false,
			code: 'RESOURCE_UNAVAILABLE',
			message: _('Requested Podman capability is unavailable')
		};
	}

	return { allowed: true, code: '', message: '' };
}

async function loadCapability(refresh) {
	return callRpc(system_probe, { refresh: refresh === true }, _('Failed to load Podman capability probe'));
}

async function loadSummary(options) {
	const opts = options || {};
	const capResult = await loadCapability(opts.refreshCapability === true);
	if (!capResult.ok)
		return capResult;

	const eventsQuery = Object.assign({ stream: false }, opts.eventsQuery || {});
	const requests = {
		info: callRpc(system_info, null, _('Failed to read Podman system info')),
		version: callRpc(system_version, null, _('Failed to read Podman version')),
		df: callRpc(system_df, null, _('Failed to read Podman disk usage')),
		pods: callRpc(pod_list, { query: { all: true } }, _('Failed to list pods')),
		containers: callRpc(container_list, { query: { all: true } }, _('Failed to list containers')),
		images: callRpc(image_list, { query: {} }, _('Failed to list images')),
		networks: callRpc(network_list, { query: {} }, _('Failed to list networks')),
		volumes: callRpc(volume_list, { query: {} }, _('Failed to list volumes')),
		events: callRpc(events_snapshot, { query: eventsQuery }, _('Failed to load event snapshot'))
	};

	const keys = Object.keys(requests);
	const values = await Promise.all(keys.map((k) => requests[k]));
	const resolved = {};
	for (let i = 0; i < keys.length; i++)
		resolved[keys[i]] = values[i];

	const data = {
		capability: capResult.data,
		system: {
			info: resolved.info.ok ? resolved.info.data : null,
			version: resolved.version.ok ? resolved.version.data : null,
			df: resolved.df.ok ? resolved.df.data : null
		},
		resources: {
			pods: resolved.pods.ok ? (Array.isArray(resolved.pods.data) ? resolved.pods.data : []) : [],
			containers: resolved.containers.ok ? (Array.isArray(resolved.containers.data) ? resolved.containers.data : []) : [],
			images: resolved.images.ok ? (Array.isArray(resolved.images.data) ? resolved.images.data : []) : [],
			networks: resolved.networks.ok ? (Array.isArray(resolved.networks.data) ? resolved.networks.data : []) : [],
			volumes: resolved.volumes.ok ? (Array.isArray(resolved.volumes.data) ? resolved.volumes.data : []) : []
		},
		events: resolved.events.ok ? (Array.isArray(resolved.events.data) ? resolved.events.data : []) : [],
		errors: {
			info: resolved.info.ok ? null : resolved.info.error,
			version: resolved.version.ok ? null : resolved.version.error,
			df: resolved.df.ok ? null : resolved.df.error,
			pods: resolved.pods.ok ? null : resolved.pods.error,
			containers: resolved.containers.ok ? null : resolved.containers.error,
			images: resolved.images.ok ? null : resolved.images.error,
			networks: resolved.networks.ok ? null : resolved.networks.error,
			volumes: resolved.volumes.ok ? null : resolved.volumes.error,
			events: resolved.events.ok ? null : resolved.events.error
		}
	};

	data.counts = {
		pods: data.resources.pods.length,
		containers: data.resources.containers.length,
		images: data.resources.images.length,
		networks: data.resources.networks.length,
		volumes: data.resources.volumes.length,
		events: data.events.length
	};

	return { ok: true, data: data, capability: null, raw: resolved };
}

function createPoller(job, options) {
	const opts = options || {};
	const intervalMs = Math.max(1000, opts.intervalMs || POLL_DEFAULT_INTERVAL_MS);
	const maxIntervalMs = Math.max(intervalMs, opts.maxIntervalMs || POLL_MAX_INTERVAL_MS);
	const backoffStepMs = Math.max(1000, opts.backoffStepMs || POLL_BACKOFF_STEP_MS);
	const maxFailures = Math.max(1, opts.maxFailures || POLL_MAX_FAILURES);

	let timer = null;
	let running = false;
	let inFlight = false;
	let failures = 0;
	let currentDelay = intervalMs;

	const schedule = function(delay) {
		if (!running)
			return;
		const boundedDelay = Math.max(250, delay);
		timer = setTimeout(tick, boundedDelay);
	};

	const stop = function() {
		running = false;
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const onTickSuccess = function(payload) {
		failures = 0;
		currentDelay = intervalMs;
		if (typeof opts.onData === 'function')
			opts.onData(payload);
		schedule(currentDelay);
	};

	const onTickFailure = function(error) {
		failures += 1;
		currentDelay = Math.min(maxIntervalMs, intervalMs + (failures * backoffStepMs));
		if (typeof opts.onError === 'function')
			opts.onError(error, failures);

		if (failures >= maxFailures) {
			stop();
			if (typeof opts.onHalt === 'function')
				opts.onHalt(error, failures);
			return;
		}

		schedule(currentDelay);
	};

	const tick = async function() {
		if (!running || inFlight)
			return;

		inFlight = true;
		try {
			if (typeof job !== 'function')
				throw new Error('poll job is not a function');
			onTickSuccess(await job());
		}
		catch (err) {
			onTickFailure(err);
		}
		finally {
			inFlight = false;
		}
	};

	return {
		start: function(immediate) {
			if (running)
				return;
			running = true;
			if (immediate !== false) {
				tick();
				return;
			}
			schedule(currentDelay);
		},
		stop: stop,
		trigger: function() {
			if (!running)
				return;
			tick();
		},
		isRunning: function() {
			return running;
		},
		state: function() {
			return {
				running: running,
				inFlight: inFlight,
				failures: failures,
				nextDelayMs: currentDelay,
				maxFailures: maxFailures
			};
		}
	};
}

return {
	basePath: basePath,

	rpc: {
		system: {
			probe: system_probe,
			ping: system_ping,
			info: system_info,
			version: system_version,
			df: system_df,
			prune: system_prune
		},
		pod: {
			list: pod_list,
			create: pod_create,
			inspect: pod_inspect,
			exists: pod_exists,
			start: pod_start,
			stop: pod_stop,
			restart: pod_restart,
			pause: pod_pause,
			unpause: pod_unpause,
			kill: pod_kill,
			remove: pod_remove,
			prune: pod_prune
		},
		container: {
			list: container_list,
			create: container_create,
			inspect: container_inspect,
			exists: container_exists,
			start: container_start,
			stop: container_stop,
			restart: container_restart,
			kill: container_kill,
			pause: container_pause,
			unpause: container_unpause,
			remove: container_remove,
			logs: container_logs,
			prune: container_prune
		},
		image: {
			list: image_list,
			search: image_search,
			inspect: image_inspect,
			exists: image_exists,
			pull: image_pull,
			remove: image_remove,
			prune: image_prune,
			tag: image_tag,
			untag: image_untag
		},
		network: {
			list: network_list,
			create: network_create,
			inspect: network_inspect,
			exists: network_exists,
			connect: network_connect,
			disconnect: network_disconnect,
			remove: network_remove,
			prune: network_prune
		},
		volume: {
			list: volume_list,
			create: volume_create,
			inspect: volume_inspect,
			exists: volume_exists,
			remove: volume_remove,
			prune: volume_prune
		},
		events: {
			snapshot: events_snapshot
		}
	},

	callRpc: callRpc,
	loadCapability: loadCapability,
	loadSummary: loadSummary,

	isOkEnvelope: isOkEnvelope,
	isErrorEnvelope: isErrorEnvelope,
	normalizeError: normalizeError,
	formatError: formatError,
	formatUnavailable: formatUnavailable,
	unavailableRemediation: unavailableRemediation,
	normalizeResult: normalizeResult,

	notify: notify,
	notifySuccess: function(title, message, durationMs) {
		notify(title || _('Podman'), message, 'success', durationMs || 4000);
	},
	notifyError: function(title, error, durationMs) {
		notify(title || _('Podman'), formatError(error), 'error', durationMs || 7000);
	},

	statusBadgeMeta: statusBadgeMeta,
	renderStatusBadge: renderStatusBadge,

	toCapabilityShape: toCapabilityShape,
	gateAction: gateAction,

	createPoller: createPoller,
	truncateText: truncateText,
	stringifyJsonPreview: stringifyJsonPreview,
	TEXT_PREVIEW_MAX_CHARS: TEXT_PREVIEW_MAX_CHARS,
	JSON_PREVIEW_MAX_CHARS: JSON_PREVIEW_MAX_CHARS,

	stubCard: function(title, description) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ title ]),
			E('p', {}, [ description ])
		]);
	}
};
