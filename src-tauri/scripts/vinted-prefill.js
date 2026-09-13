(function() {
	//#region src/infrastructure/publish/vinted/prefill.ts
	var THUMBNAIL_WAIT_MS = 1e4;
	var THUMBNAIL_POLL_MS = 250;
	var PASTE_ATTR = "data-aiv-paste";
	/** Lucide "clipboard-paste", inlined: nothing from the app exists on vinted.com. */
	var PASTE_ICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z\"/><path d=\"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10\"/><path d=\"m17 10 4 4-4 4\"/></svg>";
	var LABELS = {
		title: {
			fr: "Coller le titre",
			en: "Paste the title"
		},
		description: {
			fr: "Coller la description",
			en: "Paste the description"
		}
	};
	/**
	* Prepares Vinted's sell form: attaches the photos and mounts a paste icon at the end of the title and
	* description fields — the text goes in only when the user taps the icon (their action, not an
	* automated fill). Self-contained on purpose: it is bundled into the Tauri binary and evaluated inside
	* vinted.com, where nothing from the app exists. Never clicks submit.
	* `status` stays a plain object so the host can `JSON.stringify(window.__aivPrefill.status)`.
	*/
	function createPrefill(win, selectors) {
		const doc = win.document;
		let status = null;
		/** Latest payload: a re-run swaps the text the icons paste without mounting them again. */
		let current = null;
		const find = (candidates, root = doc) => {
			for (const sel of candidates) try {
				const el = root.querySelector(sel);
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
		const setField = (field, result) => {
			status = status && {
				...status,
				[field]: result
			};
		};
		/** One icon per field, inside Vinted's input wrapper so it sits at the end of the field. */
		const mountPasteIcon = (field, el) => {
			const wrapper = el.closest(selectors.fieldWrapper.join(",")) ?? el.parentElement;
			if (!wrapper) return "failed";
			if (wrapper.querySelector(`button[${PASTE_ATTR}="${field}"]`)) return "ready";
			const lang = (doc.documentElement.lang || win.navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
			const button = doc.createElement("button");
			button.type = "button";
			button.setAttribute(PASTE_ATTR, field);
			button.setAttribute("aria-label", LABELS[field][lang]);
			button.title = LABELS[field][lang];
			button.innerHTML = PASTE_ICON;
			if (!/^(relative|absolute|fixed|sticky)$/.test(win.getComputedStyle(wrapper).position)) wrapper.style.position = "relative";
			const styles = {
				position: "absolute",
				right: "8px",
				top: `${el.offsetTop + (el instanceof win.HTMLTextAreaElement ? 4 : Math.max(0, Math.round((el.offsetHeight - 32) / 2)))}px`,
				"z-index": "2",
				width: "32px",
				height: "32px",
				display: "inline-flex",
				"align-items": "center",
				"justify-content": "center",
				border: "1px solid #d5d5d5",
				"border-radius": "16px",
				background: "#fff",
				color: "#007782",
				cursor: "pointer",
				padding: "0",
				"box-shadow": "0 1px 2px rgba(0,0,0,.08)"
			};
			for (const [name, value] of Object.entries(styles)) button.style.setProperty(name, value);
			el.style.paddingRight = "44px";
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!current) return;
				setField(field, setText(el, current[field]));
				el.focus();
			});
			wrapper.appendChild(button);
			return "ready";
		};
		const toFile = (photo) => {
			const bin = win.atob(photo.data);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return new win.File([bytes], photo.name, { type: photo.mimeType });
		};
		const countThumbnails = () => {
			for (const sel of selectors.photoThumbnail) try {
				const n = doc.querySelectorAll(sel).length;
				if (n > 0) return n;
			} catch {}
			return 0;
		};
		let polling = false;
		const attachPhotos = (photos, onDone) => {
			const existing = countThumbnails();
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
				const n = countThumbnails();
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
				current = payload;
				const pageOk = !!find(selectors.sellFormRoot) && !!find(selectors.titleInput);
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
					title: title ? mountPasteIcon("title", title) : "not_found",
					description: description ? mountPasteIcon("description", description) : "not_found"
				};
				attachPhotos(payload.photos, (attached) => {
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
			"[data-testid=\"add-photos-input\"]",
			"[data-testid=\"photo-input\"]",
			"input[type=\"file\"][accept*=\"image\"]",
			"input[type=\"file\"]"
		],
		photoThumbnail: [
			"[data-testid^=\"image-wrapper-\"]",
			"[data-testid=\"photo-thumbnail\"]",
			"[data-testid*=\"media-thumbnail\"]"
		],
		fieldWrapper: [".web_ui__Input__content"]
	};
	//#endregion
	//#region src/infrastructure/publish/vinted/entry.ts
	var _window;
	(_window = window).__aivPrefill ?? (_window.__aivPrefill = createPrefill(window, VINTED_SELECTORS));
	//#endregion
})();
