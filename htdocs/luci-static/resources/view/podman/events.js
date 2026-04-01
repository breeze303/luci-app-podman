'use strict';
'require view';
'require ui';
'require podman.common as podman';

const MAX_EVENTS_ROWS = 200;
const MAX_EVENT_FIELD_CHARS = 256;
const WINDOW_OPTIONS = Object.freeze([
	{ value: '-5m', label: _('Last 5 minutes') },
	{ value: '-15m', label: _('Last 15 minutes') },
	{ value: '-1h', label: _('Last 1 hour') },
	{ value: '-6h', label: _('Last 6 hours') }
]);

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function lowerText(value) {
	return String(value == null ? '' : value).trim().toLowerCase();
}

function cleanText(value, fallback) {
	const text = String(value == null ? '' : value).trim();
	const normalized = text || (fallback || '-');
	if (normalized.length <= MAX_EVENT_FIELD_CHARS)
		return normalized;
	return normalized.substring(0, MAX_EVENT_FIELD_CHARS);
}

function parseEventEpoch(event) {
	const nano = Number(event?.timeNano || event?.TimeNano || 0);
	if (Number.isFinite(nano) && nano > 0)
		return Math.floor(nano / 1000000000);

	const sec = Number(event?.time || event?.Time || 0);
	if (Number.isFinite(sec) && sec > 0)
		return Math.floor(sec);

	const dt = Date.parse(String(event?.Time || event?.time || ''));
	if (Number.isFinite(dt) && dt > 0)
		return Math.floor(dt / 1000);

	return 0;
}

function eventTargetName(event) {
	const actor = event?.Actor || {};
	const attrs = actor?.Attributes || {};

	return cleanText(
		attrs.name || attrs.image || attrs.container || attrs.pod || attrs.network || attrs.volume || actor?.ID,
		event?.id || event?.ID || actor?.ID || '-'
	);
}

function normalizeEvent(event) {
	const epoch = parseEventEpoch(event);
	const when = epoch > 0 ? new Date(epoch * 1000) : null;

	return {
		epoch: epoch,
		when: when,
		timeText: when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : '-',
		type: cleanText(event?.Type, '-'),
		action: cleanText(event?.Action, '-'),
		target: eventTargetName(event),
		scope: cleanText(event?.scope || event?.Scope, '-')
	};
}

function toFiltered(events, filters) {
	const typeNeedle = lowerText(filters?.type);
	const actionNeedle = lowerText(filters?.action);
	const targetNeedle = lowerText(filters?.target);

	return asArray(events).filter((entry) => {
		if (typeNeedle && !lowerText(entry?.type).includes(typeNeedle))
			return false;
		if (actionNeedle && !lowerText(entry?.action).includes(actionNeedle))
			return false;
		if (targetNeedle && !lowerText(entry?.target).includes(targetNeedle))
			return false;
		return true;
	});
}

