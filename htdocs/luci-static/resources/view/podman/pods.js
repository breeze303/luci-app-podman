'use strict';
'require view';
'require ui';
'require podman.common as pc';

function shortId(value) {
	return String(value || '').substring(0, 12);
}

function formatDate(value) {
	if (value == null || value === '')
		return '—';

	if (typeof value === 'number') {
		const d = new Date(value * 1000);
		return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
	}

	const d = new Date(value);
	return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function normalizePolicy(value) {
	const v = String(value || '').toLowerCase();
	if (v === 'always' || v === 'unless-stopped' || v === 'on-failure' || v === 'no')
		return v;
	return 'always';
}

function autostartSemantics(policy, tries) {
	const p = normalizePolicy(policy);
	if (p === 'always')
		return _('Auto-start eligible on OpenWrt reconciliation (always)');
	if (p === 'unless-stopped')
		return _('Auto-start eligible unless intentionally stopped');
	if (p === 'on-failure')
		return _('Auto-start eligible on failure policy') + (tries ? _(', retries: %s').format(String(tries)) : '');
	return _('No OpenWrt reconciliation autostart');
}

function policyLabel(policy, tries) {
	const p = normalizePolicy(policy);
	if (p === 'on-failure' && tries)
		return _('on-failure (%s retries)').format(String(tries));
	return p;
}

function podStateMeta(pod) {
	const status = String(pod?.Status || pod?.State || '').toLowerCase();
	if (status.indexOf('running') !== -1)
		return { key: 'running', label: _('Running') };
	if (status.indexOf('pause') !== -1)
		return { key: 'paused', label: _('Paused') };
	if (status.indexOf('degraded') !== -1)
		return { key: 'error', label: _('Degraded') };
	if (status.indexOf('create') !== -1)
		return { key: 'created', label: _('Created') };
	if (status.indexOf('stop') !== -1 || status.indexOf('exit') !== -1)
		return { key: 'stopped', label: _('Stopped') };
	return { key: 'unknown', label: _('Unknown') };
}

return view.extend({
	load: function() {
		return Promise.all([
			pc.loadCapability(false),
			pc.callRpc(pc.rpc.pod.list, { query: { all: true } }, _('Failed to list pods'))
		]);
	},

	render: function(loadData) {
		const viewRef = this;
		const capResult = loadData[0];
		const listResult = loadData[1];
		const capShape = capResult?.ok ? pc.toCapabilityShape(capResult.data) : pc.toCapabilityShape({});
		const mutateGate = pc.gateAction(capShape, { resource: 'pods', mutating: true });

		const state = {
			capability: capResult?.ok ? capResult.data : null,
			pods: listResult?.ok && Array.isArray(listResult.data) ? listResult.data : [],
			inspect: null,
			selectedName: ''
		};

		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Podman - Pods') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Pods are first-class Podman resources. Manage pod lifecycle, inspect details, and configure restart policy semantics for OpenWrt reconciliation.')
			])
		]);

		if (!capResult?.ok) {
			root.appendChild(E('div', { 'class': 'alert-message warning' }, [
				pc.formatUnavailable(capResult?.error || pc.normalizeError(null, _('Failed to load Podman capability probe')))
			]));
		}

		if (!listResult?.ok) {
			root.appendChild(E('div', { 'class': 'alert-message warning' }, [
				pc.formatUnavailable(listResult?.error || pc.normalizeError(null, _('Failed to list pods')))
			]));
		}

		const toolbar = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'display:flex; gap:8px; flex-wrap:wrap; align-items:center;' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, async function() {
						await refreshPods();
					})
				}, [ _('Refresh pods') ]),
				E('span', {}, [
					_('Mutating actions: %s').format(mutateGate.allowed ? _('enabled') : _('disabled')),
					mutateGate.allowed ? '' : _(' (%s)').format(mutateGate.message)
				])
			])
		]);
		root.appendChild(toolbar);

		const createName = E('input', { 'class': 'cbi-input-text', 'placeholder': _('pod-name'), 'disabled': mutateGate.allowed ? null : 'disabled' });
		const createPolicy = E('select', { 'class': 'cbi-input-select', 'disabled': mutateGate.allowed ? null : 'disabled' }, [
			E('option', { 'value': 'always' }, [ 'always' ]),
			E('option', { 'value': 'unless-stopped' }, [ 'unless-stopped' ]),
			E('option', { 'value': 'on-failure' }, [ 'on-failure' ]),
			E('option', { 'value': 'no' }, [ 'no' ])
		]);
		const createRetries = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			'min': '1',
			'placeholder': _('retries (on-failure)'),
			'disabled': mutateGate.allowed ? null : 'disabled'
		});
		const createAndStart = E('input', { 'type': 'checkbox', 'disabled': mutateGate.allowed ? null : 'disabled' });

		const createSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Create pod') ]),
			E('div', { 'style': 'display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:8px; align-items:end;' }, [
				E('label', {}, [
					E('div', {}, [ _('Name') ]),
					createName
				]),
				E('label', {}, [
					E('div', {}, [ _('Restart policy') ]),
					createPolicy
				]),
				E('label', {}, [
					E('div', {}, [ _('Restart retries') ]),
					createRetries
				]),
				E('label', { 'style': 'display:flex; gap:6px; align-items:center; margin-top:22px;' }, [
					createAndStart,
					_('Start immediately')
				]),
				E('button', {
					'class': 'btn cbi-button cbi-button-positive',
					'disabled': mutateGate.allowed ? null : 'disabled',
					'click': ui.createHandlerFn(this, async function() {
						if (!mutateGate.allowed) {
							pc.notifyError(_('Pods'), { message: mutateGate.message, code: mutateGate.code });
							return;
						}

						const name = String(createName.value || '').trim();
						if (!name) {
							pc.notify(_('Pods'), _('Pod name is required'), 'warning', 5000);
							return;
						}

						const policy = normalizePolicy(createPolicy.value);
						const body = { name: name, restart_policy: policy };
						if (policy === 'on-failure') {
							const retries = parseInt(createRetries.value, 10);
							if (!isNaN(retries) && retries > 0)
								body.restart_tries = retries;
						}

						const createRes = await pc.callRpc(pc.rpc.pod.create, { body: body }, _('Failed to create pod'));
						if (!createRes.ok) {
							pc.notifyError(_('Create pod failed'), createRes.error);
							return;
						}

						pc.notifySuccess(_('Pod created'), _('%s created').format(name));

						if (createAndStart.checked) {
							const startRes = await pc.callRpc(pc.rpc.pod.start, { name: name }, _('Failed to start pod'));
							if (!startRes.ok)
								pc.notifyError(_('Pod start failed'), startRes.error);
							else
								pc.notifySuccess(_('Pod started'), _('%s started').format(name));
						}

						createName.value = '';
						createRetries.value = '';
						await refreshPods(name);
					})
				}, [ _('Create pod') ])
			]),
			E('p', { 'class': 'cbi-value-description' }, [
				_('Restart policy controls OpenWrt boot reconciliation/autostart semantics for pods.')
			])
		]);
		root.appendChild(createSection);

		const tableBody = E('tbody');
		const podsTable = E('table', { 'class': 'table cbi-section-table' }, [
			E('thead', {}, [
				E('tr', {}, [
					E('th', {}, [ _('Name') ]),
					E('th', {}, [ _('Pod ID') ]),
					E('th', {}, [ _('Status') ]),
					E('th', {}, [ _('Containers') ]),
					E('th', {}, [ _('Restart/autostart') ]),
					E('th', {}, [ _('Created') ]),
					E('th', {}, [ _('Actions') ])
				])
			]),
			tableBody
		]);

		const listSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Pods') ]),
			podsTable
		]);
		root.appendChild(listSection);

		const inspectSummaryBody = E('tbody');
		const inspectSummaryTable = E('table', { 'class': 'table cbi-section-table' }, [ inspectSummaryBody ]);
		const inspectRaw = E('pre', { 'style': 'overflow:auto; max-height:320px; background:#111; color:#ddd; padding:8px;' }, [ _('Select a pod to inspect details') ]);

		const inspectSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Inspect summary/details') ]),
			inspectSummaryTable,
			inspectRaw
		]);
		root.appendChild(inspectSection);

		const renderInspect = function() {
			while (inspectSummaryBody.firstChild)
				inspectSummaryBody.removeChild(inspectSummaryBody.firstChild);

			if (!state.inspect) {
				inspectSummaryBody.appendChild(E('tr', {}, [ E('td', {}, [ _('No pod selected') ]) ]));
				inspectRaw.textContent = _('Select a pod to inspect details');
				return;
			}

			const p = state.inspect;
			const policy = p?.RestartPolicy || p?.Config?.RestartPolicy || 'always';
			const rows = [
				[_('Name'), p?.Name || '—'],
				[_('ID'), p?.Id || p?.ID || '—'],
				[_('State'), p?.State || '—'],
				[_('Containers'), String((p?.Containers || []).length)],
				[_('Restart policy'), policyLabel(policy, p?.RestartRetries)],
				[_('Autostart semantics'), autostartSemantics(policy, p?.RestartRetries)],
				[_('Created'), formatDate(p?.Created)],
				[_('Infra container ID'), p?.InfraContainerID || '—']
			];

			for (let i = 0; i < rows.length; i++) {
				inspectSummaryBody.appendChild(E('tr', {}, [
					E('td', { 'style': 'width:34%; white-space:nowrap;' }, [ rows[i][0] ]),
					E('td', {}, [ rows[i][1] ])
				]));
			}

			const preview = pc.stringifyJsonPreview(state.inspect, pc.JSON_PREVIEW_MAX_CHARS);
			inspectRaw.textContent = preview.text;
			if (preview.truncated) {
				inspectRaw.textContent += _('\n\n[truncated: showing %s of %s characters]').format(
					String(preview.limitChars),
					String(preview.totalChars)
				);
			}
		};

		const inspectPod = async function(name) {
			state.selectedName = name;
			const result = await pc.callRpc(pc.rpc.pod.inspect, { name: name }, _('Failed to inspect pod'));
			if (!result.ok) {
				pc.notifyError(_('Inspect failed'), result.error);
				return;
			}
			state.inspect = result.data;
			renderInspect();
		};

		const executePodAction = async function(name, action, rpcMethod, argsBuilder) {
			if (!mutateGate.allowed) {
				pc.notifyError(_('Pods'), { message: mutateGate.message, code: mutateGate.code });
				return;
			}

			const args = argsBuilder ? argsBuilder(name) : { name: name };
			const result = await pc.callRpc(rpcMethod, args, _('Failed to %s pod').format(action));
			if (!result.ok) {
				pc.notifyError(_('Pod %s failed').format(action), result.error);
				return;
			}

			const suffix = action === 'stop' ? 'ped' : 'ed';
			pc.notifySuccess(_('Pod %s').format(action), _('%s %s%s').format(name, action, suffix));
			await refreshPods(name);
		};

		const renderTable = function() {
			while (tableBody.firstChild)
				tableBody.removeChild(tableBody.firstChild);

			if (!state.pods.length) {
				tableBody.appendChild(E('tr', {}, [
					E('td', { 'colspan': '7' }, [ _('No pods found') ])
				]));
				return;
			}

			state.pods.forEach((pod) => {
				const name = pod?.Name || shortId(pod?.Id || pod?.ID);
				const stateMeta = podStateMeta(pod);
				const isRunning = stateMeta.key === 'running';

				tableBody.appendChild(E('tr', {}, [
					E('td', {}, [ name ]),
					E('td', { 'style': 'font-family:monospace;' }, [ shortId(pod?.Id || pod?.ID) ]),
					E('td', {}, [ pc.renderStatusBadge(stateMeta.key, stateMeta.label) ]),
					E('td', {}, [ String(pod?.NumContainers ?? pod?.Containers?.length ?? 0) ]),
					E('td', {}, [
						E('div', {}, [ policyLabel(pod?.RestartPolicy, pod?.RestartRetries) ]),
						E('small', {}, [ autostartSemantics(pod?.RestartPolicy, pod?.RestartRetries) ])
					]),
					E('td', {}, [ formatDate(pod?.Created) ]),
					E('td', {}, [
						E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap;' }, [
							E('button', {
								'class': 'btn cbi-button',
								'click': ui.createHandlerFn(viewRef, async function() { await inspectPod(name); })
							}, [ _('Inspect') ]),
							E('button', {
								'class': 'btn cbi-button cbi-button-positive',
								'disabled': (!mutateGate.allowed || isRunning) ? 'disabled' : null,
								'click': ui.createHandlerFn(viewRef, async function() { await executePodAction(name, 'start', pc.rpc.pod.start); })
							}, [ _('Start') ]),
							E('button', {
								'class': 'btn cbi-button cbi-button-negative',
								'disabled': (!mutateGate.allowed || !isRunning) ? 'disabled' : null,
								'click': ui.createHandlerFn(viewRef, async function() {
									await executePodAction(name, 'stop', pc.rpc.pod.stop, (n) => ({ name: n, query: { timeout: 10 } }));
								})
							}, [ _('Stop') ]),
							E('button', {
								'class': 'btn cbi-button cbi-button-action',
								'disabled': mutateGate.allowed ? null : 'disabled',
								'click': ui.createHandlerFn(viewRef, async function() { await executePodAction(name, 'restart', pc.rpc.pod.restart); })
							}, [ _('Restart') ]),
							E('button', {
								'class': 'btn cbi-button cbi-button-negative important',
								'disabled': mutateGate.allowed ? null : 'disabled',
								'click': ui.createHandlerFn(viewRef, async function() {
									const ok = window.confirm(_('Remove pod %s?').format(name));
									if (!ok)
										return;
									await executePodAction(name, 'remove', pc.rpc.pod.remove, (n) => ({ name: n, query: { force: false } }));
								})
							}, [ _('Remove') ])
						])
					])
				]));
			});
		};

		const refreshPods = async function(preferredInspectName) {
			const list = await pc.callRpc(pc.rpc.pod.list, { query: { all: true } }, _('Failed to list pods'));
			if (!list.ok) {
				pc.notifyError(_('Refresh failed'), list.error);
				return;
			}

			state.pods = Array.isArray(list.data) ? list.data : [];
			renderTable();

			const target = preferredInspectName || state.selectedName;
			if (target)
				await inspectPod(target);
		};

		renderTable();
		renderInspect();

		if (state.pods.length) {
			const firstName = state.pods[0]?.Name || state.pods[0]?.Id || state.pods[0]?.ID;
			if (firstName)
				inspectPod(firstName);
		}

		return root;
	}
});
