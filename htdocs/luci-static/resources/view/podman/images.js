'use strict';
'require view';
'require ui';
'require podman.common as podman';

return view.extend({
	title: _('Podman - Images'),

	formatSize: function(value) {
		const size = Number(value) || 0;
		if (size <= 0)
			return '0 B';

		const units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
		let idx = 0;
		let n = size;
		while (n >= 1024 && idx < units.length - 1) {
			n /= 1024;
			idx++;
		}

		return `${n.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
	},

	formatCreated: function(value) {
		const ts = Number(value) || 0;
		if (ts <= 0)
			return '-';
		return new Date(ts * 1000).toLocaleString();
	},

	isValidImageReference: function(value) {
		const ref = String(value || '').trim();
		if (!ref || ref.length > 255)
			return false;
		if (/\s/.test(ref))
			return false;
		return /^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/.test(ref);
	},

	firstUsableReference: function(image) {
		const tags = Array.isArray(image?.RepoTags) ? image.RepoTags.filter((t) => t && t !== '<none>:<none>') : [];
		if (tags.length)
			return tags[0];

		const digests = Array.isArray(image?.RepoDigests) ? image.RepoDigests.filter((d) => d) : [];
		if (digests.length)
			return digests[0];

		return image?.Id || '';
	},

	normalizeImages: function(payload) {
		return Array.isArray(payload) ? payload : [];
	},

	normalizeSearchResults: function(payload) {
		return Array.isArray(payload) ? payload : [];
	},

	showJsonModal: function(title, payload) {
		const preview = podman.stringifyJsonPreview(payload || {}, podman.JSON_PREVIEW_MAX_CHARS);
		const content = preview.truncated
			? `${preview.text}\n\n${_('[truncated: showing %s of %s characters]').format(String(preview.limitChars), String(preview.totalChars))}`
			: preview.text;
		ui.showModal(title, [
			E('pre', {
				'style': 'max-height: 60vh; overflow: auto; white-space: pre-wrap;'
			}, [ content ]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.hideModal
				}, [ _('Close') ])
			])
		]);
	},

	render: async function() {
		const view = this;
		const capResult = await podman.loadCapability(false);
		if (!capResult.ok) {
			return E('div', { 'class': 'cbi-map' }, [
				E('h2', {}, [ this.title ]),
				E('div', { 'class': 'cbi-section warning' }, [
					E('p', {}, [ podman.formatUnavailable(capResult.error) ])
				])
			]);
		}

		const capability = podman.toCapabilityShape(capResult.data);
		const readGate = podman.gateAction(capability, { resource: 'images' });
		if (!readGate.allowed) {
			return E('div', { 'class': 'cbi-map' }, [
				E('h2', {}, [ this.title ]),
				E('div', { 'class': 'cbi-section warning' }, [
					E('p', {}, [ podman.formatUnavailable(readGate) ])
				])
			]);
		}

		const mutateGate = podman.gateAction(capability, { resource: 'images', mutating: true });
		const canMutate = mutateGate.allowed;

		const root = E('div', { 'class': 'cbi-map' });
		root.appendChild(E('h2', {}, [ this.title ]));
		root.appendChild(E('div', { 'class': 'cbi-map-descr' }, [
			_('List and inspect local images, pull by reference, remove selected images, and prune unused image data.'),
			E('br'),
			_('Includes local inventory filtering and registry search via Podman image search endpoint.')
		]));

		if (!canMutate) {
			root.appendChild(E('div', { 'class': 'cbi-section warning' }, [
				E('p', {}, [ podman.formatUnavailable(mutateGate) ])
			]));
		}

		const actions = E('div', { 'class': 'cbi-section' });
		const pullReference = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': 'docker.io/library/alpine:latest'
		});
		const pullAllTags = E('input', { 'type': 'checkbox' });
		const pruneAll = E('input', { 'type': 'checkbox' });

		actions.appendChild(E('h3', {}, [ _('Image actions') ]));
		actions.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Pull reference') ]),
			E('div', { 'class': 'cbi-value-field' }, [ pullReference ])
		]));
		actions.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('All tags') ]),
			E('div', { 'class': 'cbi-value-field' }, [ pullAllTags ])
		]));
		actions.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Prune all images') ]),
			E('div', { 'class': 'cbi-value-field' }, [ pruneAll ])
		]));

		const pullButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const reference = String(pullReference.value || '').trim();
				if (!view.isValidImageReference(reference)) {
					podman.notifyError(view.title, {
						code: 'INVALID_IMAGE_REFERENCE',
						message: _('Image reference is malformed'),
						details: { reference: reference }
					});
					return;
				}

				const gate = podman.gateAction(capability, { resource: 'images', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const result = await podman.callRpc(
					podman.rpc.image.pull,
					{ query: { reference: reference, allTags: pullAllTags.checked === true } },
					_('Failed to pull image')
				);

				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Image pull completed'));
				await refreshList();
			})
		}, [ _('Pull image') ]);

		const pruneButton = E('button', {
			'class': 'cbi-button cbi-button-negative',
			'disabled': !canMutate,
			'click': ui.createHandlerFn(this, async function() {
				const gate = podman.gateAction(capability, { resource: 'images', mutating: true });
				if (!gate.allowed) {
					podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
					return;
				}

				const result = await podman.callRpc(
					podman.rpc.image.prune,
					{ query: { all: pruneAll.checked === true } },
					_('Failed to prune images')
				);

				if (!result.ok) {
					podman.notifyError(view.title, result.error);
					return;
				}

				podman.notifySuccess(view.title, _('Image prune completed'));
				await refreshList();
			})
		}, [ _('Prune images') ]);

		actions.appendChild(E('div', { 'class': 'right' }, [ pullButton, ' ', pruneButton ]));
		root.appendChild(actions);

		const listSection = E('div', { 'class': 'cbi-section' });
		const registrySection = E('div', { 'class': 'cbi-section' });
		const registrySearchTerm = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('docker.io/library/alpine')
		});
		const registrySearchLimit = E('input', {
			'class': 'cbi-input-text',
			'type': 'number',
			'min': '1',
			'max': '100',
			'value': '25'
		});
		const registryListTags = E('input', { 'type': 'checkbox' });
		const registryTlsVerify = E('input', { 'type': 'checkbox', 'checked': true });
		const registryTableBody = E('tbody', {});
		const registryStatusLine = E('p', { 'class': 'cbi-value-description' }, []);
		const searchInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': _('Filter by tag, digest, or id')
		});
		const tableBody = E('tbody', {});
		const statusLine = E('p', { 'class': 'cbi-value-description' }, []);

		let images = [];
		let registryResults = [];

		const renderRegistryRows = function() {
			while (registryTableBody.firstChild)
				registryTableBody.removeChild(registryTableBody.firstChild);

			if (!registryResults.length) {
				registryTableBody.appendChild(E('tr', {}, [
					E('td', { 'colspan': '6' }, [ _('No registry results') ])
				]));
				registryStatusLine.textContent = _('Showing 0 search result(s)');
				return;
			}

			registryResults.forEach((item) => {
				const name = String(item.Name || item.name || '-');
				const description = String(item.Description || item.description || '-');
				const stars = Number(item.StarCount || item.Stars || item.stars || 0) || 0;
				const official = item.IsOfficial === true || item.Official === true || item.official === true;
				const automated = item.IsAutomated === true || item.Automated === true || item.automated === true;

				const pullBtn = E('button', {
					'class': 'cbi-button cbi-button-action',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, function() {
						if (!name || name === '-') {
							podman.notifyError(view.title, {
								code: 'INVALID_IMAGE_REFERENCE',
								message: _('Selected search result has no pullable image reference'),
								details: { item: item }
							});
							return;
						}

						pullReference.value = name;
					})
				}, [ _('Use for pull') ]);

				registryTableBody.appendChild(E('tr', {}, [
					E('td', {}, [ name ]),
					E('td', {}, [ description ]),
					E('td', {}, [ String(stars) ]),
					E('td', {}, [ official ? _('Yes') : _('No') ]),
					E('td', {}, [ automated ? _('Yes') : _('No') ]),
					E('td', { 'class': 'cbi-section-actions' }, [ pullBtn ])
				]));
			});

			registryStatusLine.textContent = _('Showing %s search result(s)').format(String(registryResults.length));
		};

		const renderRows = function() {
			const query = String(searchInput.value || '').trim().toLowerCase();
			const filtered = images.filter((img) => {
				if (!query)
					return true;
				const tags = (img.RepoTags || []).join(' ').toLowerCase();
				const digests = (img.RepoDigests || []).join(' ').toLowerCase();
				const id = String(img.Id || '').toLowerCase();
				return tags.includes(query) || digests.includes(query) || id.includes(query);
			});

			while (tableBody.firstChild)
				tableBody.removeChild(tableBody.firstChild);
			if (!filtered.length) {
				tableBody.appendChild(E('tr', {}, [
					E('td', { 'colspan': '6' }, [ _('No images match current filter') ])
				]));
				statusLine.textContent = _('Showing 0 images');
				return;
			}

			filtered.forEach((img) => {
				const reference = view.firstUsableReference(img);
				const tags = Array.isArray(img.RepoTags) && img.RepoTags.length ? img.RepoTags.join(', ') : '-';
				const shortId = String(img.Id || '').replace(/^sha256:/, '').slice(0, 12) || '-';

				const inspectBtn = E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, async function() {
						const result = await podman.callRpc(
							podman.rpc.image.inspect,
							{ name: reference },
							_('Failed to inspect image')
						);

						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						view.showJsonModal(_('Image inspect'), result.data);
					})
				}, [ _('Inspect') ]);

				const removeBtn = E('button', {
					'class': 'cbi-button cbi-button-negative',
					'disabled': !canMutate,
					'click': ui.createHandlerFn(this, async function() {
						if (!reference) {
							podman.notifyError(view.title, {
								code: 'INVALID_IMAGE_REFERENCE',
								message: _('Unable to derive removable image reference'),
								details: { imageId: img.Id || '' }
							});
							return;
						}

						const gate = podman.gateAction(capability, { resource: 'images', mutating: true });
						if (!gate.allowed) {
							podman.notifyError(view.title, { code: gate.code, message: gate.message, details: {} });
							return;
						}

						if (!confirm(_('Remove image "%s"?').format(reference)))
							return;

						const result = await podman.callRpc(
							podman.rpc.image.remove,
							{ name: reference, query: { force: false, ignore: true } },
							_('Failed to remove image')
						);

						if (!result.ok) {
							podman.notifyError(view.title, result.error);
							return;
						}

						podman.notifySuccess(view.title, _('Image removed'));
						await refreshList();
					})
				}, [ _('Remove') ]);

				tableBody.appendChild(E('tr', {}, [
					E('td', {}, [ tags ]),
					E('td', {}, [ shortId ]),
					E('td', {}, [ view.formatCreated(img.Created) ]),
					E('td', {}, [ view.formatSize(img.Size) ]),
					E('td', {}, [ (img.RepoDigests || []).slice(0, 1).join('') || '-' ]),
					E('td', { 'class': 'cbi-section-actions' }, [ inspectBtn, ' ', removeBtn ])
				]));
			});

			statusLine.textContent = _('Showing %s image(s)').format(String(filtered.length));
		};

		const refreshList = async function() {
			const listResult = await podman.callRpc(
				podman.rpc.image.list,
				{ query: { all: true } },
				_('Failed to list images')
			);

			if (!listResult.ok) {
				podman.notifyError(view.title, listResult.error);
				images = [];
				renderRows();
				return;
			}

			images = view.normalizeImages(listResult.data);
			renderRows();
		};

		const runRegistrySearch = async function() {
			const term = String(registrySearchTerm.value || '').trim();
			if (!term) {
				podman.notifyError(view.title, {
					code: 'INVALID_SEARCH_TERM',
					message: _('Registry search term is required'),
					details: {}
				});
				return;
			}

			const parsedLimit = Number(registrySearchLimit.value || 25);
			const limit = Math.max(1, Math.min(100, Math.floor(parsedLimit) || 25));
			const result = await podman.callRpc(
				podman.rpc.image.search,
				{
					query: {
						term: term,
						limit: limit,
						listTags: registryListTags.checked === true,
						tlsVerify: registryTlsVerify.checked === true
					}
				},
				_('Failed to search image registries')
			);

			if (!result.ok) {
				podman.notifyError(view.title, result.error);
				registryResults = [];
				renderRegistryRows();
				return;
			}

			registryResults = view.normalizeSearchResults(result.data);
			renderRegistryRows();
		};

		registrySection.appendChild(E('h3', {}, [ _('Registry search') ]));
		registrySection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Search term') ]),
			E('div', { 'class': 'cbi-value-field' }, [ registrySearchTerm ])
		]));
		registrySection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Result limit') ]),
			E('div', { 'class': 'cbi-value-field' }, [ registrySearchLimit ])
		]));
		registrySection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('List tags') ]),
			E('div', { 'class': 'cbi-value-field' }, [ registryListTags ])
		]));
		registrySection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('TLS verify') ]),
			E('div', { 'class': 'cbi-value-field' }, [ registryTlsVerify ])
		]));
		registrySection.appendChild(E('div', { 'class': 'right' }, [
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, async function() {
					await runRegistrySearch();
				})
			}, [ _('Search registries') ]),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					registrySearchTerm.value = '';
					registryResults = [];
					renderRegistryRows();
				})
			}, [ _('Clear results') ])
		]));
		registrySection.appendChild(E('div', { 'class': 'table' }, [
			E('table', { 'class': 'table cbi-section-table' }, [
				E('thead', {}, [
					E('tr', {}, [
						E('th', {}, [ _('Name') ]),
						E('th', {}, [ _('Description') ]),
						E('th', {}, [ _('Stars') ]),
						E('th', {}, [ _('Official') ]),
						E('th', {}, [ _('Automated') ]),
						E('th', {}, [ _('Actions') ])
					])
				]),
				registryTableBody
			])
		]));
		registrySection.appendChild(registryStatusLine);
		root.appendChild(registrySection);

		listSection.appendChild(E('h3', {}, [ _('Image inventory') ]));
		listSection.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, [ _('Search') ]),
			E('div', { 'class': 'cbi-value-field' }, [
				searchInput,
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, function() {
						renderRows();
					})
				}, [ _('Apply') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, function() {
						searchInput.value = '';
						renderRows();
					})
				}, [ _('Clear') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, async function() {
						await refreshList();
					})
				}, [ _('Refresh') ])
			])
		]));

		listSection.appendChild(E('div', { 'class': 'table' }, [
			E('table', { 'class': 'table cbi-section-table' }, [
				E('thead', {}, [
					E('tr', {}, [
						E('th', {}, [ _('Tags') ]),
						E('th', {}, [ _('Image ID') ]),
						E('th', {}, [ _('Created') ]),
						E('th', {}, [ _('Size') ]),
						E('th', {}, [ _('Digest') ]),
						E('th', {}, [ _('Actions') ])
					])
				]),
				tableBody
			])
		]));

		listSection.appendChild(statusLine);
		root.appendChild(listSection);

		renderRegistryRows();
		await refreshList();
		return root;
	}
});
