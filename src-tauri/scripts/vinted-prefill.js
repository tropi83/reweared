(function() {
	//#region src/infrastructure/publish/vinted/prefill.ts
	var THUMBNAIL_WAIT_MS = 1e4;
	var THUMBNAIL_POLL_MS = 250;
	/**
	* Fills Vinted's sell form. Self-contained on purpose: it is bundled into the Tauri binary and
	* evaluated inside vinted.com, where nothing from the app exists. Never clicks submit.
	* `status` stays a plain object so Rust can `JSON.stringify(window.__aivPrefill.status)`.
	*/
	function createPrefill(win, selectors) {
		const doc = win.document;
		let status = null;
		const find = (candidates) => {
			for (const sel of candidates) try {
				const el = doc.querySelector(sel);
				if (el) return el;
			} catch {}
			return null;
		};
		const setText = (el, value) => {
			try {
				const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
				const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
				if (setter) setter.call(el, value);
				else el.value = value;
				el.dispatchEvent(new win.Event("input", { bubbles: true }));
				el.dispatchEvent(new win.Event("change", { bubbles: true }));
				return "filled";
			} catch {
				return "failed";
			}
		};
		const toFile = (photo) => {
			const bin = win.atob(photo.data);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return new win.File([bytes], photo.name, { type: photo.mimeType });
		};
		const countThumbnails = (root) => {
			for (const sel of selectors.photoThumbnail) try {
				const n = root.querySelectorAll(sel).length;
				if (n > 0) return n;
			} catch {}
			return 0;
		};
		let polling = false;
		const attachPhotos = (root, photos, onDone) => {
			const existing = countThumbnails(root);
			if (polling || photos.length === 0 || existing > 0) return onDone(existing);
			const input = find(selectors.photoInput);
			if (!input) return onDone(0);
			try {
				const dt = new win.DataTransfer();
				for (const p of photos) dt.items.add(toFile(p));
				input.files = dt.files;
				input.dispatchEvent(new win.Event("change", { bubbles: true }));
			} catch {
				return onDone(0);
			}
			polling = true;
			const started = Date.now();
			const tick = () => {
				const n = countThumbnails(root);
				if (n >= photos.length || Date.now() - started > THUMBNAIL_WAIT_MS) {
					polling = false;
					onDone(n);
				} else win.setTimeout(tick, THUMBNAIL_POLL_MS);
			};
			win.setTimeout(tick, THUMBNAIL_POLL_MS);
		};
		return {
			get status() {
				return status;
			},
			run(payload) {
				const root = find(selectors.sellFormRoot);
				const pageOk = !!root && !!find(selectors.titleInput);
				status = {
					pageOk,
					title: "not_found",
					description: "not_found",
					photos: {
						requested: payload.photos.length,
						attached: 0
					}
				};
				if (!pageOk) return;
				const title = find(selectors.titleInput);
				const description = find(selectors.descriptionInput);
				status = {
					...status,
					title: title ? setText(title, payload.title) : "not_found",
					description: description ? setText(description, payload.description) : "not_found"
				};
				attachPhotos(root ?? doc, payload.photos, (attached) => {
					status = status && {
						...status,
						photos: {
							requested: payload.photos.length,
							attached
						}
					};
				});
			}
		};
	}
	//#endregion
	//#region src/infrastructure/publish/vinted/selectors.ts
	var VINTED_SELECTORS = {
		sellFormRoot: [
			"[data-testid=\"item-upload-form\"]",
			"form[action*=\"/items\"]",
			"form"
		],
		titleInput: [
			"[data-testid=\"title--input\"]",
			"input[name=\"title\"]",
			"input#title"
		],
		descriptionInput: [
			"[data-testid=\"description--input\"]",
			"textarea[name=\"description\"]",
			"textarea#description"
		],
		photoInput: [
			"[data-testid=\"photo-input\"]",
			"input[type=\"file\"][accept*=\"image\"]",
			"input[type=\"file\"]"
		],
		photoThumbnail: [
			"[data-testid=\"photo-thumbnail\"]",
			"[data-testid*=\"media-thumbnail\"]",
			"img[src^=\"blob:\"]"
		]
	};
	//#endregion
	//#region src/infrastructure/publish/vinted/entry.ts
	var _window;
	(_window = window).__aivPrefill ?? (_window.__aivPrefill = createPrefill(window, VINTED_SELECTORS));
	//#endregion
})();
