'use strict';
'require view';
'require podman.common as pc';

function textOrDash(value) {
	if (value == null || value === '')
		return '—';
	return String(value);
}

function yesNo(value) {
	return value ? _('Yes') : _('No');
}

function isEligibleRestartPolicy(policy) {
	const normalized = String(policy || '').toLowerCase();
	return normalized === 'always' || normalized === 'unless-stopped' || normalized === 'on-failure';
}

function extractContainerRestartPolicy(container) {
	const names = [
		container?.HostConfig?.RestartPolicy?.Name,
		container?.RestartPolicy,
		container?.Config?.RestartPolicy
	];

	for (let i = 0; i < names.length; i++) {
		if (names[i])
			return String(names[i]);
	}

	return '';
}

function isStandaloneContainer(container) {
	const podId = container?.Pod || container?.PodID || container?.PodId || container?.PodName;
	return !podId;
}

function capabilityRows(capability) {
	const cap = pc.toCapabilityShape(capability || {});
	return [
		[_('System endpoints'), yesNo(cap.capabilities.system)],
		[_('Pods endpoints'), yesNo(cap.capabilities.pods)],
		[_('Containers endpoints'), yesNo(cap.capabilities.containers)],
		[_('Images endpoints'), yesNo(cap.capabilities.images)],
		[_('Networks endpoints'), yesNo(cap.capabilities.networks)],
		[_('Volumes endpoints'), yesNo(cap.capabilities.volumes)],
		[_('Events endpoints'), yesNo(cap.capabilities.events)],
		[_('Mutating actions enabled'), yesNo(cap.capabilities.mutatingEnabled)]
	];
}

function renderPairTable(title, rows) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ title ]),
		E('table', { 'class': 'table cbi-section-table' }, [
			E('tbody', {}, rows.map((row) => E('tr', {}, [
				E('td', { 'style': 'width: 38%; white-space: nowrap;' }, [ row[0] ]),
				E('td', {}, [ row[1] ])
			])))
		])
	]);
}

return view.extend({
	load: function() {
		return pc.loadSummary({ eventsQuery: { stream: false, since: '-1h' } });
	},

	render: function(summaryResult) {
		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Podman - Overview') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Podman backend status, capability contract state, API details, and workload counts are shown below.')
			])
		]);

		if (!summaryResult || !summaryResult.ok) {
			const err = summaryResult?.error || pc.normalizeError(null, _('Failed to load overview status'));
			root.appendChild(E('div', { 'class': 'alert-message warning' }, [ pc.formatUnavailable(err) ]));
			return root;
		}

		const data = summaryResult.data || {};
		const capRaw = data.capability || {};
		const cap = pc.toCapabilityShape(capRaw);
		const version = data.system?.version || {};
		const info = data.system?.info || {};
		const counts = data.counts || {};
		const pods = Array.isArray(data.resources?.pods) ? data.resources.pods : [];
		const containers = Array.isArray(data.resources?.containers) ? data.resources.containers : [];

		const restartManagedPods = pods.filter((pod) => isEligibleRestartPolicy(pod?.RestartPolicy)).length;
		const restartManagedStandaloneContainers = containers
			.filter((ctr) => isStandaloneContainer(ctr) && isEligibleRestartPolicy(extractContainerRestartPolicy(ctr)))
			.length;

		const reconciliationExpected = (restartManagedPods + restartManagedStandaloneContainers) > 0;
		const autostartEnabled = cap.healthy && cap.supported;

		const healthRows = [
			[_('Backend engine'), textOrDash(capRaw.engine || 'podman')],
			[_('Backend socket'), textOrDash(capRaw.socket)],
			[_('Service/API health'), pc.renderStatusBadge(cap.healthy ? 'running' : 'error', cap.healthy ? _('Healthy') : _('Unavailable'))],
			[_('Contract support'), pc.renderStatusBadge(cap.supported ? 'running' : 'warning', cap.supported ? _('Supported') : _('Unsupported'))],
			[_('Version drift'), textOrDash(cap.drift)],
			[_('OpenWrt reconciliation active'), autostartEnabled ? _('Enabled (service reachable and supported)') : _('Disabled/Unavailable')],
			[_('OpenWrt reconciliation expected'), reconciliationExpected ? _('Yes (restart-managed workloads detected)') : _('No (no restart-managed workloads detected)')]
		];

		const apiRows = [
			[_('Podman version'), textOrDash(version?.Version || version?.version || info?.Version)],
			[_('Libpod API version (probe)'), textOrDash(capRaw.libpodApiVersion)],
			[_('API path version in use'), textOrDash(capRaw.apiPathVersion)],
			[_('Contract floor'), textOrDash(capRaw.floor)],
			[_('GO OS/Arch'), textOrDash((version?.GoOs || info?.Host?.OS || '') + ' / ' + (version?.GoArch || info?.Host?.Arch || ''))],
			[_('Rootless mode'), yesNo(!!info?.Host?.Security?.Rootless)],
			[_('Events snapshot size'), String(counts.events || 0)]
		];

		const resourceRows = [
			[_('Pods'), String(counts.pods || 0)],
			[_('Containers'), String(counts.containers || 0)],
			[_('Images'), String(counts.images || 0)],
			[_('Networks'), String(counts.networks || 0)],
			[_('Volumes'), String(counts.volumes || 0)],
			[_('Events'), String(counts.events || 0)],
			[_('Restart-managed pods'), String(restartManagedPods)],
			[_('Restart-managed standalone containers'), String(restartManagedStandaloneContainers)]
		];

		root.appendChild(renderPairTable(_('Backend status'), healthRows));
		root.appendChild(renderPairTable(_('Version and API'), apiRows));
		root.appendChild(renderPairTable(_('Resource counts'), resourceRows));
		root.appendChild(renderPairTable(_('Capability summary'), capabilityRows(capRaw)));

		const errors = data.errors || {};
		const failedParts = Object.keys(errors).filter((key) => !!errors[key]);
		if (failedParts.length) {
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Partial data warnings') ]),
				E('ul', {}, failedParts.map((key) => E('li', {}, [
					_('%s: %s').format(key, pc.formatUnavailable(errors[key]))
				])))
			]));
		}

		return root;
	}
});
