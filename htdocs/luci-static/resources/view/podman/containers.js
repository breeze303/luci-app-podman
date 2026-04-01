'use strict';
'require view';
'require ui';
'require podman.common as podman';

const LOG_TAIL_DEFAULT = 100;
const LOG_TAIL_MIN = 1;
const LOG_TAIL_MAX = 1000;

function normalizeName(container) {
	const names = Array.isArray(container?.Names) ? container.Names : [];
	const first = names.length ? String(names[0]) : '';
	if (!first)
		return String(container?.Id || '').substring(0, 12) || '-';
	return first.replace(/^\//, '') || first;
}

function normalizePodName(container) {
	const labels = container?.Labels || {};
	return String(
		container?.PodName ||
		container?.Pod ||
		labels['io.podman.pod.name'] ||
		''
	).trim();
}

function normalizeStatus(container) {
	const explicit = String(container?.State || '').trim();
	if (explicit)
		return explicit;

	const text = String(container?.Status || '').trim();
	if (!text)
		return 'unknown';

	const token = text.split(/\s+/)[0];
	return token ? token.toLowerCase() : 'unknown';
}

function formatCreated(value) {
	const epoch = Number(value || 0);
	if (!Number.isFinite(epoch) || epoch <= 0)
		return '-';

	const date = new Date(epoch * 1000);
	if (Number.isNaN(date.getTime()))
		return '-';

	return date.toLocaleString();
}

function safeText(value, fallback) {
	const text = value == null ? '' : String(value);
	return text.trim() ? text : (fallback || '-');
}

function targetOf(container) {
	return safeText(container?.Id, '') || safeText(container?._name, '');
}

function parseRestartPolicy(inspectData) {
	const policy = inspectData?.HostConfig?.RestartPolicy;
	if (policy == null)
		return _('Not available');

	if (typeof policy === 'string')
		return safeText(policy, _('Not available'));

	const name = safeText(policy?.Name || policy?.name, '');
	if (!name)
		return _('Not available');

	if (name === 'on-failure') {
		const retries = Number(policy?.MaximumRetryCount || policy?.maximumRetryCount || 0);
		if (Number.isFinite(retries) && retries > 0)
			return `${name} (${_('max retries')}: ${retries})`;
	}

	return name;
}

return view.extend({
	load: function() {
		return this.refreshData(false);
	},

	refreshData: async function(refreshCapability) {
		const capResult = await podman.loadCapability(refreshCapability === true);
		if (!capResult.ok)
			return {
				capability: null,
				containers: [],
				pods: [],
				error: capResult.error
			};

		const capability = capResult.data;
		const readGate = podman.gateAction(capability, { resource: 'containers', mutating: false });
		if (!readGate.allowed) {
			return {
				capability: capability,
				containers: [],
				pods: [],
				error: { message: readGate.message, code: readGate.code }
			};
		}

		const [containerResult, podResult] = await Promise.all([
			podman.callRpc(
				podman.rpc.container.list,
				{ query: { all: true } },
				_('Failed to list containers')
			),
			podman.callRpc(
				podman.rpc.pod.list,
				{ query: { all: true } },
				_('Failed to list pods')
			)
		]);

		return {
			capability: capability,
			containers: containerResult.ok && Array.isArray(containerResult.data) ? containerResult.data : [],
			pods: podResult.ok && Array.isArray(podResult.data) ? podResult.data : [],
			error: containerResult.ok ? null : containerResult.error,
			podError: podResult.ok ? null : podResult.error
		};
	},

	setState: function(data) {
		const payload = data || {};
		this.state = {
			capability: payload.capability || null,
			containers: Array.isArray(payload.containers) ? payload.containers : [],
			pods: Array.isArray(payload.pods) ? payload.pods : [],
			error: payload.error || null,
			podError: payload.podError || null,
			inspectCache: this.state?.inspectCache || {},
			logCache: this.state?.logCache || {},
			openDetail: this.state?.openDetail || {}
		};
	},

	render: function(data) {
		this.setState(data);
		this.rootNode = E('div', { 'class': 'cbi-map' });
		this.renderIntoRoot();
		return this.rootNode;
	},

	renderIntoRoot: function() {
		if (!this.rootNode)
			return;

		this.rootNode.innerHTML = '';
		this.rootNode.appendChild(E('h2', {}, [ _('Podman - Containers') ]));
		this.rootNode.appendChild(E('div', { 'class': 'cbi-map-descr' }, [
			_('Manage standalone and pod-attached containers with bounded log snapshots and Podman-native lifecycle actions.')
		]));

		if (this.state.error) {
			this.rootNode.appendChild(E('div', { 'class': 'alert-message error' }, [ podman.formatUnavailable(this.state.error) ]));
		}

		if (this.state.podError) {
			this.rootNode.appendChild(E('div', { 'class': 'alert-message warning' }, [
				_('Pods could not be listed for optional container assignment: %s').format(podman.formatUnavailable(this.state.podError))
			]));
		}

		this.rootNode.appendChild(this.renderCreateSection());
		this.rootNode.appendChild(this.renderContainerSections());
	},

	refreshView: async function() {
		const data = await this.refreshData(false);
		this.setState(data);
		this.renderIntoRoot();
	},

	canMutate: function() {
		const decision = podman.gateAction(this.state?.capability, {
			resource: 'containers',
			mutating: true
		});

		if (!decision.allowed) {
			podman.notifyError(_('Podman - Containers'), {
				message: decision.message,
				code: decision.code
			});
			return false;
		}

		return true;
	},

	createActionButton: function(label, className, onClick, disabled) {
		return E('button', {
			'class': className || 'cbi-button',
			'click': ui.createHandlerFn(this, onClick),
			'disabled': disabled ? 'disabled' : null
		}, [ label ]);
	},

	renderCreateSection: function() {
		const section = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Create container') ])
		]);

		const gate = podman.gateAction(this.state?.capability, {
			resource: 'containers',
			mutating: true
		});

		const formWrap = E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end;'
		});

		const refs = this.createRefs || {};
		refs.name = E('input', { 'class': 'cbi-input-text', 'placeholder': _('my-container') });
		refs.image = E('input', { 'class': 'cbi-input-text', 'placeholder': _('docker.io/library/alpine:latest') });
		refs.pod = E('select', { 'class': 'cbi-input-select' });
		refs.restartPolicy = E('select', { 'class': 'cbi-input-select' });
		refs.restartRetries = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '0', 'value': '0' });

		refs.pod.appendChild(E('option', { 'value': '' }, [ _('None (standalone container)') ]));
		(this.state.pods || []).forEach((pod) => {
			const podName = safeText(pod?.Name, '');
			if (!podName)
				return;
			refs.pod.appendChild(E('option', { 'value': podName }, [ podName ]));
		});

		[
			[ 'no', _('no') ],
			[ 'always', _('always') ],
			[ 'unless-stopped', _('unless-stopped') ],
			[ 'on-failure', _('on-failure') ]
		].forEach((entry) => refs.restartPolicy.appendChild(E('option', { 'value': entry[0] }, [ entry[1] ])));

		const restartHelp = E('p', { 'class': 'cbi-value-description' }, [
			_('Restart policy applies only to standalone containers. Pod-attached containers follow pod-level lifecycle and reconciliation.')
		]);

		const onPodSelectChange = () => {
			const inPod = !!refs.pod.value;
			refs.restartPolicy.disabled = inPod;
			refs.restartRetries.disabled = inPod || refs.restartPolicy.value !== 'on-failure';
		};

		refs.pod.addEventListener('change', onPodSelectChange);
		refs.restartPolicy.addEventListener('change', onPodSelectChange);

		const field = (label, node) => E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ label ]),
			E('div', { 'class': 'cbi-value-field' }, [ node ])
		]);

		formWrap.appendChild(field(_('Name'), refs.name));
		formWrap.appendChild(field(_('Image'), refs.image));
		formWrap.appendChild(field(_('Pod (optional)'), refs.pod));
		formWrap.appendChild(field(_('Restart policy (standalone only)'), refs.restartPolicy));
		formWrap.appendChild(field(_('On-failure max retries'), refs.restartRetries));

		const createButton = this.createActionButton(_('Create container'), 'cbi-button cbi-button-add', async () => {
			if (!this.canMutate())
				return;

			const name = safeText(refs.name.value, '');
			const image = safeText(refs.image.value, '');
			const podName = safeText(refs.pod.value, '');
			const restartPolicy = safeText(refs.restartPolicy.value, 'no');
			const retries = Number(refs.restartRetries.value || 0);

			if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(name)) {
				podman.notifyError(_('Podman - Containers'), {
					message: _('Container name must start with [A-Za-z0-9] and only contain [A-Za-z0-9_.:-].'),
					code: 'INVALID_NAME'
				});
				return;
			}

			if (!image) {
				podman.notifyError(_('Podman - Containers'), {
					message: _('Image reference is required.'),
					code: 'INVALID_IMAGE'
				});
				return;
			}

			if (restartPolicy === 'on-failure' && (!Number.isFinite(retries) || retries < 0)) {
				podman.notifyError(_('Podman - Containers'), {
					message: _('On-failure retry count must be a non-negative integer.'),
					code: 'INVALID_RETRY_COUNT'
				});
				return;
			}

			const body = { Image: image };
			if (podName) {
				body.Pod = podName;
			}
			else {
				body.HostConfig = {
					RestartPolicy: {
						Name: restartPolicy,
						MaximumRetryCount: restartPolicy === 'on-failure' ? Math.floor(retries) : 0
					}
				};
			}

			const result = await podman.callRpc(
				podman.rpc.container.create,
				{ query: { name: name }, body: body },
				_('Failed to create container')
			);

			if (!result.ok) {
				podman.notifyError(_('Podman - Containers'), result.error);
				return;
			}

			podman.notifySuccess(_('Podman - Containers'), _('Container created'));
			refs.name.value = '';
			await this.refreshView();
		}, !gate.allowed);

		section.appendChild(formWrap);
		section.appendChild(restartHelp);
		section.appendChild(E('div', { 'style': 'margin-top:8px;' }, [ createButton ]));

		if (!gate.allowed) {
			section.appendChild(E('p', { 'class': 'cbi-value-description' }, [
				_('Create action disabled: %s').format(gate.message)
			]));
		}

		this.createRefs = refs;
		onPodSelectChange();
		return section;
	},

	renderContainerSections: function() {
		const containers = (this.state.containers || []).map((container) => {
			const podName = normalizePodName(container);
			return Object.assign({}, container, {
				_name: normalizeName(container),
				_status: normalizeStatus(container),
				_podName: podName,
				_isStandalone: !podName
			});
		});

		containers.sort((a, b) => a._name.localeCompare(b._name));

		const standalone = containers.filter((item) => item._isStandalone);
		const inPods = containers.filter((item) => !item._isStandalone);

		const wrap = E('div', { 'class': 'cbi-section' });
		wrap.appendChild(E('h3', {}, [ _('Containers') ]));
		wrap.appendChild(E('p', { 'class': 'cbi-value-description' }, [
			_('Standalone: %d · Pod-attached: %d · Total: %d').format(standalone.length, inPods.length, containers.length)
		]));

		wrap.appendChild(this.renderContainerTable(_('Standalone containers'), standalone, true));
		wrap.appendChild(this.renderContainerTable(_('Pod-attached containers'), inPods, false));

		return wrap;
	},

	renderContainerTable: function(title, list, showRestartHint) {
		const section = E('div', { 'style': 'margin-top:12px;' }, [ E('h4', {}, [ title ]) ]);

		if (!list.length) {
			section.appendChild(E('p', { 'class': 'cbi-value-description' }, [ _('No containers in this group.') ]));
			return section;
		}

		const table = E('table', { 'class': 'table cbi-section-table' });
		table.appendChild(E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, [ _('Name') ]),
			E('th', { 'class': 'th' }, [ _('Image') ]),
			E('th', { 'class': 'th' }, [ _('Status') ]),
			E('th', { 'class': 'th' }, [ _('Pod') ]),
			E('th', { 'class': 'th' }, [ _('Created') ]),
			E('th', { 'class': 'th' }, [ _('Actions') ])
		]));

		list.forEach((container) => {
			const isRunning = container._status === 'running';
			const isPaused = container._status === 'paused';
			const id = safeText(container?.Id, '');

			const actions = E('div', {
				'style': 'display:flex;flex-wrap:wrap;gap:4px;'
			});

			actions.appendChild(this.createActionButton(_('Details'), 'cbi-button', () => this.toggleDetails(container), false));
			actions.appendChild(this.createActionButton(_('Start'), 'cbi-button cbi-button-positive', () => this.runLifecycleAction(container, 'start'), isRunning));
			actions.appendChild(this.createActionButton(_('Stop'), 'cbi-button cbi-button-negative', () => this.runLifecycleAction(container, 'stop'), !(isRunning || isPaused)));
			actions.appendChild(this.createActionButton(_('Restart'), 'cbi-button', () => this.runLifecycleAction(container, 'restart'), false));
			actions.appendChild(this.createActionButton(_('Delete'), 'cbi-button cbi-button-negative important', () => this.deleteContainer(container), false));

			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [
					E('div', {}, [ container._name ]),
					E('div', { 'style': 'font-size:0.9em;font-family:monospace;' }, [ id.substring(0, 12) ])
				]),
				E('td', { 'class': 'td' }, [ safeText(container?.Image, '-') ]),
				E('td', { 'class': 'td' }, [ podman.renderStatusBadge(container._status) ]),
				E('td', { 'class': 'td' }, [ container._podName || _('Standalone') ]),
				E('td', { 'class': 'td' }, [ formatCreated(container?.Created) ]),
				E('td', { 'class': 'td' }, [ actions ])
			]));

			if (this.state.openDetail[targetOf(container)]) {
				table.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'colspan': '6' }, [ this.renderDetails(container, showRestartHint) ])
				]));
			}
		});

		section.appendChild(table);
		return section;
	},

	toggleDetails: async function(container) {
		const key = targetOf(container);
		if (!key)
			return;
		if (this.state.openDetail[key]) {
			delete this.state.openDetail[key];
			this.renderIntoRoot();
			return;
		}

		this.state.openDetail[key] = true;
		if (!this.state.inspectCache[key]) {
			const result = await podman.callRpc(
				podman.rpc.container.inspect,
				{ name: key, query: { size: false } },
				_('Failed to inspect container')
			);

			if (result.ok)
				this.state.inspectCache[key] = result.data;
			else
				podman.notifyError(_('Podman - Containers'), result.error);
		}

		this.renderIntoRoot();
	},

	renderDetails: function(container, showRestartHint) {
		const key = targetOf(container);
		const inspectData = this.state.inspectCache[key] || null;
		const restartPolicy = showRestartHint ? parseRestartPolicy(inspectData) : _('Managed by pod');
		const logState = this.state.logCache[key] || {
			text: '',
			tail: LOG_TAIL_DEFAULT,
			timestamps: false,
			truncated: false,
			totalChars: 0,
			limitChars: podman.TEXT_PREVIEW_MAX_CHARS
		};

		const tailInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			'min': `${LOG_TAIL_MIN}`,
			'max': `${LOG_TAIL_MAX}`,
			'value': `${logState.tail || LOG_TAIL_DEFAULT}`,
			'style': 'width:100px;'
		});

		const timestamps = E('input', {
			'class': 'cbi-input-checkbox',
			'type': 'checkbox',
			'checked': logState.timestamps ? 'checked' : null
		});

		const logsOutput = E('pre', {
			'style': 'max-height:260px;overflow:auto;background:#111;color:#ddd;padding:8px;white-space:pre-wrap;word-break:break-word;'
		}, [ safeText(logState.text, _('No log snapshot loaded yet.')) ]);

		const detail = E('div', { 'style': 'display:grid;gap:8px;' }, [
			E('div', {}, [
				E('strong', {}, [ _('Name') ]), ' ', key,
				' · ',
				E('strong', {}, [ _('Image') ]), ' ', safeText(inspectData?.Config?.Image || container?.Image, '-'),
				' · ',
				E('strong', {}, [ _('Restart policy') ]), ' ', restartPolicy
			]),
			E('div', { 'style': 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
				E('label', {}, [ _('Tail lines') ]),
				tailInput,
				E('label', {}, [ timestamps, _('Include timestamps') ]),
				this.createActionButton(_('Load logs snapshot'), 'cbi-button', async () => {
					const tail = Math.max(LOG_TAIL_MIN, Math.min(LOG_TAIL_MAX, Number(tailInput.value || LOG_TAIL_DEFAULT)));
					const result = await podman.callRpc(
						podman.rpc.container.logs,
						{
							name: key,
							query: {
								stdout: true,
								stderr: true,
								follow: false,
								tail: `${tail}`,
								timestamps: timestamps.checked ? true : false
							}
						},
						_('Failed to load container logs')
					);

					if (!result.ok) {
						podman.notifyError(_('Podman - Containers'), result.error);
						return;
					}

					const preview = podman.truncateText(String(result.data || ''), podman.TEXT_PREVIEW_MAX_CHARS);
					this.state.logCache[key] = {
						text: preview.text,
						tail: tail,
						timestamps: timestamps.checked ? true : false,
						truncated: preview.truncated,
						totalChars: preview.totalChars,
						limitChars: preview.limitChars
					};
					this.renderIntoRoot();
				}, false)
			]),
			logsOutput,
			E('p', { 'class': 'cbi-value-description' }, [
				_('Log view is a bounded snapshot/tail request only (follow and interactive attach are intentionally disabled in MVP).')
			])
		]);

		if (logState.truncated) {
			detail.appendChild(E('p', { 'class': 'cbi-value-description' }, [
				_('Log preview truncated to %s of %s characters for low-memory safety.').format(
					String(logState.limitChars || podman.TEXT_PREVIEW_MAX_CHARS),
					String(logState.totalChars || 0)
				)
			]));
		}

		return detail;
	},

	runLifecycleAction: async function(container, action) {
		if (!this.canMutate())
			return;

		const key = targetOf(container);
		if (!key)
			return;
		const map = {
			start: { rpc: podman.rpc.container.start, success: _('Container started') },
			stop: { rpc: podman.rpc.container.stop, success: _('Container stopped') },
			restart: { rpc: podman.rpc.container.restart, success: _('Container restarted') }
		};

		const selected = map[action];
		if (!selected)
			return;

		const result = await podman.callRpc(
			selected.rpc,
			{ name: key, query: {} },
			_('Container action failed')
		);

		if (!result.ok) {
			podman.notifyError(_('Podman - Containers'), result.error);
			return;
		}

		podman.notifySuccess(_('Podman - Containers'), selected.success);
		await this.refreshView();
	},

	deleteContainer: async function(container) {
		if (!this.canMutate())
			return;

		const key = targetOf(container);
		if (!key)
			return;
		if (!window.confirm(_('Delete container "%s"?').format(key)))
			return;

		const result = await podman.callRpc(
			podman.rpc.container.remove,
			{ name: key, query: { force: false, ignore: false } },
			_('Failed to remove container')
		);

		if (!result.ok) {
			podman.notifyError(_('Podman - Containers'), result.error);
			return;
		}

		delete this.state.inspectCache[key];
		delete this.state.logCache[key];
		delete this.state.openDetail[key];
		podman.notifySuccess(_('Podman - Containers'), _('Container removed'));
		await this.refreshView();
	}
});
