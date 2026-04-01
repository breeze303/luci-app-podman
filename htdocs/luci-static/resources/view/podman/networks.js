'use strict';
'require view';
'require ui';
'require podman.common as podman';

return view.extend({
	title: _('Podman - Networks'),

	isValidName: function(value) {
		const name = String(value || '').trim();
		return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name);
	},

	isValidDriver: function(value) {
		const driver = String(value || '').trim();
		if (!driver)
			return true;
		return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(driver);
	},

	isValidCidr: function(value) {
		const cidr = String(value || '').trim();
		if (!cidr)
			return true;
		return /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(cidr);
	},

	parseLabels: function(value) {
		const raw = String(value || '').trim();
		if (!raw)
			return { ok: true, value: {} };

		const out = {};
		const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
		for (let i = 0; i < entries.length; i++) {
			const idx = entries[i].indexOf('=');
			if (idx <= 0)
				return { ok: false, error: _('Labels must use key=value format') };

			const key = entries[i].slice(0, idx).trim();
			const val = entries[i].slice(idx + 1).trim();
			if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key))
				return { ok: false, error: _('Label key is malformed') };

			out[key] = val;
		}

		return { ok: true, value: out };
	},

	normalizeNetworks: function(payload) {
		return Array.isArray(payload) ? payload : [];
	},

	normalizeContainers: function(payload) {
		return Array.isArray(payload) ? payload : [];
	},

	showJsonModal: function(title, payload) {
		const preview = podman.stringifyJsonPreview(payload || {}, podman.JSON_PREVIEW_MAX_CHARS);
		const text = preview.truncated
			? `${preview.text}\n\n${_('[truncated: showing %s of %s characters]').format(String(preview.limitChars), String(preview.totalChars))}`
			: preview.text;
		ui.showModal(title, [
			E('pre', { 'style': 'max-height: 60vh; overflow: auto; white-space: pre-wrap;' }, [
				text
			]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': ui.hideModal }, [ _('Close') ])
			])
		]);
	},

	render: async function() {
		const view = this;
		const capResult = await podman.loadCapability(false);
		if (!capResult.ok) {
			return E('div', { 'class': 'cbi-map' }, [
				E('h2', {}, [ this.title ]),
				E('div', { 'class': 'cbi-section warning' }, [ E('p', {}, [ podman.formatUnavailable(capResult.error) ]) ])
			]);
		}

		const capability = podman.toCapabilityShape(capResult.data);
		const readGate = podman.gateAction(capability, { resource: 'networks' });
		if (!readGate.allowed) {
			return E('div', { 'class': 'cbi-map' }, [
				E('h2', {}, [ this.title ]),
				E('div', { 'class': 'cbi-section warning' }, [ E('p', {}, [ podman.formatUnavailable(readGate) ]) ])
			]);
		}

		const mutateGate = podman.gateAction(capability, { resource: 'networks', mutating: true });
		const canMutate = mutateGate.allowed;

		const root = E('div', { 'class': 'cbi-map' });
		root.appendChild(E('h2', {}, [ this.title ]));
		root.appendChild(E('div', { 'class': 'cbi-map-descr' }, [
			_('Manage Podman network inventory with create, inspect, connect, disconnect, remove, and prune workflows.')
		]));

		if (!canMutate) {
			root.appendChild(E('div', { 'class': 'cbi-section warning' }, [ E('p', {}, [ podman.formatUnavailable(mutateGate) ]) ]));
		}

		let networks = [];
		let containers = [];

		const createSection = E('div', { 'class': 'cbi-section' });
		const nameInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'podman-net' });
		const driverInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'bridge' });
		const subnetInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': '10.99.0.0/24' });
		const gatewayInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': '10.99.0.1' });
		const labelsInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'env=dev,team=netops' });
		const internalInput = E('input', { 'type': 'checkbox' });
		const ipv6Input = E('input', { 'type': 'checkbox' });
		const pruneButton = E('button', {
			'class': 'cbi-button cbi-button-negative',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const gate = podman.gateAction(capability, { resource: 'networks', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const result = await podman.callRpc(podman.rpc.network.prune, null, _('Failed to prune networks'));
				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Network prune completed'));
				await refreshData();
			})
		}, [ _('Prune networks') ]);

		const createButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const name = String(nameInput.value || '').trim();
				const driver = String(driverInput.value || '').trim();
				const subnet = String(subnetInput.value || '').trim();
				const gateway = String(gatewayInput.value || '').trim();

				if (!view.isValidName(name)) {
					podman.notifyError(view.title, { code: 'INVALID_NETWORK_NAME', message: _('Network name is malformed'), details: { name: name } });
					return;
				}
				if (!view.isValidDriver(driver)) {
					podman.notifyError(view.title, { code: 'INVALID_DRIVER', message: _('Network driver is malformed'), details: { driver: driver } });
					return;
				}
				if (!view.isValidCidr(subnet)) {
					podman.notifyError(view.title, { code: 'INVALID_SUBNET', message: _('Subnet must use CIDR notation'), details: { subnet: subnet } });
					return;
				}
				if (gateway && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(gateway)) {
					podman.notifyError(view.title, { code: 'INVALID_GATEWAY', message: _('Gateway must be an IPv4 address'), details: { gateway: gateway } });
					return;
				}

				const labels = view.parseLabels(labelsInput.value);
				if (!labels.ok) {
					podman.notifyError(view.title, { code: 'INVALID_LABELS', message: labels.error, details: {} });
					return;
				}

				const gate = podman.gateAction(capability, { resource: 'networks', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const body = {
					Name: name,
					Driver: driver || undefined,
					Internal: internalInput.checked === true,
					IPv6: ipv6Input.checked === true,
					Labels: labels.value
				};

				if (subnet || gateway)
					body.Subnets = [ { Subnet: subnet || undefined, Gateway: gateway || undefined } ];

				const result = await podman.callRpc(
					podman.rpc.network.create,
					{ body: body },
					_('Failed to create network')
				);

				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Network created'));
				nameInput.value = '';
				subnetInput.value = '';
				gatewayInput.value = '';
				labelsInput.value = '';
				await refreshData();
			})
		}, [ _('Create network') ]);

		createSection.appendChild(E('h3', {}, [ _('Create network') ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Name') ]), E('div', { 'class': 'cbi-value-field' }, [ nameInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Driver') ]), E('div', { 'class': 'cbi-value-field' }, [ driverInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Subnet') ]), E('div', { 'class': 'cbi-value-field' }, [ subnetInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Gateway') ]), E('div', { 'class': 'cbi-value-field' }, [ gatewayInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Labels') ]), E('div', { 'class': 'cbi-value-field' }, [ labelsInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Internal') ]), E('div', { 'class': 'cbi-value-field' }, [ internalInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Enable IPv6') ]), E('div', { 'class': 'cbi-value-field' }, [ ipv6Input ]) ]));
		createSection.appendChild(E('div', { 'class': 'right' }, [ createButton, ' ', pruneButton ]));
		root.appendChild(createSection);

		const listSection = E('div', { 'class': 'cbi-section' });
		const searchInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': _('Filter by name, id, or driver') });
		const tableBody = E('tbody', {});
		const statusLine = E('p', { 'class': 'cbi-value-description' }, []);

		const renderRows = function() {
			const query = String(searchInput.value || '').trim().toLowerCase();
			const filtered = networks.filter((net) => {
				if (!query)
					return true;
				return String(net.Name || '').toLowerCase().includes(query) ||
					String(net.Id || '').toLowerCase().includes(query) ||
					String(net.Driver || '').toLowerCase().includes(query);
			});

			while (tableBody.firstChild)
				tableBody.removeChild(tableBody.firstChild);

			if (!filtered.length) {
				tableBody.appendChild(E('tr', {}, [ E('td', { 'colspan': '7' }, [ _('No networks match current filter') ]) ]));
				statusLine.textContent = _('Showing 0 networks');
				return;
			}

			filtered.forEach((net) => {
				const networkName = String(net.Name || '').trim();
				const shortId = String(net.Id || '').slice(0, 12) || '-';
				const subnets = Array.isArray(net?.Subnets) ? net.Subnets.map((s) => s?.Subnet || '').filter(Boolean).join(', ') : '-';
				const connectedCount = net?.Containers && typeof net.Containers === 'object' ? Object.keys(net.Containers).length : 0;

				const inspectBtn = E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, async function() {
						const result = await podman.callRpc(podman.rpc.network.inspect, { name: networkName }, _('Failed to inspect network'));
						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}
						view.showJsonModal(_('Network inspect'), result.data);
					})
				}, [ _('Inspect') ]);

				const connectBtn = E('button', {
					'class': 'cbi-button cbi-button-action',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, function() {
						view.showConnectModal(networkName, containers, capability, refreshData);
					})
				}, [ _('Connect') ]);

				const disconnectBtn = E('button', {
					'class': 'cbi-button cbi-button-action',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, function() {
						view.showDisconnectModal(networkName, containers, capability, refreshData);
					})
				}, [ _('Disconnect') ]);

				const removeBtn = E('button', {
					'class': 'cbi-button cbi-button-negative',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, async function() {
						const gate = podman.gateAction(capability, { resource: 'networks', mutating: true });
						if (!gate.allowed) {
							podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
							return;
						}

						if (!view.isValidName(networkName)) {
							podman.notifyError(view.title, { code: 'INVALID_NETWORK_NAME', message: _('Network name is malformed'), details: { name: networkName } });
							return;
						}

						if (!confirm(_('Remove network "%s"?').format(networkName)))
							return;

						const result = await podman.callRpc(podman.rpc.network.remove, { name: networkName }, _('Failed to remove network'));
						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						podman.notifySuccess(view.title, _('Network removed'));
						await refreshData();
					})
				}, [ _('Remove') ]);

				tableBody.appendChild(E('tr', {}, [
					E('td', {}, [ networkName || '-' ]),
					E('td', {}, [ shortId ]),
					E('td', {}, [ net.Driver || '-' ]),
					E('td', {}, [ net.NetworkInterface || '-' ]),
					E('td', {}, [ subnets ]),
					E('td', {}, [ String(connectedCount) ]),
					E('td', { 'class': 'cbi-section-actions' }, [ inspectBtn, ' ', connectBtn, ' ', disconnectBtn, ' ', removeBtn ])
				]));
			});

			statusLine.textContent = _('Showing %s network(s)').format(String(filtered.length));
		};

		const refreshData = async function() {
			const [ netResult, ctrResult ] = await Promise.all([
				podman.callRpc(podman.rpc.network.list, { query: {} }, _('Failed to list networks')),
				podman.callRpc(podman.rpc.container.list, { query: { all: true } }, _('Failed to list containers'))
			]);

			if (!netResult.ok) {
				podman.notifyError(view.title, netResult.error);
				networks = [];
			}
			else {
				networks = view.normalizeNetworks(netResult.data);
			}

			if (!ctrResult.ok) {
				podman.notifyError(view.title, ctrResult.error);
				containers = [];
			}
			else {
				containers = view.normalizeContainers(ctrResult.data);
			}

			renderRows();
		};

		listSection.appendChild(E('h3', {}, [ _('Network inventory') ]));
		listSection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Search') ]),
			E('div', { 'class': 'cbi-value-field' }, [
				searchInput,
				' ',
				E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, renderRows) }, [ _('Apply') ]),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, function() { searchInput.value = ''; renderRows(); }) }, [ _('Clear') ]),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, refreshData) }, [ _('Refresh') ])
			])
		]));

		listSection.appendChild(E('table', { 'class': 'table cbi-section-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Name') ]),
				E('th', {}, [ _('ID') ]),
				E('th', {}, [ _('Driver') ]),
				E('th', {}, [ _('Interface') ]),
				E('th', {}, [ _('Subnets') ]),
				E('th', {}, [ _('Containers') ]),
				E('th', {}, [ _('Actions') ])
			]) ]),
			tableBody
		]));
		listSection.appendChild(statusLine);
		root.appendChild(listSection);

		await refreshData();
		return root;
	},

	showConnectModal: function(networkName, containers, capability, refreshData) {
		const view = this;
		const select = E('select', { 'class': 'cbi-input-select' });
		const aliasInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'web,db' });

		const options = Array.isArray(containers) ? containers : [];
		select.appendChild(E('option', { 'value': '' }, [ _('Select container') ]));
		options.forEach((ctr) => {
			const id = String(ctr?.Id || '').trim();
			const name = Array.isArray(ctr?.Names) && ctr.Names.length ? ctr.Names[0].replace(/^\//, '') : id.slice(0, 12);
			if (!id)
				return;
			select.appendChild(E('option', { 'value': id }, [ `${name} (${id.slice(0, 12)})` ]));
		});

		ui.showModal(_('Connect container'), [
			E('p', {}, [ _('Connect a container to network "%s"').format(networkName) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Container') ]), E('div', { 'class': 'cbi-value-field' }, [ select ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Aliases') ]), E('div', { 'class': 'cbi-value-field' }, [ aliasInput ]) ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': ui.createHandlerFn(this, async function() {
						const gate = podman.gateAction(capability, { resource: 'networks', mutating: true });
						if (!gate.allowed) {
							podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
							return;
						}

						const container = String(select.value || '').trim();
						if (!container) {
							podman.notifyError(view.title, { code: 'INVALID_CONTAINER', message: _('Container selection is required'), details: {} });
							return;
						}

						const aliases = String(aliasInput.value || '').split(',').map((s) => s.trim()).filter(Boolean);
						const result = await podman.callRpc(
							podman.rpc.network.connect,
							{ name: networkName, body: { Container: container, Aliases: aliases } },
							_('Failed to connect container to network')
						);

						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						ui.hideModal();
						podman.notifySuccess(view.title, _('Container connected to network'));
						await refreshData();
					})
				}, [ _('Connect') ])
			])
		]);
	},

	showDisconnectModal: function(networkName, containers, capability, refreshData) {
		const view = this;
		const select = E('select', { 'class': 'cbi-input-select' });
		const forceInput = E('input', { 'type': 'checkbox' });

		const options = Array.isArray(containers) ? containers : [];
		select.appendChild(E('option', { 'value': '' }, [ _('Select container') ]));
		options.forEach((ctr) => {
			const id = String(ctr?.Id || '').trim();
			const name = Array.isArray(ctr?.Names) && ctr.Names.length ? ctr.Names[0].replace(/^\//, '') : id.slice(0, 12);
			if (!id)
				return;
			select.appendChild(E('option', { 'value': id }, [ `${name} (${id.slice(0, 12)})` ]));
		});

		ui.showModal(_('Disconnect container'), [
			E('p', {}, [ _('Disconnect a container from network "%s"').format(networkName) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Container') ]), E('div', { 'class': 'cbi-value-field' }, [ select ]) ]),
			E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Force') ]), E('div', { 'class': 'cbi-value-field' }, [ forceInput ]) ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-positive',
					'click': ui.createHandlerFn(this, async function() {
						const gate = podman.gateAction(capability, { resource: 'networks', mutating: true });
						if (!gate.allowed) {
							podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
							return;
						}

						const container = String(select.value || '').trim();
						if (!container) {
							podman.notifyError(view.title, { code: 'INVALID_CONTAINER', message: _('Container selection is required'), details: {} });
							return;
						}

						const result = await podman.callRpc(
							podman.rpc.network.disconnect,
							{ name: networkName, body: { Container: container }, query: { force: forceInput.checked === true } },
							_('Failed to disconnect container from network')
						);

						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						ui.hideModal();
						podman.notifySuccess(view.title, _('Container disconnected from network'));
						await refreshData();
					})
				}, [ _('Disconnect') ])
			])
		]);
	}
});
