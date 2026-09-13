/**
 * DOM anchors on Vinted's sell form (https://www.vinted.<tld>/items/new). Ordered candidate lists:
 * the first match wins. When Vinted changes its markup, only this file changes.
 *
 * Checked against the live mobile web form on 2026-09-13: the field is `label.web_ui__Input__input >
 * div.web_ui__Input__content > input#title` (same for the description textarea); the media grid
 * (`media-upload-grid`, one `image-wrapper-N` per photo, `<img src="https://images1.vinted.net/…">`)
 * and the hidden file input (`add-photos-input`) live OUTSIDE the <form>.
 */
export interface VintedSelectors {
  sellFormRoot: string[];
  titleInput: string[];
  descriptionInput: string[];
  photoInput: string[];
  /** Searched on the whole document: Vinted renders the grid outside the form. */
  photoThumbnail: string[];
  /** The wrapper the paste icon is mounted in (nearest ancestor of the field; the field's parent otherwise). */
  fieldWrapper: string[];
}

export const VINTED_SELECTORS: VintedSelectors = {
  sellFormRoot: ['[data-testid="item-upload-form"]', 'form[action*="/items"]', "form"],
  titleInput: ['[data-testid="title--input"]', 'input[name="title"]', "input#title"],
  descriptionInput: ['[data-testid="description--input"]', 'textarea[name="description"]', "textarea#description"],
  photoInput: ['[data-testid="add-photos-input"]', '[data-testid="photo-input"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
  photoThumbnail: ['[data-testid^="image-wrapper-"]', '[data-testid="photo-thumbnail"]', '[data-testid*="media-thumbnail"]'],
  fieldWrapper: [".web_ui__Input__content"],
};