return view.extend({
	load: async function() {
		const capabilityResult = await podman.loadCapability(false);
		const capability = capabilityResult.ok ? capabilityResult.data : null;

		return {
			capability: capability,
			capabilityError: capabilityResult.ok ? null : capabilityResult.error,
			events: [],
			error: null,
			windowSince: WINDOW_OPTIONS[0].value,
			filters: { type: '', action: '', target: '' },
			autoRefreshWanted: true,
			autoRefreshRunning: false,
			lastUpdatedEpoch: 0,
			refreshInFlight: null,
			refreshSeq: 0,
			failureCount: 0,
			autoStatusText: _('Idle')
		};
	},

	beforeRender: function() {
		if (this.poller) {
			this.poller.stop();
			this.poller = null;
		}
		this.unbindLifecycleListeners();
	},

	render: function(data) {
		this.beforeRender();
		this.state = data || {};
		this.rootNode = E('div', { 'class': 'cbi-map' });
		this.renderIntoRoot();
		this.bindLifecycleListeners();
		this.ensurePoller();
		this.startAutoRefresh(true);
		return this.rootNode;
	},

	renderIntoRoot: function() {
		if (!this.rootNode)
			return;

		const readGate = podman.gateAction(this.state?.capability, {
			resource: 'events',
			mutating: false
		});

		const disableControls = !readGate.allowed;
		const filtered = toFiltered(this.state?.events, this.state?.filters);
		const updatedText = this.state?.lastUpdatedEpoch > 0
			? new Date(this.state.lastUpdatedEpoch * 1000).toLocaleString()
			: _('Never');

		this.rootNode.innerHTML = '';
		this.rootNode.appendChild(E('h2', {}, [ _('Podman - Events') ]));
		this.rootNode.appendChild(E('div', { 'class': 'cbi-map-descr' }, [
			_('Bounded event snapshots only (stream=false), 200-row window, and low-cost polling with backoff.')
		]));

		if (this.state?.capabilityError) {
			this.rootNode.appendChild(E('div', { 'class': 'alert-message warning' }, [
				podman.formatUnavailable(this.state.capabilityError)
			]));
		}

		if (!readGate.allowed) {
			this.rootNode.appendChild(E('div', { 'class': 'alert-message warning' }, [
				_('Events endpoint is unavailable: %s').format(podman.formatUnavailable(readGate))
			]));
		}

		if (this.state?.error) {
			this.rootNode.appendChild(E('div', { 'class': 'alert-message error' }, [
				podman.formatUnavailable(this.state.error)
			]));
		}

		const controlSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Refresh controls') ])
		]);

		const controlGrid = E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end;'
		});

		const field = (label, inputNode) => E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ label ]),
			E('div', { 'class': 'cbi-value-field' }, [ inputNode ])
		]);

		const windowSelect = E('select', {
			'class': 'cbi-input-select',
			'disabled': disableControls ? 'disabled' : null,
			'change': ui.createHandlerFn(this, function(ev) {
				this.state.windowSince = ev?.target?.value || WINDOW_OPTIONS[0].value;
				this.manualRefresh();
			})
		});

		WINDOW_OPTIONS.forEach((entry) => {
			windowSelect.appendChild(E('option', {
				'value': entry.value,
				'selected': this.state?.windowSince === entry.value ? 'selected' : null
			}, [ entry.label ]));
		});

		const typeFilter = E('input', {
			'class': 'cbi-input-text',
			'placeholder': _('container, image, pod...'),
			'value': this.state?.filters?.type || '',
			'disabled': disableControls ? 'disabled' : null,
			'input': ui.createHandlerFn(this, function(ev) {
				this.state.filters.type = ev?.target?.value || '';
				this.renderIntoRoot();
			})
		});

		const actionFilter = E('input', {
			'class': 'cbi-input-text',
			'placeholder': _('start, stop, pull...'),
			'value': this.state?.filters?.action || '',
			'disabled': disableControls ? 'disabled' : null,
			'input': ui.createHandlerFn(this, function(ev) {
				this.state.filters.action = ev?.target?.value || '';
				this.renderIntoRoot();
			})
		});

		const targetFilter = E('input', {
			'class': 'cbi-input-text',
			'placeholder': _('name, ID, image...'),
			'value': this.state?.filters?.target || '',
			'disabled': disableControls ? 'disabled' : null,
			'input': ui.createHandlerFn(this, function(ev) {
				this.state.filters.target = ev?.target?.value || '';
				this.renderIntoRoot();
			})
		});

		const refreshButton = E('button', {
			'class': 'cbi-button cbi-button-action',
			'disabled': disableControls ? 'disabled' : null,
			'click': ui.createHandlerFn(this, 'manualRefresh')
		}, [ _('Refresh now') ]);

		const autoButtonLabel = this.state?.autoRefreshWanted ? _('Stop auto refresh') : _('Start auto refresh');
		const autoButton = E('button', {
			'class': 'cbi-button',
			'disabled': disableControls ? 'disabled' : null,
			'click': ui.createHandlerFn(this, 'toggleAutoRefresh')
		}, [ autoButtonLabel ]);

		controlGrid.appendChild(field(_('Snapshot window'), windowSelect));
		controlGrid.appendChild(field(_('Filter: type'), typeFilter));
		controlGrid.appendChild(field(_('Filter: action'), actionFilter));
		controlGrid.appendChild(field(_('Filter: target'), targetFilter));
		controlGrid.appendChild(field(_('Manual refresh'), refreshButton));
		controlGrid.appendChild(field(_('Auto refresh'), autoButton));
		controlSection.appendChild(controlGrid);

		controlSection.appendChild(E('p', { 'class': 'cbi-value-description' }, [
			_('Status: %s | Last update: %s | Rows: %s/%s | Polling: 5s → 30s failure backoff').format(
				this.state?.autoStatusText || _('Idle'),
				updatedText,
				String(filtered.length),
				String(MAX_EVENTS_ROWS)
			)
		]));

		this.rootNode.appendChild(controlSection);

		const tableSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Event snapshots') ])
		]);

		if (!filtered.length) {
			tableSection.appendChild(E('div', { 'class': 'cbi-section-node' }, [
				E('em', {}, [ _('No events in current snapshot/filter window.') ])
			]));
			this.rootNode.appendChild(tableSection);
			return;
		}

		const rows = filtered.map((entry) => E('tr', {}, [
			E('td', { 'style': 'white-space:nowrap;' }, [ entry.timeText ]),
			E('td', {}, [ entry.type ]),
			E('td', {}, [ entry.action ]),
			E('td', {}, [ entry.target ]),
			E('td', {}, [ entry.scope ])
		]));

		tableSection.appendChild(E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'style': 'overflow-x:auto;' }, [
				E('table', { 'class': 'table cbi-section-table' }, [
					E('thead', {}, [
						E('tr', {}, [
							E('th', {}, [ _('Time') ]),
							E('th', {}, [ _('Type') ]),
							E('th', {}, [ _('Action') ]),
							E('th', {}, [ _('Target') ]),
							E('th', {}, [ _('Scope') ])
						])
					]),
					E('tbody', {}, rows)
				])
			])
		]));

		this.rootNode.appendChild(tableSection);
	},

	ensurePoller: function() {
		if (this.poller)
			return;

		this.poller = podman.createPoller(async () => {
			const ok = await this.refreshSnapshot('auto', true);
			if (!ok)
				throw this.state?.error || new Error('events snapshot failed');
			return { count: this.state?.events?.length || 0 };
		}, {
			intervalMs: 5000,
			maxIntervalMs: 30000,
			backoffStepMs: 5000,
			onData: () => {
				this.state.failureCount = 0;
				this.updateAutoStatus(_('Auto refresh running'));
			},
			onError: (error, failures) => {
				this.state.failureCount = failures;
				this.state.error = podman.normalizeError(error, _('Failed to load event snapshot'));
				this.updateAutoStatus(_('Auto refresh retry #%s').format(String(failures)));
				this.renderIntoRoot();
			},
			onHalt: (error) => {
				this.state.autoRefreshRunning = false;
				this.state.error = podman.normalizeError(error, _('Auto refresh halted after repeated failures'));
				this.updateAutoStatus(_('Auto refresh halted'));
				this.renderIntoRoot();
			}
		});
	},

	updateAutoStatus: function(baseText) {
		const pollState = this.poller ? this.poller.state() : { failures: 0, nextDelayMs: 5000 };
		const details = _('%s failures, next %sms').format(String(pollState.failures || 0), String(pollState.nextDelayMs || 5000));
		this.state.autoStatusText = `${baseText || _('Idle')} (${details})`;
	},

	startAutoRefresh: function(immediate) {
		if (!this.state?.autoRefreshWanted)
			return;
		if (document.hidden)
			return;

		const readGate = podman.gateAction(this.state?.capability, { resource: 'events', mutating: false });
		if (!readGate.allowed)
			return;

		this.ensurePoller();
		this.state.autoRefreshRunning = true;
		this.updateAutoStatus(_('Auto refresh running'));
		this.poller.start(immediate !== false);
		this.renderIntoRoot();
	},

	stopAutoRefresh: function(reason) {
		if (this.poller)
			this.poller.stop();
		this.state.autoRefreshRunning = false;
		this.updateAutoStatus(reason || _('Auto refresh stopped'));
		this.renderIntoRoot();
	},

	toggleAutoRefresh: function() {
		this.state.autoRefreshWanted = !this.state.autoRefreshWanted;
		if (this.state.autoRefreshWanted)
			this.startAutoRefresh(false);
		else
			this.stopAutoRefresh(_('Auto refresh stopped by user'));
	},

	manualRefresh: async function() {
		const readGate = podman.gateAction(this.state?.capability, { resource: 'events', mutating: false });
		if (!readGate.allowed) {
			podman.notifyError(_('Podman - Events'), {
				message: readGate.message,
				code: readGate.code
			});
			return;
		}

		const ok = await this.refreshSnapshot('manual', true);
		if (!ok)
			podman.notifyError(_('Podman - Events'), this.state?.error || _('Failed to load events snapshot'));
		this.renderIntoRoot();
	},

	refreshSnapshot: async function(reason, applyBackoffError) {
		if (this.state?.refreshInFlight)
			return this.state.refreshInFlight;

		const query = {
			stream: false,
			since: this.state?.windowSince || WINDOW_OPTIONS[0].value
		};

		const seq = (this.state.refreshSeq || 0) + 1;
		this.state.refreshSeq = seq;
		this.updateAutoStatus(reason === 'manual' ? _('Manual refresh in progress') : _('Auto refresh running'));

		const run = podman.callRpc(
			podman.rpc.events.snapshot,
			{ query: query },
			_('Failed to load event snapshot')
		).then((result) => {
			if (seq !== this.state.refreshSeq)
				return false;

			if (!result.ok) {
				this.state.error = result.error;
				if (applyBackoffError)
					throw result.error;
				return false;
			}

			const normalized = asArray(result.data)
				.map((entry) => normalizeEvent(entry))
				.sort((a, b) => b.epoch - a.epoch)
				.slice(0, MAX_EVENTS_ROWS);

			this.state.events = normalized;
			this.state.error = null;
			this.state.lastUpdatedEpoch = Math.floor(Date.now() / 1000);
			this.state.failureCount = 0;
			this.updateAutoStatus(reason === 'manual' ? _('Manual refresh complete') : _('Auto refresh running'));
			this.renderIntoRoot();
			return true;
		}).catch((err) => {
			if (seq !== this.state.refreshSeq)
				return false;
			this.state.error = podman.normalizeError(err, _('Failed to load event snapshot'));
			this.renderIntoRoot();
			if (applyBackoffError)
				throw err;
			return false;
		}).finally(() => {
			if (this.state.refreshInFlight === run)
				this.state.refreshInFlight = null;
		});

		this.state.refreshInFlight = run;
		return run;
	},

	cancelOutstandingRefresh: function() {
		this.state.refreshSeq = (this.state.refreshSeq || 0) + 1;
		this.state.refreshInFlight = null;
	},

	bindLifecycleListeners: function() {
		this.onVisibilityChange = ui.createHandlerFn(this, function() {
			if (document.hidden) {
				this.stopAutoRefresh(_('Paused while page is hidden'));
				return;
			}

			if (this.state?.autoRefreshWanted)
				this.startAutoRefresh(false);
		});

		this.onPageHide = ui.createHandlerFn(this, function() {
			this.cancelOutstandingRefresh();
			this.stopAutoRefresh(_('Stopped on navigation'));
		});

		document.addEventListener('visibilitychange', this.onVisibilityChange);
		window.addEventListener('pagehide', this.onPageHide);
		window.addEventListener('beforeunload', this.onPageHide);
	},

	unbindLifecycleListeners: function() {
		if (this.onVisibilityChange)
			document.removeEventListener('visibilitychange', this.onVisibilityChange);
		if (this.onPageHide) {
			window.removeEventListener('pagehide', this.onPageHide);
			window.removeEventListener('beforeunload', this.onPageHide);
		}
		this.onVisibilityChange = null;
		this.onPageHide = null;
	}
});
