'use strict';
'require view';
'require ui';
'require podman.common as podman';

return view.extend({
	title: _('Podman - Volumes'),

	isValidName: function(value) {
		const name = String(value || '').trim();
		if (!name)
			return true;
		return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name);
	},

	isValidDriver: function(value) {
		const driver = String(value || '').trim();
		if (!driver)
			return true;
		return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/.test(driver);
	},

	parseLabels: function(value) {
		const raw = String(value || '').trim();
		if (!raw)
			return { ok: true, value: {} };

		const out = {};
		const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
		for (let i = 0; i < parts.length; i++) {
			const idx = parts[i].indexOf('=');
			if (idx <= 0)
				return { ok: false, error: _('Labels must use key=value format') };

			const key = parts[i].slice(0, idx).trim();
			const val = parts[i].slice(idx + 1).trim();
			if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(key))
				return { ok: false, error: _('Label key is malformed') };

			out[key] = val;
		}

		return { ok: true, value: out };
	},

	normalizeVolumes: function(payload) {
		if (Array.isArray(payload))
			return payload;
		if (Array.isArray(payload?.Volumes))
			return payload.Volumes;
		return [];
	},

	showJsonModal: function(title, payload) {
		const preview = podman.stringifyJsonPreview(payload || {}, podman.JSON_PREVIEW_MAX_CHARS);
		const text = preview.truncated
			? `${preview.text}\n\n${_('[truncated: showing %s of %s characters]').format(String(preview.limitChars), String(preview.totalChars))}`
			: preview.text;
		ui.showModal(title, [
			E('pre', { 'style': 'max-height: 60vh; overflow: auto; white-space: pre-wrap;' }, [ text ]),
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
		const readGate = podman.gateAction(capability, { resource: 'volumes' });
		if (!readGate.allowed) {
			return E('div', { 'class': 'cbi-map' }, [
				E('h2', {}, [ this.title ]),
				E('div', { 'class': 'cbi-section warning' }, [ E('p', {}, [ podman.formatUnavailable(readGate) ]) ])
			]);
		}

		const mutateGate = podman.gateAction(capability, { resource: 'volumes', mutating: true });
		const canMutate = mutateGate.allowed;

		const root = E('div', { 'class': 'cbi-map' });
		root.appendChild(E('h2', {}, [ this.title ]));
		root.appendChild(E('div', { 'class': 'cbi-map-descr' }, [
			_('Manage Podman volumes with create, inspect, remove, and prune workflows.')
		]));

		if (!canMutate)
			root.appendChild(E('div', { 'class': 'cbi-section warning' }, [ E('p', {}, [ podman.formatUnavailable(mutateGate) ]) ]));

		let volumes = [];

		const createSection = E('div', { 'class': 'cbi-section' });
		const nameInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': _('Optional volume name') });
		const driverInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'local' });
		const labelsInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'env=dev,owner=ops' });

		const createButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const name = String(nameInput.value || '').trim();
				const driver = String(driverInput.value || '').trim();

				if (!view.isValidName(name)) {
					podman.notifyError(view.title, { code: 'INVALID_VOLUME_NAME', message: _('Volume name is malformed'), details: { name: name } });
					return;
				}
				if (!view.isValidDriver(driver)) {
					podman.notifyError(view.title, { code: 'INVALID_DRIVER', message: _('Volume driver is malformed'), details: { driver: driver } });
					return;
				}

				const labels = view.parseLabels(labelsInput.value);
				if (!labels.ok) {
					podman.notifyError(view.title, { code: 'INVALID_LABELS', message: labels.error, details: {} });
					return;
				}

				const gate = podman.gateAction(capability, { resource: 'volumes', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const result = await podman.callRpc(
					podman.rpc.volume.create,
					{ body: { Name: name || undefined, Driver: driver || undefined, Labels: labels.value } },
					_('Failed to create volume')
				);

				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Volume created'));
				nameInput.value = '';
				labelsInput.value = '';
				await refreshVolumes();
			})
		}, [ _('Create volume') ]);

		const pruneButton = E('button', {
			'class': 'cbi-button cbi-button-negative',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const gate = podman.gateAction(capability, { resource: 'volumes', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const result = await podman.callRpc(podman.rpc.volume.prune, null, _('Failed to prune volumes'));
				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Volume prune completed'));
				await refreshVolumes();
			})
		}, [ _('Prune volumes') ]);

		createSection.appendChild(E('h3', {}, [ _('Create volume') ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Name') ]), E('div', { 'class': 'cbi-value-field' }, [ nameInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Driver') ]), E('div', { 'class': 'cbi-value-field' }, [ driverInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, [ _('Labels') ]), E('div', { 'class': 'cbi-value-field' }, [ labelsInput ]) ]));
		createSection.appendChild(E('div', { 'class': 'right' }, [ createButton, ' ', pruneButton ]));
		root.appendChild(createSection);

		const listSection = E('div', { 'class': 'cbi-section' });
		const searchInput = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': _('Filter by name, mountpoint, or driver') });
		const tableBody = E('tbody', {});
		const statusLine = E('p', { 'class': 'cbi-value-description' }, []);

		const renderRows = function() {
			const query = String(searchInput.value || '').trim().toLowerCase();
			const filtered = volumes.filter((vol) => {
				if (!query)
					return true;
				return String(vol.Name || '').toLowerCase().includes(query) ||
					String(vol.Mountpoint || '').toLowerCase().includes(query) ||
					String(vol.Driver || '').toLowerCase().includes(query);
			});

			while (tableBody.firstChild)
				tableBody.removeChild(tableBody.firstChild);

			if (!filtered.length) {
				tableBody.appendChild(E('tr', {}, [ E('td', { 'colspan': '6' }, [ _('No volumes match current filter') ]) ]));
				statusLine.textContent = _('Showing 0 volumes');
				return;
			}

			filtered.forEach((vol) => {
				const name = String(vol.Name || '').trim();
				const labels = vol?.Labels && typeof vol.Labels === 'object' ? Object.keys(vol.Labels).length : 0;

				const inspectBtn = E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, async function() {
						const result = await podman.callRpc(podman.rpc.volume.inspect, { name: name }, _('Failed to inspect volume'));
						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}
						view.showJsonModal(_('Volume inspect'), result.data);
					})
				}, [ _('Inspect') ]);

				const removeBtn = E('button', {
					'class': 'cbi-button cbi-button-negative',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, function() {
						view.showRemoveModal(name, capability, refreshVolumes);
					})
				}, [ _('Remove') ]);

				tableBody.appendChild(E('tr', {}, [
					E('td', {}, [ name || '-' ]),
					E('td', {}, [ vol.Driver || '-' ]),
					E('td', {}, [ vol.Mountpoint || '-' ]),
					E('td', {}, [ String(labels) ]),
					E('td', {}, [ vol.CreatedAt || '-' ]),
					E('td', { 'class': 'cbi-section-actions' }, [ inspectBtn, ' ', removeBtn ])
				]));
			});

			statusLine.textContent = _('Showing %s volume(s)').format(String(filtered.length));
		};

		const refreshVolumes = async function() {
			const result = await podman.callRpc(podman.rpc.volume.list, { query: {} }, _('Failed to list volumes'));
			if (!result.ok) {
				podman.notifyError(view.title, result.error);
				volumes = [];
				renderRows();
				return;
			}

			volumes = view.normalizeVolumes(result.data);
			renderRows();
		};

		listSection.appendChild(E('h3', {}, [ _('Volume inventory') ]));
		listSection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Search') ]),
			E('div', { 'class': 'cbi-value-field' }, [
				searchInput,
				' ',
				E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, renderRows) }, [ _('Apply') ]),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, function() { searchInput.value = ''; renderRows(); }) }, [ _('Clear') ]),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, refreshVolumes) }, [ _('Refresh') ])
			])
		]));

		listSection.appendChild(E('table', { 'class': 'table cbi-section-table' }, [
			E('thead', {}, [ E('tr', {}, [
				E('th', {}, [ _('Name') ]),
				E('th', {}, [ _('Driver') ]),
				E('th', {}, [ _('Mountpoint') ]),
				E('th', {}, [ _('Labels') ]),
				E('th', {}, [ _('Created') ]),
				E('th', {}, [ _('Actions') ])
			]) ]),
			tableBody
		]));

		listSection.appendChild(statusLine);
		root.appendChild(listSection);

		await refreshVolumes();
		return root;
	},

	showRemoveModal: function(name, capability, refreshVolumes) {
		const view = this;
		const forceInput = E('input', { 'type': 'checkbox' });

		ui.showModal(_('Remove volume'), [
			E('p', {}, [ _('Remove volume "%s"').format(name) ]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Force') ]),
				E('div', { 'class': 'cbi-value-field' }, [ forceInput ])
			]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, async function() {
						const gate = podman.gateAction(capability, { resource: 'volumes', mutating: true });
						if (!gate.allowed) {
							podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
							return;
						}

						if (!view.isValidName(name)) {
							podman.notifyError(view.title, { code: 'INVALID_VOLUME_NAME', message: _('Volume name is malformed'), details: { name: name } });
							return;
						}

						const result = await podman.callRpc(
							podman.rpc.volume.remove,
							{ name: name, query: { force: forceInput.checked === true } },
							_('Failed to remove volume')
						);

						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						ui.hideModal();
						podman.notifySuccess(view.title, _('Volume removed'));
						await refreshVolumes();
					})
				}, [ _('Remove') ])
			])
		]);
	}
});
