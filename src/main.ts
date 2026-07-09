// Import fs
import * as fs from "fs";
import { Debugout } from "debugout.js";
import ColorClassifier, { Palette, AlgorithmTypes } from "color-classifier"
//import Database from "better-sqlite3";
//import DB from "better-sqlite3";

//import { info, setLevel } from "loglevel";

import { Plugin, Notice, normalizePath, ItemView, Menu, TextComponent, MarkdownView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import path from "path";
import TurndownService from 'turndown';
import {
	DEFAULT_SETTINGS,
	templateAdmonition,
	templatePlain,
	ZOTERO_LIBRARY_VIEW_TYPE,
	ZOTERO_LIBRARY_HEADER_BUTTON_ID,
	BUILT_IN_LIBRARY_COLUMNS,
	EXCLUDED_DYNAMIC_LIBRARY_FIELDS,
} from "./constants";

//Import modals from /modal.ts
import { fuzzySelectEntryFromJson, updateLibrary } from "./modal";

//Import sample settings from /settings.ts
import { SettingTab } from "./settings";
import {
	AnnotationElements,
	MyPluginSettings,
	Reference,
	Collection,
	LibraryEntry,
	BibData,
} from "./types";

import {
	createAuthorKey,
	createLocalFileLink,
	createLocalFilePathLink,
	createZoteroReaderPathLink,
	createZoteroReaderPathLinkYamlList,
	createCreatorList,
	createNoteTitle,
	makeWiki,
	makeQuotes,
	removeQuoteFromEnd,
	removeQuoteFromStart,
	replaceAllTemplates,
	replaceMissingFields,
	replaceTagList,
	replaceTemplate,
	makeTags,
	createCreatorAllList,
	createAuthorKeyInitials,
	createAuthorKeyFullName,
	parseCiteKeyFromNoteName,
} from "./utils";
import { createImportSpecifier } from "typescript";

const BUILT_IN_LIBRARY_FIELD_MAP: Record<string, string> = {
	"Obsidian Notes": "Obsidian Notes",
	"citationKey": "citationKey",
	"Year": "date",
	"Type": "itemType",
	"Title": "title",
	"Authors": "creators",
	"Publication": "publicationTitle",
	"Tags": "tags",
	"Collections": "collections",
	"Parent Collections": "parentCollections",
	"Added": "dateAdded",
	"Action": "Actions",
	"Actions": "Actions",
};

const LEGACY_LIBRARY_COLUMN_MAP: Record<string, string> = {
	"citationKey|Obsidian Notes": "Obsidian Notes",
	"date|Year": "Year",
	"itemType|Type": "Type",
	"title|Title": "Title",
	"creators|Authors": "Authors",
	"publicationTitle|Publication": "Publication",
	"tags|Tags": "Tags",
	"dateAdded|Added": "Added",
};

class ZoteroLibraryView extends ItemView {
	plugin: MyPlugin;
	sortColumn: string;
	sortDirection: "asc" | "desc";

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.sortColumn = this.plugin.normalizeLibraryColumn(this.plugin.settings.libraryViewSortColumn || "Added");
		this.sortDirection = this.plugin.settings.libraryViewSortDirection || "desc";
	}

	getViewType() {
		return ZOTERO_LIBRARY_VIEW_TYPE;
	}

	getDisplayText() {
		return "Zotero Lib View";
	}

	getIcon() {
		return "library";
	}

	async onOpen() {
		await this.renderLibrary();
	}

	async onClose() {}

	async renderLibrary() {
		const container = this.contentEl;
		container.empty();
		container.addClass("zotero-lib-view");

		const data: any = await this.plugin.loadBibData(true);
		if (data == null) {
			container.createEl("p", { text: "No BetterBibTex JSON file found. Please check the Zotero Lib View settings." });
			return;
		}

		const entries = this.plugin.buildLibraryEntries(data);

		const header = container.createDiv({ cls: "zotero-library-header" });
		const titleWrap = header.createDiv({ cls: "zotero-library-title-wrap" });
		titleWrap.createEl("h2", { text: "Zotero Lib View" });
		titleWrap.createEl("p", {
			text: `Source: ${this.plugin.settings.bibPath || "My Library.json"}`,
		});

		const controls = header.createDiv({ cls: "zotero-library-controls" });
		const searchInput = controls.createEl("input");
		searchInput.type = "search";
		searchInput.placeholder = "Search cite key, title, authors, tags...";

		searchInput.oninput = () => {
			renderRows(searchInput.value);
		};

		const stats = container.createDiv({ cls: "zotero-library-stats" });
		const years = entries.map(entry => Number(entry.year)).filter(year => Number.isFinite(year));
		const tags = [...new Set(entries.flatMap(entry => entry.tagsArray))];
		const publications = [...new Set(entries.map(entry => entry.publication).filter(value => value !== ""))];
		const yearSummary = years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : "N/A";

		[
			["References", String(entries.length)],
			["Years", yearSummary],
			["Tags", String(tags.length)],
			["Publications", String(publications.length)],
		].forEach(([label, value]) => {
			const statCard = stats.createDiv({ cls: "zotero-library-stat" });
			statCard.createDiv({ cls: "zotero-library-stat-label", text: label });
			statCard.createDiv({ cls: "zotero-library-stat-value", text: value });
		});

		const tableWrap = container.createDiv({ cls: "zotero-library-table-wrap" });
		const table = tableWrap.createEl("table", { cls: "zotero-library-table" });
		const thead = table.createTHead();
		const headRow = thead.insertRow();

		const visibleColumns = this.plugin.getLibraryViewColumns();
		const sortIndicators: Record<string, HTMLElement> = {};

		const updateSortIndicators = () => {
			Object.entries(sortIndicators).forEach(([column, indicator]) => {
				indicator.setText(this.sortColumn === column ? (this.sortDirection === "asc" ? "↑" : "↓") : "");
			});
		};

		visibleColumns.forEach(columnString => {
			const normalizedColumn = this.plugin.normalizeLibraryColumn(columnString);
			const parts = normalizedColumn.split("|");
			const label = parts[0];
			const th = headRow.createEl("th");
			th.addClass("zotero-library-sortable");
			const headerLabel = th.createDiv({ cls: "zotero-library-sort-label" });
			headerLabel.createSpan({ cls: "zotero-library-sort-text", text: label });
			const indicator = headerLabel.createSpan({
				cls: "zotero-library-sort-indicator",
				text: this.sortColumn === normalizedColumn ? (this.sortDirection === "asc" ? "↑" : "↓") : "",
			});
			sortIndicators[normalizedColumn] = indicator;

			th.setAttr("role", "button");
			th.setAttr("tabindex", "0");

			const sortHandler = () => {
				if (this.sortColumn === normalizedColumn) {
					this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
				} else {
					this.sortColumn = normalizedColumn;
					this.sortDirection = this.plugin.resolveLibraryColumnField(normalizedColumn) === "dateAdded" ? "desc" : "asc";
				}
				this.plugin.settings.libraryViewSortColumn = this.sortColumn;
				this.plugin.settings.libraryViewSortDirection = this.sortDirection;
				void this.plugin.saveSettings();
				updateSortIndicators();
				renderRows(searchInput.value);
			};

			th.addEventListener("click", sortHandler);
			th.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					sortHandler();
				}
			});
		});

		const tbody = table.createTBody();
		const openEntryPdf = (entry: LibraryEntry) => {
			const pdfFile = (entry.pdfName && this.plugin.app.metadataCache.getFirstLinkpathDest(entry.pdfName, "")) ||
				this.plugin.app.metadataCache.getFirstLinkpathDest(entry.citeKey + ".pdf", "");
			if (pdfFile) {
				void this.plugin.openFileReusingLeaf(pdfFile as TFile);
			} else if (entry.pdfLink !== "") {
				window.open(entry.pdfLink, "_blank");
			}
		};

		const renderRows = (query: string) => {
			tbody.empty();
			const normalizedQuery = query.trim().toLowerCase();
			const filteredEntries = normalizedQuery === "" ?
				entries.slice() :
				entries.filter(entry => entry.searchText.includes(normalizedQuery));

			filteredEntries.sort((firstEntry, secondEntry) => this.plugin.compareLibraryEntries(firstEntry, secondEntry, this.sortColumn, this.sortDirection));

			filteredEntries.forEach(entry => {
				const row = tbody.insertRow();
				visibleColumns.forEach(columnString => {
					const normalizedColumn = this.plugin.normalizeLibraryColumn(columnString);
					const parts = normalizedColumn.split("|");
					const label = parts[0];
					const field = this.plugin.resolveLibraryColumnField(normalizedColumn);
					const noteTitle = entry.noteFile?.basename || entry.notePathShort.split("/").pop()?.replace(/\.md$/i, "") || entry.citeKey;

					if (field === "Obsidian Notes") {
						const citeCell = row.insertCell();
						const noteLink = citeCell.createEl("a", { text: noteTitle, href: "#" });
						noteLink.addEventListener("click", (event) => {
							event.preventDefault();
							this.plugin.openOrCreateLibraryEntryNote(entry);
						});
						return;
					}
					if (field === "citationKey") { row.insertCell().setText(entry.citeKey); return; }

					if (field === "date" || field === "Year") { row.insertCell().setText(entry.year); return; }
					if (field === "itemType" || field === "Type") { row.insertCell().setText(entry.itemType); return; }
					if (field === "title" || field === "Title") {
						const titleCell = row.insertCell();
						if (entry.pdfLink !== "") {
							const titleLink = titleCell.createEl("a", { text: entry.title, href: "#" });
							titleLink.addEventListener("click", (event) => {
								event.preventDefault();
								openEntryPdf(entry);
							});
						} else {
							titleCell.setText(entry.title);
						}
						return;
					}
					if (field === "creators" || field === "Authors") { row.insertCell().setText(entry.authors); return; }
					if (field === "publicationTitle" || field === "Publication") { row.insertCell().setText(entry.publication); return; }
					if (field === "tags" || field === "Tags") { row.insertCell().setText(entry.tags); return; }
					if (field === "collections" || field === "Collections") { row.insertCell().setText(entry.collections); return; }
					if (field === "parentCollections" || field === "Parent Collections") { row.insertCell().setText(entry.parentCollections); return; }
					if (field === "dateAdded" || field === "Added") { row.insertCell().setText(entry.dateAddedShort); return; }

					if (field === "Actions") {
						const actionsCell = row.insertCell();
						actionsCell.addClass("zotero-library-actions");

						// Check for PDF link
						if (entry.pdfLink !== "") {
							const pdfButton = actionsCell.createEl("button", { text: "PDF" });
							pdfButton.addEventListener("click", () => {
								openEntryPdf(entry);
							});
						}

						// Web Link
						if (entry.url !== "") {
							const webButton = actionsCell.createEl("button", { text: "Web" });
							webButton.addEventListener("click", () => {
								window.open(entry.url, "_blank");
							});
						}

						// Zotero Link
						if (entry.zoteroLink !== "") {
							const zoteroButton = actionsCell.createEl("button", { text: "Zotero" });
							zoteroButton.addEventListener("click", () => {
								window.open(entry.zoteroLink, "_blank");
							});
						}

						// Note Creator Button
						const noteButton = actionsCell.createEl("button", { text: entry.noteFile != undefined ? "Note" : "Create" });
						noteButton.addEventListener("click", () => {
							this.plugin.openOrCreateLibraryEntryNote(entry);
						});

						return;
					}

					// Custom fields
					row.insertCell().setText((entry.customFieldValues || {})[field] || "");
				});
			});
		};

		searchInput.oninput = () => {
			renderRows(searchInput.value);
		};

		updateSortIndicators();
		renderRows("");
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	keyWordArray: string[];
	pathZoteroStorage: string;
	zoteroBuildWindows: boolean;
	noteElements: AnnotationElements[];
	extractedNoteElements: AnnotationElements[];
	userNoteElements: AnnotationElements[];
	autoImportDebounce: number;
	libraryViewRefreshDebounce: number;
	isAutoImportRunning: boolean;
	discoveredLibraryFields: string[];
	discoveredSubFields: Record<string, string[]>;

	async onload() {
		await this.loadSettings();
		await this.refreshDiscoveredLibraryFields(true);

		this.autoImportDebounce = undefined;
		this.libraryViewRefreshDebounce = undefined;
		this.isAutoImportRunning = false;

		this.registerView(ZOTERO_LIBRARY_VIEW_TYPE, (leaf) => new ZoteroLibraryView(leaf, this));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		//Add Command to Select a single Entry from Bib file via SQL
		this.addCommand({
			id: "importSelectedJson-modal",
			name: "Create/Update Literature Note",
			callback: () => {
				new fuzzySelectEntryFromJson(this.app, this).open();
			},
		});

		//Add Command to Select a single Entry from Bib file via SQL
		this.addCommand({
			id: "updateLibrary-modal",
			name: "Update Library",
			callback: () => {
				new updateLibrary(this.app, this).open();
			},
		});

		this.addCommand({
			id: "update-current-note",
			name: "Update Current Literature Note",
			callback: () => {
				this.updateCurrentNote();
			},
		});

		this.addCommand({
			id: "open-library-view",
			name: "Open Zotero Lib View in Sidebar",
			callback: async () => {
				await this.activateLibraryViewInSidebar();
			},
		});

		this.addCommand({
			id: "open-library-view-tab",
			name: "Open Zotero Lib View in Tab",
			callback: async () => {
				await this.activateLibraryViewInTab();
			},
		});

		this.addRibbonIcon("library", "Open Zotero Lib View", async () => {
			await this.activateLibraryViewInTab();
		});

		this.registerObsidianProtocolHandler("zotero-library", async (params) => {
			const view = typeof params.view === "string" ? params.view.toLowerCase() : "tab";
			if (view === "sidebar") {
				await this.activateLibraryViewInSidebar();
				return;
			}
			await this.activateLibraryViewInTab();
		});

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.initHeaderLibraryButton();
		}));

		this.registerEvent(this.app.workspace.on("layout-change", () => {
			this.initHeaderLibraryButton();
		}));

		this.registerEvent(this.app.workspace.on("file-open", () => {
			this.initHeaderLibraryButton();
		}));

		this.registerBibFileWatcher();
		this.initHeaderLibraryButton();
	}

	onunload() {
		if (this.autoImportDebounce != undefined) {
			window.clearTimeout(this.autoImportDebounce);
			this.autoImportDebounce = undefined;
		}
		if (this.libraryViewRefreshDebounce != undefined) {
			window.clearTimeout(this.libraryViewRefreshDebounce);
			this.libraryViewRefreshDebounce = undefined;
		}
		this.removeHeaderLibraryButtons();
		this.app.workspace.detachLeavesOfType(ZOTERO_LIBRARY_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.discoveredLibraryFields = [];
		this.discoveredSubFields = {};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	removeHeaderLibraryButtons() {
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		markdownLeaves.forEach(leaf => {
			const actionsEl = (leaf.view as any).actionsEl;
			if (!actionsEl) return;
			actionsEl.querySelectorAll(`#${ZOTERO_LIBRARY_HEADER_BUTTON_ID}`).forEach((element: HTMLElement) => {
				element.remove();
			});
		});
	}

	initHeaderLibraryButton() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.removeHeaderLibraryButtons();
		if (!activeView || !activeView.file) return;

		const fileCache = this.app.metadataCache.getFileCache(activeView.file);
		const frontmatter = fileCache?.frontmatter;
		if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, "Zotero Library")) return;

		const actionsEl = (activeView as any).actionsEl;
		if (!actionsEl) return;

		const buttonContainer = actionsEl.createDiv();
		buttonContainer.id = ZOTERO_LIBRARY_HEADER_BUTTON_ID;
		buttonContainer.addClass("clickable-icon");
		buttonContainer.addClass("view-action");
		buttonContainer.setAttribute("aria-label", "Open Zotero Lib View");
		setIcon(buttonContainer, "library");
		buttonContainer.addEventListener("click", async () => {
			await this.activateLibraryViewInTab();
		});
		if (actionsEl.firstChild) {
			actionsEl.insertBefore(buttonContainer, actionsEl.firstChild);
		} else {
			actionsEl.appendChild(buttonContainer);
		}
	}

	async activateLibraryViewInSidebar() {
		const existingLeaf = this.app.workspace.getLeavesOfType(ZOTERO_LIBRARY_VIEW_TYPE)
			.find(leaf => leaf.getRoot() === this.app.workspace.rightSplit);
		if (existingLeaf) {
			this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		await leaf.setViewState({
			type: ZOTERO_LIBRARY_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async activateLibraryViewInTab() {
		const existingLeaf = this.app.workspace.getLeavesOfType(ZOTERO_LIBRARY_VIEW_TYPE)
			.find(leaf => leaf.getRoot() !== this.app.workspace.rightSplit && leaf.getRoot() !== this.app.workspace.leftSplit);
		if (existingLeaf) {
			this.app.workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: ZOTERO_LIBRARY_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	findOpenLeafForFile(file: TFile): WorkspaceLeaf | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as MarkdownView;
			if (view.file?.path === file.path) {
				return leaf;
			}
		}

		for (const leaf of this.app.workspace.getLeavesOfType("pdf")) {
			const state = leaf.getViewState() as { state?: { file?: string } };
			if (state.state?.file === file.path) {
				return leaf;
			}
		}

		return null;
	}

	async openFileReusingLeaf(file: TFile) {
		const existingLeaf = this.findOpenLeafForFile(file);
		if (existingLeaf) {
			await this.app.workspace.revealLeaf(existingLeaf);
			this.app.workspace.setActiveLeaf(existingLeaf, true, true);
			return;
		}

		await this.app.workspace.getLeaf(true).openFile(file);
	}

	async openOrCreateLibraryEntryNote(entry: LibraryEntry) {
		const { app } = this;
		if (entry.noteFile) {
			await this.openFileReusingLeaf(entry.noteFile);
		} else {
			// Create note logic
			await this.createNote(entry.rawEntry, entry.rawData);
			// Refresh to pick up the new file
			await this.refreshLibraryViews();
		}
	}

	async refreshLibraryViews() {
		const leaves = this.app.workspace.getLeavesOfType(ZOTERO_LIBRARY_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof ZoteroLibraryView) {
				await leaf.view.renderLibrary();
			}
		}
	}

	parseLibraryViewColumns(value: string): string[] {
		const parsed = String(value || "")
			.split(",")
			.map(column => this.normalizeLibraryColumn(column.trim()))
			.filter(column => column !== "");
		if (parsed.length > 0) {
			return parsed;
		}
		return BUILT_IN_LIBRARY_COLUMNS.slice();
	}

	normalizeLibraryColumn(column: string): string {
		return LEGACY_LIBRARY_COLUMN_MAP[column] || column;
	}

	resolveLibraryColumnField(column: string): string {
		const normalizedColumn = this.normalizeLibraryColumn(column);
		const parts = normalizedColumn.split("|");
		if (parts.length >= 2) {
			return parts[1] || parts[0];
		}
		return BUILT_IN_LIBRARY_FIELD_MAP[normalizedColumn] || normalizedColumn;
	}

	getAvailableLibraryViewColumns(): string[] {
		return Array.from(new Set(BUILT_IN_LIBRARY_COLUMNS.concat(this.discoveredLibraryFields || [])));
	}

	getAvailableLibrarySourceFields(): string[] {
		return Array.from(new Set(Object.values(BUILT_IN_LIBRARY_FIELD_MAP).concat(this.discoveredLibraryFields || [])));
	}

	getLibraryViewColumns(): string[] {
		const configuredColumns = this.settings.libraryViewColumns;
		if (Array.isArray(configuredColumns) && configuredColumns.length > 0) {
			return this.parseLibraryViewColumns(configuredColumns.join(","));
		}
		if (typeof configuredColumns === "string" && (configuredColumns as string).trim() !== "") {
			return this.parseLibraryViewColumns(configuredColumns);
		}
		return this.getAvailableLibraryViewColumns();
	}

	compareLibraryEntries(firstEntry: LibraryEntry, secondEntry: LibraryEntry, column: string, direction: "asc" | "desc"): number {
		const normalizedColumn = this.normalizeLibraryColumn(column);
		const field = this.resolveLibraryColumnField(normalizedColumn);
		const directionFactor = direction === "desc" ? -1 : 1;
		const getLibraryEntryNoteTitle = (entry: LibraryEntry) => entry.noteFile?.basename || entry.notePathShort.split("/").pop()?.replace(/\.md$/i, "") || entry.citeKey;

		let firstValue: any = "";
		let secondValue: any = "";

		if (field === "Obsidian Notes") {
			firstValue = getLibraryEntryNoteTitle(firstEntry);
			secondValue = getLibraryEntryNoteTitle(secondEntry);
		} else if (field === "citationKey") {
			firstValue = firstEntry.citeKey;
			secondValue = secondEntry.citeKey;
		} else if (field === "date" || field === "Year") {
			firstValue = firstEntry.year;
			secondValue = secondEntry.year;
		} else if (field === "itemType" || field === "Type") {
			firstValue = firstEntry.itemType;
			secondValue = secondEntry.itemType;
		} else if (field === "title" || field === "Title") {
			firstValue = firstEntry.title;
			secondValue = secondEntry.title;
		} else if (field === "creators" || field === "Authors") {
			firstValue = firstEntry.authors;
			secondValue = secondEntry.authors;
		} else if (field === "publicationTitle" || field === "Publication") {
			firstValue = firstEntry.publication;
			secondValue = secondEntry.publication;
		} else if (field === "tags" || field === "Tags") {
			firstValue = firstEntry.tags;
			secondValue = secondEntry.tags;
		} else if (field === "collections" || field === "Collections") {
			firstValue = firstEntry.collections;
			secondValue = secondEntry.collections;
		} else if (field === "parentCollections" || field === "Parent Collections") {
			firstValue = firstEntry.parentCollections;
			secondValue = secondEntry.parentCollections;
		} else if (field === "dateAdded" || field === "Added") {
			firstValue = firstEntry.dateAdded;
			secondValue = secondEntry.dateAdded;
		} else if (field === "Actions") {
			firstValue = firstEntry.noteFile != null ? "0" : "1";
			secondValue = secondEntry.noteFile != null ? "0" : "1";
		} else {
			firstValue = (firstEntry.customFieldValues || {})[field] || "";
			secondValue = (secondEntry.customFieldValues || {})[field] || "";
		}

		const normalizedFirst = String(firstValue || "").toLowerCase();
		const normalizedSecond = String(secondValue || "").toLowerCase();

		if (normalizedFirst < normalizedSecond) return -1 * directionFactor;
		if (normalizedFirst > normalizedSecond) return 1 * directionFactor;

		return firstEntry.citeKey.localeCompare(secondEntry.citeKey) * directionFactor;
	}

	registerBibFileWatcher() {
		const scheduleImport = (file: any) => {
			const bibPath = normalizePath(this.settings.bibPath || "");
			if (bibPath === "" || file.path !== bibPath) return;

			this.scheduleLibraryViewRefresh();

			if (this.settings.autoImportOnBibChange === true) {
				this.scheduleAutoImport();
			}
		};

		const scheduleRefreshForReferenceNote = (file: any) => {
			const exportPath = normalizePath(this.settings.exportPath || "");
			if (exportPath === "") return;

			if (file.path.startsWith(exportPath + "/") && file.path.endsWith(".md")) {
				this.scheduleLibraryViewRefresh();
			}
		};

		this.registerEvent(this.app.vault.on("modify", (file) => {
			scheduleImport(file);
			scheduleRefreshForReferenceNote(file);
		}));

		this.registerEvent(this.app.vault.on("create", (file) => {
			scheduleImport(file);
			scheduleRefreshForReferenceNote(file);
		}));

		this.registerEvent(this.app.vault.on("delete", (file) => {
			scheduleRefreshForReferenceNote(file);
		}));

		this.registerEvent(this.app.vault.on("rename", (file) => {
			scheduleRefreshForReferenceNote(file);
		}));
	}

	scheduleAutoImport() {
		if (this.autoImportDebounce != undefined) {
			window.clearTimeout(this.autoImportDebounce);
		}
		this.autoImportDebounce = window.setTimeout(() => {
			this.autoImportDebounce = undefined;
			this.runAutoImport();
		}, 1500);
	}

	scheduleLibraryViewRefresh() {
		if (this.libraryViewRefreshDebounce != undefined) {
			window.clearTimeout(this.libraryViewRefreshDebounce);
		}
		this.libraryViewRefreshDebounce = window.setTimeout(() => {
			this.libraryViewRefreshDebounce = undefined;
			this.refreshLibraryViews();
		}, 1500);
	}

	async runAutoImport() {
		if (this.isAutoImportRunning) return;
		this.isAutoImportRunning = true;

		try {
			const data: any = await this.loadBibData();
			if (data == null) return;

			const updatedEntries = await this.updateLibraryEntries(data);
			if (updatedEntries.length > 0) {
				new Notice(`Zotero Lib View auto-imported ${updatedEntries.length} updated reference(s)`);
			}
		} catch (error) {
			console.log(error);
			new Notice("Zotero Lib View auto-import failed");
		} finally {
			this.isAutoImportRunning = false;
		}
	}

	async loadBibData(silent = false) {
		const bibPath = normalizePath(this.settings.bibPath);
		try {
			const exists = await this.app.vault.adapter.exists(bibPath);
			if (!exists) {
				if (!silent) new Notice("No BetterBibTex Json file found at " + bibPath);
				this.discoveredLibraryFields = [];
				return undefined;
			}

			const rawdata = await this.app.vault.adapter.read(bibPath);
			const data = JSON.parse(rawdata);

			this.discoveredLibraryFields = discoverLibraryFieldNames(data);
			this.discoveredSubFields = discoverLibrarySubFields(data);

			return data;
		} catch (error) {
			console.log(error);
			if (!silent) new Notice("Failed to read BetterBibTex Json file");
			this.discoveredLibraryFields = [];
			this.discoveredSubFields = {};
			return undefined;
		}
	}

	async refreshDiscoveredLibraryFields(silent = false) {
		await this.loadBibData(silent);
	}

	resolveLibraryEntryNoteFile(selectedEntry: Reference, notePathShort: string) {
		// Try direct match
		const normalizedPath = normalizePath(notePathShort).replace(/^\/+/, "");
		const directMatch = this.app.vault.getAbstractFileByPath(normalizedPath) || (this.app.vault as any).getFileByPath(normalizedPath);
		if (directMatch != null) return directMatch;

		return null;
	}

	buildLibraryEntries(data: any): LibraryEntry[] {
		const divider = normalizeDivider(this.settings.multipleFieldsDivider);
		const entries: LibraryEntry[] = [];

		for (let index = 0; index < data.items.length; index++) {
			const selectedEntry = data.items[index];
			if (selectedEntry.hasOwnProperty("citationKey") == false) continue;

			selectedEntry.authorKey = createAuthorKey(selectedEntry.creators);
			selectedEntry.authorKeyInitials = createAuthorKeyInitials(selectedEntry.creators);
			selectedEntry.authorKeyFullName = createAuthorKeyFullName(selectedEntry.creators);

			if (selectedEntry.hasOwnProperty("date")) {
				selectedEntry.year = selectedEntry.date.match(/\d\d\d\d/gm) + "";
			}

			const notePathShort = normalizePath(createNotePathShort(selectedEntry, this.settings.exportTitle, this.settings.exportPath)).replace(/^\/+/, "");
			const noteFile = this.resolveLibraryEntryNoteFile(selectedEntry, notePathShort);

			const tagsArray = getTagsForLibraryEntry(selectedEntry);

			const authors = formatPrimaryCreatorListForLibrary(selectedEntry.creators || [], divider, this.settings.nameFormat);
			const year = normalizeYearForLibrary(selectedEntry.date);
			const publication = selectedEntry.publicationTitle || "";
			const title = selectedEntry.title || "";
			const collections = getCollectionsForLibraryEntry(selectedEntry, data, divider);
			const parentCollections = getParentCollectionsForLibraryEntry(selectedEntry, data, divider);

			const customFieldValues: Record<string, string> = {};
			const searchValues: string[] = [];

			collectLibrarySearchValues(selectedEntry, searchValues);
			if (collections !== "") searchValues.push(collections);
			if (parentCollections !== "") searchValues.push(parentCollections);

			const fieldMappings: Record<string, string> = {};
			this.getLibraryViewColumns().forEach(col => {
				const parts = col.split("|");
				if (parts.length >= 3 && parts[2]) {
					fieldMappings[parts[1] || parts[0]] = parts[2];
				}
			});

			(this.discoveredLibraryFields || []).forEach(field => {
				const mappingProperty = fieldMappings[field] || (this.settings.fieldPropertyMapping || {})[field];
				customFieldValues[field] = formatLibraryFieldValue(selectedEntry[field], divider, mappingProperty);
			});

			entries.push({
				citeKey: selectedEntry.citationKey,
				year,
				itemType: normalizeItemTypeForLibrary(selectedEntry.itemType),
				title,
				authors,
				publication,
				tags: tagsArray.join(divider),
				tagsArray,
				collections,
				parentCollections,
				dateAdded: selectedEntry.dateAdded || "",
				dateAddedShort: selectedEntry.dateAdded ? String(selectedEntry.dateAdded).slice(0, 10) : "",
				url: selectedEntry.url || "",
				zoteroLink: selectedEntry.select || selectedEntry.uri || "",
				pdfLink: (((selectedEntry.attachments || []).find((a: any) => (a.contentType === "application/pdf" || (a.path && a.path.toLowerCase().endsWith(".pdf"))) && a.select) || {}).select || "").replace("select", "open-pdf"),
				pdfName: (((selectedEntry.attachments || []).find((a: any) => (a.contentType === "application/pdf" || (a.path && a.path.toLowerCase().endsWith(".pdf")))) || {}).path || "").split("/").pop().split("\\").pop(),
				rawEntry: selectedEntry,
				rawData: data,
				notePathShort,
				noteFile,
				customFieldValues,
				searchText: searchValues.join(" ").toLowerCase(),
			});
		}

		entries.sort((firstEntry, secondEntry) => secondEntry.dateAdded.localeCompare(firstEntry.dateAdded) || firstEntry.citeKey.localeCompare(secondEntry.citeKey));

		return entries;
	}

	async updateLibraryEntries(data: any) {
		const bibtexArray: string[] = [];
		const lastUpdate = new Date(this.settings.lastUpdateDate);

		for (let index = 0; index < data.items.length; index++) {
			const selectedEntry = data.items[index];
			if (selectedEntry.hasOwnProperty("citationKey") == false) continue;

			const noteDateModifiedArray: any[] = [];
			noteDateModifiedArray.push(selectedEntry.dateModified);

			if (selectedEntry.notes) {
				for (let index2 = 0; index2 < selectedEntry.notes.length; index2++) {
					noteDateModifiedArray.push(selectedEntry.notes[index2].dateModified);
				}
			}

			noteDateModifiedArray.sort((firstElement, secondElement) => {
				if (firstElement > secondElement) return -1;
				if (firstElement < secondElement) return 1;
				return 0;
			});

			const datemodified = new Date(noteDateModifiedArray[0]);

			if (datemodified < lastUpdate) continue;

			if (this.settings.updateLibrary === "Only update existing notes" && !fs.existsSync(createNoteTitle(selectedEntry, this.settings.exportTitle, this.settings.exportPath))) {
				continue;
			}

			this.createNote(selectedEntry, data);
			bibtexArray.push(selectedEntry.citationKey);
		}

		this.settings.lastUpdateDate = new Date();
		await this.saveSettings();
		this.refreshLibraryViews();
		return bibtexArray;
	}


	createFormatting() {
		const {
			highlightCustomTextAfter,
			highlightCustomTextBefore,
			isCommentItalic,
			isCommentBold,
			isCommentHighlighted,
			isCommentColoured,
			isCommentBullet,
			isCommentBlockquote,
			isCommentQuote,
			commentCustomTextAfter,
			commentCustomTextBefore,
			isHighlightItalic,
			isHighlightBold,
			isHighlightHighlighted,
			isHighlightColoured,
			isHighlightBullet,
			isHighlightBlockquote,
			isHighlightQuote,
			tagCustomTextAfter,
			tagCustomTextBefore,
			isTagItalic,
			isTagBold,
			isTagHighlighted,
			isTagColoured,
			isTagBullet,
			isTagBlockquote,
			isTagQuote,
			isTagHash,
		} = this.settings;

		//Set the formatting variables based on the highlightsettings
		const [
			highlightItalic,
			highlightBold,
			highlightHighlighted,
			highlightBullet,
			highlightBlockquote,
			highlightQuoteOpen,
			highlightQuoteClose,
		] = [
				isHighlightItalic ? "*" : "",
				isHighlightBold ? "**" : "",
				isHighlightHighlighted == true && isHighlightColoured == false ? "==" : "",
				isHighlightBullet ? "- " : "",
				isHighlightBlockquote ? "> " : "",
				isHighlightQuote ? "“" : "",
				isHighlightQuote ? "”" : "",
			];
		//console.log(highlightColour)
		let highlightColouredBefore = ""
		let highlightColouredAfter = ""

		if (isHighlightColoured == true) {
			highlightColouredBefore = '<mark style="background: SELECTED_COLOUR">'
			highlightColouredAfter = "</mark>"
		}

		const highlightFormatBefore =
			highlightHighlighted +
			highlightColouredBefore +
			highlightBold +
			highlightItalic +
			highlightQuoteOpen;

		const highlightFormatAfter =
			highlightQuoteClose +
			highlightItalic +
			highlightBold +
			highlightColouredAfter +
			highlightHighlighted +
			highlightCustomTextAfter;

		let highlightPrepend = ""
		if (highlightBullet != "" || highlightBlockquote != "") {
			highlightPrepend =
				"\n" +
				highlightBullet +
				highlightBlockquote +
				highlightCustomTextBefore
		}

		//Set the formatting variables based on the comments settings
		const commentItalic = isCommentItalic ? "*" : "";
		const commentBold = isCommentBold ? "**" : "";
		const commentHighlighted = isCommentHighlighted == true && isCommentColoured == false ? "==" : "";
		const commentBullet = isCommentBullet ? "- " : "";
		const commentBlockquote = isCommentBlockquote ? "> " : "";
		const commentQuoteOpen = isCommentQuote ? "“" : "";
		const commentQuoteClose = isCommentQuote ? "”" : "";

		let commentColouredBefore = ""
		let commentColouredAfter = ""

		if (isCommentColoured == true) {
			commentColouredBefore = '<mark style="background: SELECTED_COLOUR">'
			commentColouredAfter = "</mark>"
		}

		//Create formatting to be added before and after highlights
		const commentFormatBefore =
			commentHighlighted +
			commentColouredBefore
		commentBold +
			commentItalic +
			commentQuoteOpen;

		const commentFormatAfter =
			commentQuoteClose +
			commentItalic +
			commentBold +
			commentColouredAfter +
			commentHighlighted +
			commentCustomTextAfter;

		let commentPrepend = ""
		if (commentBullet != "" || commentBlockquote != "") {
			commentPrepend =
				"\n" +
				commentBullet +
				commentBlockquote +
				commentCustomTextBefore
		}


		//Set the tag formatting variables based on the tag settings
		const [
			tagHash,
			tagItalic,
			tagBold,
			tagHighlighted,
			tagBullet,
			tagBlockquote,
			tagQuoteOpen,
			tagQuoteClose,
		] = [
				isTagHash ? "#" : "",
				isTagItalic ? "*" : "",
				isTagBold ? "**" : "",
				isTagHighlighted == true && isTagColoured == false ? "==" : "",
				isTagBullet ? "- " : "",
				isTagBlockquote ? "> " : "",
				isTagQuote ? "“" : "",
				isTagQuote ? "”" : "",
			];

		let tagColouredBefore = ""
		let tagColouredAfter = ""

		if (isTagColoured == true) {
			tagColouredBefore = '<mark style="background: SELECTED_COLOUR">'
			tagColouredAfter = "</mark>"
		}
		const tagFormatBefore =
			tagHash +
			tagHighlighted +
			tagColouredBefore +
			tagBold +
			tagItalic +
			tagQuoteOpen;

		const tagFormatAfter =
			tagQuoteClose +
			tagItalic +
			tagBold +
			tagColouredAfter +
			tagHighlighted +
			tagCustomTextAfter;

		let tagPrepend = ""
		if (tagBullet != "" || tagBlockquote != "") {
			tagPrepend = "\n" +
				tagBullet + tagBlockquote + tagCustomTextBefore;
		} else {
			tagPrepend = tagBullet + tagBlockquote + tagCustomTextBefore;
		}

		return {
			highlightFormatBefore,
			highlightFormatAfter,
			highlightPrepend,
			commentFormatBefore,
			commentFormatAfter,
			commentPrepend,
			tagFormatBefore,
			tagFormatAfter,
			tagPrepend,
		};
	}

	parseMetadata(selectedEntry: Reference, templateOriginal: string) {
		// Create Note from Template
		const template = templateOriginal;

		//Create Note
		let note = template;

		//Replace the author/s

		note = createCreatorList(
			selectedEntry.creators,
			"author",
			note,
			this.settings.multipleFieldsDivider,
			this.settings.nameFormat
		);
		//Replace the editor/s
		note = createCreatorList(
			selectedEntry.creators,
			"editor",
			note,
			this.settings.multipleFieldsDivider,
			this.settings.nameFormat
		);

		//Replace the creators (authors+editors+everybodyelse)
		note = createCreatorAllList(
			selectedEntry.creators,
			note,
			this.settings.multipleFieldsDivider,
			this.settings.nameFormat
		);

		//Create field year
		if (selectedEntry.hasOwnProperty("date")) {
			selectedEntry.year = selectedEntry.date.match(/\d\d\d\d/gm) + "";
		}
		//Create field ZoteroLocalLibrary
		if (selectedEntry.hasOwnProperty("select")) {
			selectedEntry.localLibrary =
				"[Zotero](" + selectedEntry.select + ")";
			selectedEntry.localLibraryLink = selectedEntry.select;

		}

		//Create citekey
		selectedEntry.citeKey = selectedEntry.citationKey

		//Fix itemType
		if (selectedEntry.itemType == "journalArticle") { selectedEntry.itemType = "Journal Article" }
		if (selectedEntry.itemType == "report") { selectedEntry.itemType = "Report" }
		if (selectedEntry.itemType == "bookSection") { selectedEntry.itemType = "Book Section" }
		if (selectedEntry.itemType == "newspaperArticle") { selectedEntry.itemType = "Newspaper Article" }
		if (selectedEntry.itemType == "book") { selectedEntry.itemType = "Book" }
		//Capitalize the first letter
		selectedEntry.itemType = selectedEntry.itemType.charAt(0).toUpperCase() + selectedEntry.itemType.slice(1);


		// Create in-line citation (e.g. Collier, Laporte and Seawright (2009))
		selectedEntry.citationInLine = createAuthorKey(selectedEntry.creators) +
			" " +
			"(" +
			selectedEntry.year +
			")"
		selectedEntry.citationInLine = selectedEntry.citationInLine.replace("()", "")


		// Create in-line citation with initials (e.g. Collier, D., Laporte, J. and Seawright, J. (2009))
		selectedEntry.citationInLineInitials = createAuthorKeyInitials(selectedEntry.creators) +
			" " +
			"(" +
			selectedEntry.year +
			")"
		selectedEntry.citationInLineInitials = selectedEntry.citationInLineInitials.replace("()", "")

		// Create in-line citation with initials (e.g. Collier, D., Laporte, J. and Seawright, J. (2009))
		selectedEntry.citationInLineFullName = createAuthorKeyFullName(selectedEntry.creators) +
			" " +
			"(" +
			selectedEntry.year +
			")"
		selectedEntry.citationInLineFullName = selectedEntry.citationInLineFullName.replace("()", "")

		// Replace short and full citation
		if (selectedEntry.itemType == "Journal Article") {
			selectedEntry.citationShort = selectedEntry.citationInLine +
				" " +
				"'" +
				selectedEntry.title +
				"'";
			selectedEntry.citationFull = selectedEntry.citationShort +
				", " +
				"*" +
				selectedEntry.publicationTitle +
				"*" +
				", " +
				selectedEntry.volume +
				"(" +
				selectedEntry.issue +
				"), " +
				"pp. " +
				selectedEntry.pages +
				"."

			selectedEntry.citationFull = selectedEntry.citationFull.replace("() ", "")
			selectedEntry.citationShort = selectedEntry.citationShort.replace("** ", "")
			selectedEntry.citationFull = selectedEntry.citationFull.replace("** ", "")
			selectedEntry.citationFull = selectedEntry.citationFull.replace("pp. ", "")

		}

		//create field file
		selectedEntry.file = createLocalFileLink(selectedEntry);
		//create field path field
		selectedEntry.filePath = createLocalFilePathLink(selectedEntry);
		//create Zotero reader path field
		console.log(selectedEntry.filePath)
		selectedEntry.zoteroReaderLink = createZoteroReaderPathLink(selectedEntry);
		console.log(selectedEntry.zoteroReaderLink)
		selectedEntry.zoteroReaderLinkYamlList = createZoteroReaderPathLinkYamlList(selectedEntry);
		console.log(selectedEntry.zoteroReaderLinkYamlList)


		// Create an array with all the fields
		const entriesArray = Object.keys(selectedEntry);


		//replace the single-value placeholders with the value of the field
		note = replaceAllTemplates(entriesArray, note, selectedEntry);



		//remove single backticks but retain triple backticks
		note = note.replace(/```/g, "HEREISAPLACEHOLDERFORBACKTICK");
		note = note.replace(/`/g, "'");
		note = note.replace(/HEREISAPLACEHOLDERFORBACKTICK/g, "```");

		// //if the abstract is missing, delete Abstract headings

		note = note.replace(
			"```ad-quote\n" + "title: Abstract\n" + "```\n",
			""
		);
		note = note.replace(
			"```ad-abstract\n" + "title: Files and Links\n" + "```\n",
			""
		);
		note = note.replace(
			"```ad-note\n" + "title: Tags and Collections\n" + "```",
			""
		);

		// Return the metadata
		return note;
	}
	// FUNCTION TO PARSE ANNOTATION
	parseAnnotationLinesintoElementsZotfile(note: string) {
		//Split the note into lines
		const lines = note.split(/<p>/gm);
		const noteElements: AnnotationElements[] = [];
		for (let indexLines = 0; indexLines < lines.length; indexLines++) {
			//Remote html tags
			const selectedLineOriginal = lines[indexLines];



			const selectedLine = selectedLineOriginal.replace(
				/<\/?[^>]+(>|$)/g,
				""
			);

			//Skip if empty
			if (selectedLine === "") {
				continue;
			}

			//Crety empty lineElements
			const lineElements: AnnotationElements = {
				highlightText: "",
				highlightColour: "",
				annotationType: "",
				citeKey: "",
				commentText: "",
				rowOriginal: selectedLine,
				rowEdited: selectedLine,
				indexNote: undefined,
				foundOld: undefined,
				positionOld: undefined,
				extractionSource: "zotfile",
				colourTextAfter: "",
				colourTextBefore: "",
				// added missing properties
				imagePath: "",
				pagePDF: 0,
				pageLabel: 0,
				attachmentURI: "",
				zoteroBackLink: "",
				annotationKey: "",
			};

			//Extract the citeKey
			lineElements.citeKey = String(selectedLine.match(/\(([^)]+)\)+$/g));
			if (lineElements.citeKey == `null`) { lineElements.citeKey = String(selectedLine.match(/\(([^D+]+) \d+\S+\)/g)) };

			const posCiteKeyBegins = selectedLine.indexOf(lineElements.citeKey);

			let extractedText = "";
			if (posCiteKeyBegins !== -1) {
				extractedText = selectedLine
					.substring(0, posCiteKeyBegins - 1)
					.trim();

				// Remove quotation marks from extractedText
				["“", '"', "`", "'"].forEach(
					(quote) =>
					(extractedText = removeQuoteFromStart(
						quote,
						extractedText
					))
				);
				["”", '"', "`", "'"].forEach(
					(quote) =>
					(extractedText = removeQuoteFromEnd(
						quote,
						extractedText
					))
				);
			}

			//Extract the colour

			if (extractedText.startsWith("(Yellow) - ")) {
				lineElements.highlightColour = "yellow";
				extractedText = extractedText.replace("(Yellow) - ", "");
			}

			if (extractedText.startsWith("(Black) - ")) {
				lineElements.highlightColour = "black";
				extractedText = extractedText.replace("(Black) - ", "");
			}

			if (extractedText.startsWith("(White) - ")) {
				lineElements.highlightColour = "white";
				extractedText = extractedText.replace("(White) - ", "");
			}

			if (extractedText.startsWith("(Gray) - ")) {
				lineElements.highlightColour = "gray";
				extractedText = extractedText.replace("(Gray) - ", "");
			}
			if (extractedText.startsWith("(Red) - ")) {
				lineElements.highlightColour = "red";
				extractedText = extractedText.replace("(Red) - ", "");
			}

			if (extractedText.startsWith("(Orange) - ")) {
				lineElements.highlightColour = "orange";
				extractedText = extractedText.replace("(Orange) - ", "");
			}

			if (extractedText.startsWith("(Green) - ")) {
				lineElements.highlightColour = "green";
				extractedText = extractedText.replace("(Green) - ", "");
			}

			if (extractedText.startsWith("(Cyan) - ")) {
				lineElements.highlightColour = "cyan";
				extractedText = extractedText.replace("(Cyan) - ", "");
			}

			if (extractedText.startsWith("(Blue) - ")) {
				lineElements.highlightColour = "blue";
				extractedText = extractedText.replace("(Blue) - ", "");
			}

			if (extractedText.startsWith("(Magenta) - ")) {
				lineElements.highlightColour = "magenta";
				extractedText = extractedText.replace("(Magenta) - ", "");
			}

			//Extracte the Zotero backlink
			lineElements.zoteroBackLink = "";
			if (
				/zotero:\/\/open-pdf\/library\/items\/\S+page=\d+/g.test(
					selectedLineOriginal
				)
			) {
				const zoteroBackLink = String(
					selectedLineOriginal.match(
						/zotero:\/\/open-pdf\/library\/items\/\S+page=\d+/g
					)
				);
				lineElements.zoteroBackLink = zoteroBackLink;

			}

			//Extract the page of the annotation in the publication
			if (/(\d+)(?!.*\d)/g.test(selectedLineOriginal)) {
				const pageLabel = String(
					selectedLineOriginal.match(/(\d+)(?!.*\d)/g)
				);
				if (pageLabel == null) {
					lineElements.pageLabel = null;
				} else {
					lineElements.pageLabel = Number(pageLabel);
				}
			}

			// //Extract the attachment URI
			// if (/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\/\w+/gm.test(selectedLineOriginal)){
			// 	let attachmentURI = String(selectedLineOriginal.match(/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\/\w+/gm))
			// 	if (attachmentURI === null){lineElements.attachmentURI = null} else{
			// 		attachmentURI = attachmentURI.replace(/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\//gm, "")
			// 		lineElements.attachmentURI = attachmentURI
			// 	}
			// }

			//Identify if the text is highlight or comment. if it is a comment extract the type of comment

			const annotationCommentAll = "";
			if (lineElements.citeKey.includes("(note on p.")) {
				lineElements.commentText = extractedText;
				lineElements.citeKey = "";
			} else {
				lineElements.highlightText = extractedText;
			}

			// 	Extract the first word in the comment added to the annotation
			let firstBlank = -1;
			let annotationCommentFirstWord = "";
			if (lineElements.commentText.length > 0) {
				firstBlank = lineElements.commentText.indexOf(" ");
				if (firstBlank === -1) {
					firstBlank = lineElements.commentText.length;
				}
				annotationCommentFirstWord = lineElements.commentText.substring(
					0,
					firstBlank
				);
			}

			lineElements.annotationType = this.getAnnotationType(
				annotationCommentFirstWord,
				lineElements.commentText
			);
			if (firstBlank == -1) {
				firstBlank = annotationCommentAll.length;
			}
			lineElements.commentText =
				lineElements.annotationType === "noKey"
					? lineElements.commentText
					: lineElements.commentText
						.substring(
							firstBlank,
							lineElements.commentText.length
						)
						.trim();

			//If a comment includes the key for a transformation, apply that to the previous element

			if (noteElements.length > 1) {
				if (
					lineElements.annotationType != "noKey" &&
					noteElements[noteElements.length - 1].annotationType ===
					"noKey" &&
					noteElements[noteElements.length - 1].commentText === ""
				) {
					noteElements[noteElements.length - 1].annotationType =
						lineElements.annotationType;
					noteElements[noteElements.length - 1].commentText =
						lineElements.commentText;


					continue;
				}
			}
			noteElements.push(lineElements);
		}
		return noteElements;
	}

	parseAnnotationLinesintoElementsUserNote(note: string) {


		// Replace html formatting with markdown formatting
		const turndownService = new TurndownService()
		note = turndownService.turndown(note)


		note = note
			// Replace backticks
			.replace(/`/g, "'")
			// Correct when zotero exports wrong key (e.g. Author, date, p. p. pagenum)
			.replace(/, p. p. /g, ", p. ")
			.trim();
		// Split the annotations into an array where each row is an entry
		const lines = note.split(/<\/h1>|\n\n|<\/p>/gm);
		const noteElements: AnnotationElements[] = [];

		//Loop through the lines
		const lengthLines = Object.keys(lines).length;
		for (let indexLines = 0; indexLines < lengthLines; indexLines++) {
			const selectedLineOriginal = unescape(lines[indexLines]);


			// Replace backticks with single quote
			let selectedLine = replaceTemplate(selectedLineOriginal, "`", "'");

			// Correct encoding issues with special character showing incorrectly
			selectedLine = replaceTemplate(selectedLine, "&amp;", "&").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');


			const lineElements: AnnotationElements = {
				highlightText: "",
				highlightColour: "",
				annotationType: "",
				citeKey: "",
				commentText: "",
				rowOriginal: selectedLine,
				rowEdited: selectedLine,
				indexNote: undefined,
				foundOld: undefined,
				positionOld: undefined,
				extractionSource: "UserNote",
				colourTextBefore: "",
				colourTextAfter: "",
				imagePath: "",
				pagePDF: 0,
				pageLabel: 0,
				attachmentURI: "",
				zoteroBackLink: "",
				annotationKey: "",
			};

			lineElements.rowEdited = selectedLine;

			//Add the element to the array containing all the elements

			noteElements.push(lineElements);
		}

		return noteElements;
	}
	parseAnnotationLinesintoElementsZotero(note: string) {
		// clean the entire annotation
		note = note
			// .replace(
			// 	Remove HTML tags
			// 	HTML_TAG_REG,
			// 	"")
			// 	Replace backticks
			.replace(/`/g, "'")
			// Correct when zotero exports wrong key (e.g. Author, date, p. p. pagenum)
			.replace(/, p. p. /g, ", p. ")
			.trim();
		// Split the annotations into an array where each row is an entry
		const lines = note.split(/<\/h1>|<\/p>|<h1>/gm);
		const noteElements: AnnotationElements[] = [];

		//Loop through the lines
		const lengthLines = Object.keys(lines).length;
		for (let indexLines = 1; indexLines < lengthLines; indexLines++) {

			const selectedLineOriginal = unescape(lines[indexLines]);

			//Remove HTML tags
			let selectedLine = String(
				selectedLineOriginal.replace(/<\/?[^>]+(>|$)/g, "")
			);
			// 	// Replace backticks with single quote
			selectedLine = replaceTemplate(selectedLine, "`", "'");
			//selectedLine = replaceTemplate(selectedLine, "/<i/>", "");
			// 	// Correct encoding issues
			selectedLine = replaceTemplate(selectedLine, "&amp;", "&");

			const lineElements: AnnotationElements = {
				highlightText: "",
				highlightColour: "",
				annotationType: "",
				citeKey: "",
				commentText: "",
				inlineTagsText: "",
				inlineTagsArray: [],
				rowOriginal: selectedLine,
				rowEdited: selectedLine,
				indexNote: undefined,
				foundOld: undefined,
				positionOld: undefined,
				extractionSource: "zotero",
				colourTextBefore: "",
				colourTextAfter: "",
				imagePath: "",
				pagePDF: undefined,
				pageLabel: undefined,
				zoteroBackLink: "",
				attachmentURI: "",
				annotationKey: "",
			};

			//Record the extraction method
			lineElements.extractionSource = "zotero";

			//Identify images
			if (/data-attachment-key=/gm.test(selectedLineOriginal)) {
				lineElements.annotationType = "typeImage";
				lineElements.imagePath = String(
					selectedLineOriginal.match(/key="([^"]*)"/g)[0]
				)
					.replaceAll('"', "")
					.replace("key=", "");
			}

			//Extract the colour of the highlight
			if (/"color":"#......"/gm.test(selectedLineOriginal)) {
				let highlightColour = String(
					selectedLineOriginal.match(/"color":"#......"/gm)
				);
				if (highlightColour == null) {
					highlightColour = "";
				}
				highlightColour = highlightColour.replace('color":', "");
				highlightColour = highlightColour.replace('"', "");
				lineElements.highlightColour = highlightColour;



			}

			//Extracte the page of the pdf

			if (/"pageIndex":\d+/gm.test(selectedLineOriginal)) {
				let pagePDF = String(
					selectedLineOriginal.match(/"pageIndex":\d+/gm)
				);
				if (pagePDF == null) {
					lineElements.pagePDF = null;
				} else {
					pagePDF = pagePDF.replace('"pageIndex":', "");
					lineElements.pagePDF = Number(pagePDF) + 1;
				}
			}
			//Extracte the page of the annotation in the publication
			if (/"pageLabel":"\d+/g.test(selectedLineOriginal)) {
				let pageLabel = String(
					selectedLineOriginal.match(/"pageLabel":"\d+/g)
				);
				if (pageLabel == null) {
					lineElements.pageLabel = null;
				} else {
					pageLabel = pageLabel.replace('"pageLabel":"', "");
					lineElements.pageLabel = Number(pageLabel);
				}
			}

			//Extract the attachment URI

			if (
				/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\/\w+/gm.test(
					selectedLineOriginal
				)
			) {
				let attachmentURI = String(
					selectedLineOriginal.match(
						/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\/\w+/gm
					)
				);
				if (attachmentURI === null) {
					lineElements.attachmentURI = null;
				} else {
					attachmentURI = attachmentURI.replace(
						/attachmentURI":"http:\/\/zotero\.org\/users\/\d+\/items\//gm,
						""
					);
					lineElements.attachmentURI = attachmentURI;
				}
			}


			if (
				/"attachmentURI":"http:\/\/zotero.org\/users\/local\/[a-zA-Z0-9]*\/items\/[a-zA-Z0-9]*/gm.test(
					selectedLineOriginal
				)
			) {
				let attachmentURI = String(
					selectedLineOriginal.match(
						/"attachmentURI":"http:\/\/zotero.org\/users\/local\/[a-zA-Z0-9]*\/items\/[a-zA-Z0-9]*/gm
					)
				);
				if (attachmentURI === null) {
					lineElements.attachmentURI = null;
				} else {
					attachmentURI = attachmentURI.replace(
						/"attachmentURI":"http:\/\/zotero.org\/users\/local\/[a-zA-Z0-9]*\/items\//gm,
						""
					);
					lineElements.attachmentURI = attachmentURI;
				}
			}

			if (
				/"uris":\["http:\/\/zotero\.org\/users\/\d+\/items\/\w+/gm.test(
					selectedLineOriginal
				) && lineElements.attachmentURI == ""
			) {
				let attachmentURI = String(
					selectedLineOriginal.match(
						/"uris":\["http:\/\/zotero\.org\/users\/\d+\/items\/\w+/g
					)
				);
				if (attachmentURI === null) {
					lineElements.attachmentURI = null;
				} else {
					attachmentURI = attachmentURI.replace(
						/"uris":\["http:\/\/zotero\.org\/users\/\d+\/items\//g,
						""
					);
					lineElements.attachmentURI = attachmentURI;
				}

			}


			//Create the zotero backlink			
			if (/"annotationKey":"[a-zA-Z0-9]+/gm.test(selectedLineOriginal)) {
				let annotationKey = String(selectedLineOriginal.match(/"annotationKey":"[a-zA-Z0-9]+/gm));
				if (annotationKey === null) {
					lineElements.annotationKey = null;
				} else {
					annotationKey = annotationKey.replace(/"annotationKey":"/gm, "");
					lineElements.annotationKey = annotationKey;
				}
			}
			if (lineElements.attachmentURI !== null && lineElements.pagePDF !== null && lineElements.annotationKey !== null) {
				lineElements.zoteroBackLink = "zotero://open-pdf/library/items/" + lineElements.attachmentURI + "?page=" + lineElements.pagePDF + "&annotation=" + lineElements.annotationKey;

			}
			//Extract the citation within bracket
			if (
				/\(<span class="citation-item">.*<\/span>\)<\/span>/gm.test(
					selectedLineOriginal
				)
			) {
				lineElements.citeKey = String(
					selectedLineOriginal.match(
						/\(<span class="citation-item">.*<\/span>\)<\/span>/gm
					)
				);
				lineElements.citeKey = lineElements.citeKey.replace(
					'(<span class="citation-item">',
					""
				);
				lineElements.citeKey = lineElements.citeKey.replace(
					"</span>)</span>",
					""
				);
				lineElements.citeKey = "(" + lineElements.citeKey + ")";
			}
			//Find the position where the CiteKey begins
			const beginningCiteKey = selectedLine.indexOf(lineElements.citeKey);

			//Find the position where the citekey ends
			const endCiteKey =
				selectedLine.indexOf(lineElements.citeKey) +
				lineElements.citeKey.length;

			//Extract the text of the annotation
			if (endCiteKey !== 0) {
				lineElements.highlightText = selectedLine.substring(0, beginningCiteKey - 1).trim();
				lineElements.highlightText = lineElements.highlightText.replace(/((?<=\p{Unified_Ideograph})\s*(?=\p{Unified_Ideograph}))/ug, '');

				// Remove quotation marks from annotationHighlight
				["“", '"', "`", "'"].forEach(
					(quote) =>
					(lineElements.highlightText = removeQuoteFromStart(
						quote,
						lineElements.highlightText
					))
				);
				["”", '"', "`", "'"].forEach(
					(quote) =>
					(lineElements.highlightText = removeQuoteFromEnd(
						quote,
						lineElements.highlightText
					))
				);
			}

			//Extract the comment made to an annotation (after the citeKey)
			if (endCiteKey > 0) {
				const annotationCommentAll = selectedLine
					.substring(endCiteKey + 1)
					.trim();

				// 	Extract the first word in the comment added to the annotation
				let firstBlank = annotationCommentAll.indexOf(" ");
				//if (firstBlank===-1){firstBlank = annotationCommentAll.length}

				const annotationCommentFirstWord =
					annotationCommentAll.substring(0, firstBlank);
				// Identify what type of annotation is based on the first word
				if (lineElements.annotationType !== "typeImage") {
					lineElements.annotationType = this.getAnnotationType(
						annotationCommentFirstWord,
						annotationCommentAll
					);
				}

				// Extract the comment without the initial key and store it in
				lineElements.commentText = "";
				if (firstBlank == -1) {
					firstBlank = annotationCommentAll.length;
				}
				lineElements.commentText =
					lineElements.annotationType === "noKey" ||
						lineElements.annotationType === "typeImage"
						? annotationCommentAll
						: annotationCommentAll
							.substring(
								firstBlank,
								annotationCommentAll.length
							)
							.trim();

				//Extract the tags

				//check if the inline tags are found in the text of the comment
				if (lineElements.commentText.includes(this.settings.TagBeginningConfig)) {

					//if the tags are at the end of the comment, tehn extract the text between the beginning of the tag and the end of the comment
					if (this.settings.TagEndConfig.length == 0) {
						lineElements.inlineTagsText = lineElements.commentText.slice(
							lineElements.commentText.indexOf(this.settings.TagBeginningConfig),
							lineElements.commentText.length,
						);
					} else {
						//if the tags are in the middle/beginning of the comment, tehn extract the text between the beginning of the tag and the specified end  of the tag
						lineElements.inlineTagsText = lineElements.commentText.slice(
							lineElements.commentText.indexOf(this.settings.TagBeginningConfig),
							lineElements.commentText.lastIndexOf(this.settings.TagEndConfig),
						);
					}

					//Remove the tags from the comment
					lineElements.commentText = lineElements.commentText.replace(lineElements.inlineTagsText, "").trim()
				}

				//Check if there are any tags before performing manipulations of inlineTagsText

				if (typeof lineElements.inlineTagsText !== `undefined`) {
					//Remove the tag beginning and end marker from the inlineTagsText
					lineElements.inlineTagsText = lineElements.inlineTagsText.replace(this.settings.TagBeginningConfig, "");

					if (this.settings.TagEndConfig.length != 0) {
						lineElements.inlineTagsText = lineElements.inlineTagsText.replace(this.settings.TagEndConfig, "");
					}

					//Split the different tags in an array if there are tags
					lineElements.inlineTagsArray = lineElements.inlineTagsText.split(this.settings.TagDividerConfig)

					// Identify what type of annotation is based on the tags word. Loop through each of the tags
					if (lineElements.annotationType !== "typeImage") {
						for (let indexTag = 0; indexTag < lineElements.inlineTagsArray.length; indexTag++) {
							const tempAnnotationType = this.getAnnotationType(
								lineElements.inlineTagsArray[indexTag],
								annotationCommentAll);
							//Currently Zotero Lib View can only incorporate one transformation. So as soon as one of the tags matches one transformation this is applied to the code (superseding the first character) and the loop is interrupted. The tag is removed from the list that is printed after the comment
							if (tempAnnotationType != "noKey") {
								lineElements.annotationType = tempAnnotationType;

								//Remove this from the array
								lineElements.inlineTagsArray.splice(indexTag, 1)

								break
							}
						}
					}
				}

			} else {
				lineElements.rowEdited = selectedLine;
			}
			//Add the element to the array containing all the elements
			noteElements.push(lineElements);
		}
		return noteElements;
	}

	formatColourHighlight(lineElements: AnnotationElements) {
		if (lineElements.annotationType === "typeImage") {
			return lineElements;
		}

		//fix the label of the annotation colour - Zotero native reader
		if (lineElements.highlightColour.includes("#ffd400")) {
			lineElements.highlightColour = "yellow";
		}
		else if (lineElements.highlightColour.includes("#ff6666")) {
			lineElements.highlightColour = "red";
		}
		else if (lineElements.highlightColour.includes("#5fb236")) {
			lineElements.highlightColour = "green";
		}
		else if (lineElements.highlightColour.includes("#2ea8e5")) {
			lineElements.highlightColour = "blue";
		}
		else if (lineElements.highlightColour.includes("#a28ae5")) {
			lineElements.highlightColour = "purple";
		}
		else if (lineElements.highlightColour.includes(this.settings.colourCustomHexValue)) {
			lineElements.highlightColour = "customHex";
		}

		//fix the label of the annotation colour - Zotfile and other annotators that are not the Zotero native reader
		else {
			const HexRegex = new RegExp(/#([a-fA-F0-9]{6})/g);

			if (HexRegex.test(lineElements.highlightColour)) {
				const colorClassifier = new ColorClassifier(Palette.RAINBOW, AlgorithmTypes.HSV);
				lineElements.highlightColour = colorClassifier.classify(String(lineElements.highlightColour.match(HexRegex)), "hex");
			}



			if (["##000000", "#000000"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "black";
			} else if (["##FFFFFF", "#ffffff"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "white";
			} else if (["##808080", "#808080"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "gray";
			} else if (["##FF0000", "#ff0000"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "red";
			} else if (["##FFA500", "#ffa500"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "orange";
			} else if (["##FFFF00", "#ffff00"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "yellow";
			} else if (["##00FF00", "#008000", "#00ff00"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "green";
			} else if (["##00FFFF", "#00ffff"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "cyan";
			} else if (["##0000FF", "#0000ff"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "blue";
			} else if (["##FF00FF", "#800080", "#ff00ff"].some(colorStr => lineElements.highlightColour.includes(colorStr))) {
				lineElements.highlightColour = "magenta";
			}


		}




		//Zotfile Default
		//{"Black": "#000000",
		//"White": "#FFFFFF",
		//"Gray": "#808080",
		//"Red": "#FF0000",
		//"Orange": "#FFA500",
		//"Yellow": "#FFFF00",
		// "Green": "#00FF00",
		// "Cyan": "#00FFFF",
		//"Blue": "#0000FF",
		//"Magenta": "#FF00FF"}

		//Extract the transformation text
		let colourTransformation = "";

		if (lineElements.highlightColour == "yellow") {
			colourTransformation = this.settings.colourYellowText;
		}
		else if (lineElements.highlightColour == "red") {
			colourTransformation = this.settings.colourRedText;
		}
		else if (lineElements.highlightColour == "green") {
			colourTransformation = this.settings.colourGreenText;
		}
		else if (lineElements.highlightColour == "blue") {
			colourTransformation = this.settings.colourBlueText;
		}
		else if (lineElements.highlightColour == "purple") {
			colourTransformation = this.settings.colourPurpleText;
		}
		else if (lineElements.highlightColour == "black") {
			colourTransformation = this.settings.colourBlackText;
		}
		else if (lineElements.highlightColour == "white") {
			colourTransformation = this.settings.colourWhiteText;
		}
		else if (lineElements.highlightColour == "gray") {
			colourTransformation = this.settings.colourGrayText;
		}
		else if (lineElements.highlightColour == "orange") {
			colourTransformation = this.settings.colourOrangeText;
		}
		else if (lineElements.highlightColour == "cyan") {
			colourTransformation = this.settings.colourCyanText;
		}
		else if (lineElements.highlightColour == "magenta") {
			colourTransformation = this.settings.colourMagentaText;
		}
		else if (lineElements.highlightColour == "customHex") {
			colourTransformation = this.settings.colourCustomHexText;
		}



		//extract the transformation from the highlight colour
		if (lineElements.annotationType == "noKey") {
			if (colourTransformation.toLowerCase() === "h1") {
				lineElements.annotationType = "typeH1";
			} else if (colourTransformation.toLowerCase() === "h2") {
				lineElements.annotationType = "typeH2";
			} else if (colourTransformation.toLowerCase() === "h3") {
				lineElements.annotationType = "typeH3";
			} else if (colourTransformation.toLowerCase() === "h4") {
				lineElements.annotationType = "typeH4";
			} else if (colourTransformation.toLowerCase() === "h5") {
				lineElements.annotationType = "typeH5";
			} else if (colourTransformation.toLowerCase() === "h6") {
				lineElements.annotationType = "typeH6";
			} else if (colourTransformation.toLowerCase() === "addtoabove") {
				lineElements.annotationType = "typeMergeAbove";
			} else if (colourTransformation.toLowerCase() === "keyword") {
				lineElements.annotationType = "typeKeyword";
			} else if (colourTransformation.toLowerCase() === "todo") {
				lineElements.annotationType = "typeTask";
			} else if (colourTransformation.toLowerCase() === "task") {
				lineElements.annotationType = "typeTask";
			}
		}

		// Extract the colour template
		const arr = ['{{highlight}}', '{{comment}}', '{{tag}}'];
		const containsHighlightCommentTag = arr.some(element => {
			if (colourTransformation.includes(element)) {
				return true;
				// if a specific template has not been set for the specific colour, then import the default	template
			}
			return false;
		});

		if (containsHighlightCommentTag == true) { lineElements.colourTemplate = colourTransformation }
		else { lineElements.colourTemplate = this.settings.highlightExportTemplate }





		//extract the text to be pre-pended/appended

		if (colourTransformation.includes("{{highlight}}")) {
			lineElements.colourTextBefore = String(
				colourTransformation.match(/.+?(?={{highlight}})/)
			);
			if (lineElements.colourTextBefore == "null") {
				lineElements.colourTextBefore = "";
			}
			lineElements.colourTextAfter = String(
				colourTransformation.match(/(?<={{highlight}}).*$/)
			);
			if (lineElements.colourTextAfter == "null") {
				lineElements.colourTextAfter = "";
			}

		}

		return lineElements;
	}

	formatNoteElements(noteElements: AnnotationElements[], citeKey: string) {
		const { isDoubleSpaced } = this.settings;

		const {
			commentFormatAfter,
			commentFormatBefore,
			commentPrepend,
			highlightFormatAfter,
			highlightFormatBefore,
			highlightPrepend,
			tagFormatBefore,
			tagFormatAfter,
			tagPrepend,
		} = this.createFormatting();

		//Create an index of rows to be removed
		const indexRowsToBeRemoved: number[] = [];

		//Create elements with subset of highlights/notes to be exported
		const noteElementsArray: AnnotationElements[] = [];
		const keywordArray: string[] = [];
		const rowEditedArray: string[] = [];
		//Create vector with annotation highlighted in different colour
		const highlightsYellow: string[] = [];
		const highlightsRed: string[] = [];
		const highlightsGreen: string[] = [];
		const highlightsPurple: string[] = [];
		const highlightsBlack: string[] = [];
		const highlightsWhite: string[] = [];
		const highlightsGray: string[] = [];
		const highlightsCyan: string[] = [];
		const highlightsOrange: string[] = [];
		const highlightsBlue: string[] = [];
		const highlightsMagenta: string[] = [];
		const highlightsCustomHex: string[] = [];
		const imagesArray: string[] = [];

		//Remove undefined elements
		noteElements = noteElements.filter((x) => x !== undefined);
		//Run a loop, processing each annotation line one at the time

		for (let i = 0; i < noteElements.length; i++) {
			//Select one element to process
			let lineElements = noteElements[i];

			//Run the function to extract the transformation associated with the highlighted colour
			lineElements = this.formatColourHighlight(lineElements);

			//Extract the citation format from the settings
			if (
				lineElements.extractionSource === "zotero" ||
				lineElements.extractionSource === "zotfile"
			) {
				if (
					this.settings.highlightCitationsFormat ===
					"Only page number" &&
					lineElements.pageLabel !== undefined
				) {
					lineElements.citeKey =
						"(p. " + lineElements.pageLabel + ")";
				} else if (
					this.settings.highlightCitationsFormat === "Pandoc" &&
					lineElements.pageLabel !== undefined
				) {
					lineElements.citeKey =
						"[@" + citeKey + ", p. " + lineElements.pageLabel + "]"
				} else if (
					this.settings.highlightCitationsFormat === "Pandoc" &&
					lineElements.pageLabel === undefined
				) {
					lineElements.citeKey = "[@" + citeKey + "]";
				} else if (
					this.settings.highlightCitationsFormat === "Empty" &&
					lineElements.pageLabel !== undefined
				) {
					lineElements.citeKey = " ";
				}
			}
			//Edit the backlink to Zotero based on the settings
			if (
				this.settings.highlightCitationsLink === true &&
				lineElements.zoteroBackLink.length > 0
			) {

				if (this.settings.highlightCitationsFormat !== "Pandoc") {
					lineElements.citeKey =
						"[" +
						lineElements.citeKey +
						"]" +
						"(" +
						lineElements.zoteroBackLink +
						")";
					lineElements.zoteroBackLink =
						"[" +
						" " +
						"]" +
						"(" +
						lineElements.zoteroBackLink +
						")";
				} else {
					lineElements.citeKey =
						lineElements.citeKey +
						" [](" +
						lineElements.zoteroBackLink +
						")";
					lineElements.zoteroBackLink =
						"[" +
						" " +
						"]" +
						"(" +
						lineElements.zoteroBackLink +
						")";
				}
			} else {
				lineElements.zoteroBackLink = "";
			}



			//Extract the custom language assocaited with the highlight colour
			let colourTextBefore = lineElements.colourTextBefore;
			if (colourTextBefore == undefined) {
				colourTextBefore = "";
			}
			let colourTextAfter = lineElements.colourTextAfter;
			if (colourTextAfter == undefined) {
				colourTextAfter = "";
			}

			//Identify the headings exported by Zotero
			if (lineElements.highlightText === "Extracted Annotations") {
				lineElements.annotationType = "typeExtractedHeading";
			}

			// REPLACE COLOUR OF HIGHLIGHT/COMMENT/TAG IN THE HIGHLIGHTCOLOURED
			const highlightFormatBeforeColoured = highlightFormatBefore.replace("SELECTED_COLOUR", lineElements.highlightColour + ";")
			const commentFormatBeforeColoured = commentFormatBefore.replace("SELECTED_COLOUR", lineElements.highlightColour + ";")
			const tagFormatBeforeColoured = tagFormatBefore.replace("SELECTED_COLOUR", lineElements.highlightColour + ";")


			//FORMAT THE HEADINGS IDENTIFIED BY ZOTERO
			//Transforms headings exported by Zotero into H3 (this could be changed later)
			if (lineElements.annotationType === "typeExtractedHeading") {
				lineElements.rowEdited =
					"**" + lineElements.rowOriginal.toUpperCase() + "**";
			}

			// ADD FORMATTING TO THE HIGHLIGHTS
			if (lineElements.highlightText != "") {
				lineElements.highlightFormatted =
					highlightPrepend +
					highlightFormatBeforeColoured +
					lineElements.highlightText +
					highlightFormatAfter +
					" " +
					lineElements.citeKey +
					" ";
				lineElements.highlightFormattedNoPrepend =
					highlightFormatBeforeColoured +
					lineElements.highlightText +
					highlightFormatAfter +
					" " +
					lineElements.citeKey +
					" ";

			} else {
				lineElements.highlightFormatted = "";
				lineElements.highlightFormattedNoPrepend = ""
			}

			// ADD FORMATTING TO THE COMMENTS
			if (lineElements.commentText != "" && lineElements.highlightText != "") {
				lineElements.commentFormatted =
					commentPrepend +
					commentFormatBeforeColoured +
					lineElements.commentText +
					commentFormatAfter + " ";
				lineElements.commentFormattedNoPrepend =
					commentFormatBeforeColoured +
					lineElements.commentText +
					commentFormatAfter + " ";
			}
			//Add Citation to the comment if the highlight is empty
			else if (lineElements.commentText != "" && lineElements.highlightText == "") {
				lineElements.commentFormatted =
					commentPrepend +
					commentFormatBeforeColoured +
					lineElements.commentText +
					commentFormatAfter +
					" " +
					lineElements.zoteroBackLink +
					" ";
				lineElements.commentFormattedNoPrepend =
					commentFormatBeforeColoured +
					lineElements.commentText +
					commentFormatAfter +
					" " +
					lineElements.zoteroBackLink +
					" ";
			} else {
				lineElements.commentFormatted = "";
				lineElements.commentFormattedNoPrepend = ""
			}



			// ADD FORMATTING TO THE ZOTERO INLINE TAGS
			//if the hash is added to the tag, then remove empty spaces
			if (typeof lineElements.inlineTagsArray == 'undefined') { lineElements.inlineTagsArray = [] }

			if (this.settings.isTagHash == true) {
				for (let index = 0; index < lineElements.inlineTagsArray.length; index++) {
					lineElements.inlineTagsArray[index] = lineElements.inlineTagsArray[index].replace(/ /g, "")
				}
				//{}
			}

			const TempTag = lineElements.inlineTagsArray
				.map(i => tagPrepend + tagFormatBeforeColoured + i + tagFormatAfter);
			// if there are two tags, remove one

			//format the tags so that only the hash sign is added only if there was not one already
			for (let index = 0; index < TempTag.length; index++) {
				TempTag[index] = TempTag[index].replace("##", "#");
				//if(this.settings.isTagHash==true){TempTag[index] = TempTag[index].replace(" ", "")}
			}



			const TempTagNoPrepend = lineElements.inlineTagsArray
				.map(i => tagFormatBeforeColoured + i + tagFormatAfter);
			for (let index = 0; index < TempTagNoPrepend.length; index++) {
				TempTagNoPrepend[index] = TempTagNoPrepend[index].replace("##", "#");
				//if(this.settings.isTagHash==true){TempTagNoPrepend[index] = TempTagNoPrepend[index].replace(" ", "")}
			}


			// Check if there are any inline tags
			function allAreEmpty(arr: string[]) { return arr.every(element => element == ""); }

			// If there are inline tags, format them. otherwise create empty element
			if (allAreEmpty(lineElements.inlineTagsArray) == false) {
				lineElements.inlineTagsFormatted = TempTag.join(' ');
				// lineElements.inlineTagsFormatted = lineElements.inlineTagsFormatted + this.settings.tagCustomTextAfterLast;

				lineElements.inlineTagsFormattedNoPrepend = TempTagNoPrepend.join(' ');
				// lineElements.inlineTagsFormatted = lineElements.inlineTagsFormatted + this.settings.tagCustomTextAfterLast;

			} else {
				lineElements.inlineTagsFormatted = "";
				lineElements.inlineTagsFormattedNoPrepend = "";
			}

			//

			//Extract from the setting the template for exporitng the highlight/comment/tag for different colours
			if (typeof lineElements.colourTemplate == 'undefined') { lineElements.colourTemplate = this.settings.highlightExportTemplate }

			if (lineElements.colourTemplate.length == 0) { lineElements.colourTemplate = "" }

			lineElements.colourTemplateFormatted = lineElements.colourTemplate.replace("{{highlight}}", lineElements.highlightFormatted)
			lineElements.colourTemplateFormatted = lineElements.colourTemplateFormatted.replace("{{comment}}", lineElements.commentFormatted)
			lineElements.colourTemplateFormatted = lineElements.colourTemplateFormatted.replace("{{tag}}", lineElements.inlineTagsFormatted)
			//lineElements.colourTemplate = lineElements.colourTemplate + "\n"
			lineElements.colourTemplateFormatted = lineElements.colourTemplateFormatted.replace(/^\s+/g, '');

			////Extract from the setting the template for exporitng the highlight/comment/tag for different colours but without prepend signs. This can be used to create tasks/heading
			lineElements.colourTemplateNoPrepend = lineElements.colourTemplate.replace("{{highlight}}", lineElements.highlightFormattedNoPrepend)
			lineElements.colourTemplateNoPrepend = lineElements.colourTemplateNoPrepend.replace("{{comment}}", lineElements.commentFormattedNoPrepend)
			lineElements.colourTemplateNoPrepend = lineElements.colourTemplateNoPrepend.replace("{{tag}}", lineElements.inlineTagsFormattedNoPrepend)
			//lineElements.colourTemplate = lineElements.colourTemplate + "\n"
			lineElements.colourTemplateNoPrepend = lineElements.colourTemplateNoPrepend.replace(/^\s+/g, '');



			//FORMAT HIGHLIGHTED SENTENCES WITHOUT ANY COMMENT
			//OR WITHOUT ANY SPECIAL CONSIDERATIONS
			if (lineElements.annotationType === "noKey") { lineElements.rowEdited = lineElements.colourTemplateFormatted }

			//FORMAT IMAGES
			if (lineElements.annotationType === "typeImage") {
				lineElements.rowEdited = "";
				let pathImageOld = "";
				let pathImageNew = "";
				if (this.settings.imagesImport) {
					// Check if the user settings has approved the importing of images
					pathImageOld = path.format({
						dir: this.pathZoteroStorage + lineElements.imagePath,
						base: "image.png",

					});

					// If the path of the existing images has been defined in the settings, then take that
					if (this.settings.zoteroStoragePathManual.length > 0) {
						pathImageOld = path.format({
							dir: this.settings.zoteroStoragePathManual + lineElements.imagePath,
							base: "image.png",

						})
					}

					pathImageNew = path.normalize(
						path.format({
							dir: normalizePath(
								// create new path with the rootpath + settings.imagesPath
							(this.app.vault.adapter as any).getBasePath() +
								"\\" +
								this.settings.imagesPath
							),
							base:
								citeKey + "_" + lineElements.imagePath + ".png",
						})
					);
					if (this.zoteroBuildWindows == false) {
						pathImageNew = "/" + pathImageNew;
					}


					//Check if the image exists within Zotero or already within the vault
					if (
						// replaced fs.existsSync with the obsidian adapter
						fs.existsSync(pathImageOld)
					) {
						//if the settings is to link to the image in the zotero folder
						if (this.settings.imagesCopy === false) {

							lineElements.rowEdited = "![](file://" + encodeURI(pathImageOld) + ")" + lineElements.zoteroBackLink;
						}
						//if the settings is to copy the image from Zotero to the Obsidian vault
						else {
							//if the file has not already been copied
							if (!fs.existsSync(pathImageNew)) {
								fs.copyFile(
									pathImageOld,
									pathImageNew,
									(err) => {
										if (err) throw err;
									}
								);
							}
							lineElements.rowEdited = "![[" + citeKey + "_" + lineElements.imagePath + ".png]] " +
								lineElements.citeKey;
						}
					} else {
						new Notice(
							`Cannot find image at "${pathImageOld}". Provide the correct zotero data directory location in the settings`
						);
					}
				}

				//Add the comment after the image
				if (lineElements.commentText.length > 0) {
					if (
						this.settings.imagesCommentPosition == "Below the image"
					) {
						lineElements.rowEdited =
							lineElements.rowEdited +
							"\n" +
							"\n" +
							lineElements.commentFormatted +
							lineElements.inlineTagsFormatted;
					} else {
						lineElements.rowEdited =
							lineElements.commentFormatted +
							lineElements.inlineTagsFormatted +
							"\n" +
							"\n" +
							lineElements.rowEdited;
					}
				}
			}
			// MERGE HIGHLIGHT WITH THE PREVIOUS ONE ABOVE
			if (lineElements.annotationType === "typeMergeAbove") {
				noteElements[i].rowEdited = (noteElements[i - 1].rowEdited.replace(/\[.*\)/, '')).replace(/\s+$/g, '') + " " +
					lineElements.highlightFormattedNoPrepend.replace(/^\s+/g, '') +
					lineElements.commentFormatted +
					lineElements.inlineTagsFormatted



				//Add the highlighted text to the previous one
				indexRowsToBeRemoved.push(i - 1);
			}

			//PREPEND COMMENT TO THE HIGHLIGHTED SENTENCE
			//check the setting commentPrependDefault. If true, then everytime there is an highlight with a comment, prepend the comment to the highlight
			if (
				this.settings.commentPrependDefault === true &&
				lineElements.highlightText !== "" &&
				lineElements.commentText !== ""
			) {
				lineElements.annotationType = "typeCommentPrepend";
			}
			//commentPrependDefault
			if (lineElements.annotationType === "typeCommentPrepend") {
				//add the comment before the highlight
				lineElements.rowEdited =
					highlightPrepend +
					lineElements.commentFormattedNoPrepend +
					lineElements.highlightFormattedNoPrepend +
					lineElements.inlineTagsFormatted;
			}

			// 	FORMAT THE HEADERS
			//  Transform header in H1/H2/H3/H4/H5/H6 Level
			if (/typeH\d/.test(lineElements.annotationType)) {
				const lastChar =
					lineElements.annotationType[
					lineElements.annotationType.length - 1
					];
				const level = parseInt(lastChar);
				const hashes = "#".repeat(level);
				lineElements.rowEdited =
					`${hashes} ` +
					lineElements.highlightText +
					lineElements.commentText +
					lineElements.zoteroBackLink +
					lineElements.inlineTagsFormatted;
			}

			//Create Task
			if (lineElements.annotationType == "typeTask") {
				lineElements.rowEdited =
					`- [ ] ` +
					lineElements.colourTemplateNoPrepend
				// if (
				// 	lineElements.commentText !== "" &&
				// 	lineElements.highlightText !== ""
				// ) {
				// 	lineElements.rowEdited =
				// 		`- [ ] ` +
				// 		lineElements.commentFormattedNoPrepend +
				// 		" - " +
				// 		lineElements.highlightFormattedNoPrepend +
				// 		lineElements.inlineTagsFormatted;
				// } else if (
				// 	lineElements.commentText == "" &&
				// 	lineElements.highlightText !== ""
				// ) {
				// 	lineElements.rowEdited =
				// 		`- [ ] ` +
				// 		colourTextBefore +
				// 		highlightFormatBefore +
				// 		lineElements.highlightText +
				// 		highlightFormatAfter +
				// 		lineElements.zoteroBackLink +
				// 		colourTextAfter +
				// 		lineElements.inlineTagsFormatted;;
				// } else if (
				// 	lineElements.commentText !== "" &&
				// 	lineElements.highlightText === ""
				// ) {
				// 	lineElements.rowEdited =
				// 		`- [ ] ` +
				// 		commentFormatBefore +
				// 		lineElements.commentText +
				// 		commentFormatAfter +
				// 		lineElements.zoteroBackLink +
				// 		lineElements.inlineTagsFormatted;;
				// }

			}

			//FORMAT KEYWORDS
			// Add highlighted expression to KW
			if (lineElements.annotationType === "typeKeyword") {
				keywordArray.push(lineElements.highlightText);

				//remove the text of the line
				lineElements.rowEdited = "";

				//Add the line to an index of lines to be removed
				indexRowsToBeRemoved.push(i);
			}





			//Copy the edited text into an array to be exported
			noteElementsArray.push(lineElements);

		}

		// PERFORM THE FOLLOWING OPERATIONS ON THE WHOLE ARRAY

		// Remove the rows with the keywords and other rows to be removed
		if (indexRowsToBeRemoved.length) {
			for (
				let index = indexRowsToBeRemoved.length - 1;
				index >= 0;
				index--
			) {
				noteElementsArray.splice(indexRowsToBeRemoved[index], 1);
			}
		}

		//Add rowEdited into different arrays for the export
		for (let index = 0; index < noteElementsArray.length; index++) {
			const selectedLine = noteElementsArray[index];
			rowEditedArray.push(selectedLine.rowEdited);

			// Copy the rows highlighted in a certain colour into colour-specific arrays
			if (selectedLine.highlightColour === "yellow") {
				highlightsYellow.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "red") {
				highlightsRed.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "green") {
				highlightsGreen.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "purple") {
				highlightsPurple.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "black") {
				highlightsBlack.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "white") {
				highlightsWhite.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "gray") {
				highlightsGray.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "cyan") {
				highlightsCyan.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "orange") {
				highlightsOrange.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "blue") {
				highlightsBlue.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "magenta") {
				highlightsMagenta.push(selectedLine.rowEdited);
			} else if (selectedLine.highlightColour === "customHex") {
				highlightsCustomHex.push(selectedLine.rowEdited);
			}

			//Copy the images in a specific array
			if (selectedLine.annotationType === "typeImage") {
				imagesArray.push(selectedLine.rowEdited);
			}


		}

		// Add empty row in between rows if selected in the settings
		if (isDoubleSpaced) {
			for (let index = rowEditedArray.length - 1; index >= 0; index--) {
				rowEditedArray.splice(index, 0, "");
			}
		}

		//Export the different arrays with the rowEdited
		const resultsLineElements = {
			rowEditedArray: rowEditedArray,
			keywordArray: keywordArray,
			highlightsYellow: highlightsYellow,
			highlightsRed: highlightsRed,
			highlightsGreen: highlightsGreen,
			highlightsPurple: highlightsPurple,
			highlightsBlack: highlightsBlack,
			highlightsWhite: highlightsWhite,
			highlightsGray: highlightsGray,
			highlightsCyan: highlightsCyan,
			highlightsOrange: highlightsOrange,
			highlightsBlue: highlightsBlue,
			highlightsMagenta: highlightsMagenta,
			highlightsCustomHex: highlightsCustomHex,
			imagesArray: imagesArray,
			noteElements: noteElements,
		};
		return resultsLineElements;
	}

	getAnnotationType(
		annotationCommentFirstWord: string,
		annotationCommentAll: string
	) {
		const {
			keyMergeAbove,
			keyCommentPrepend,
			keyH1,
			keyH2,
			keyH3,
			keyH4,
			keyH5,
			keyH6,
			keyKeyword,
			keyTask,
		} = this.settings;

		//Take the lower cap version
		annotationCommentFirstWord = annotationCommentFirstWord.toLowerCase();

		let annotationType = "noKey";
		if (
			annotationCommentFirstWord === keyMergeAbove.toLowerCase() ||
			annotationCommentAll === keyMergeAbove
		) {
			annotationType = "typeMergeAbove";
		} else if (
			annotationCommentFirstWord === keyCommentPrepend.toLowerCase()
		) {
			annotationType = "typeCommentPrepend";
		} else if (annotationCommentFirstWord === keyH1.toLowerCase()) {
			annotationType = "typeH1";
		} else if (annotationCommentFirstWord === keyH2.toLowerCase()) {
			annotationType = "typeH2";
		} else if (annotationCommentFirstWord === keyH3.toLowerCase()) {
			annotationType = "typeH3";
		} else if (annotationCommentFirstWord === keyH4.toLowerCase()) {
			annotationType = "typeH4";
		} else if (annotationCommentFirstWord === keyH5.toLowerCase()) {
			annotationType = "typeH5";
		} else if (annotationCommentFirstWord === keyH6.toLowerCase()) {
			annotationType = "typeH6";
		}
		if (annotationCommentAll === keyH1.toLowerCase()) {
			annotationType = "typeH1";
		} else if (annotationCommentAll === keyH2.toLowerCase()) {
			annotationType = "typeH2";
		} else if (annotationCommentAll === keyH3.toLowerCase()) {
			annotationType = "typeH3";
		} else if (annotationCommentAll === keyH4.toLowerCase()) {
			annotationType = "typeH4";
		} else if (annotationCommentAll === keyH5.toLowerCase()) {
			annotationType = "typeH5";
		} else if (annotationCommentAll === keyH6.toLowerCase()) {
			annotationType = "typeH6";
		} else if (
			annotationCommentAll === keyKeyword.toLowerCase() ||
			annotationCommentFirstWord === keyKeyword.toLowerCase()
		) {
			annotationType = "typeKeyword";
		} else if (
			annotationCommentAll === keyTask.toLowerCase() ||
			annotationCommentFirstWord === keyTask.toLowerCase()
		) {
			annotationType = "typeTask";
		}
		return annotationType;
	}

	extractAnnotation(selectedEntry: Reference, noteTitleFull: string) {
		let extractedAnnotations = "";
		let extractedAnnotationsYellow = "";
		let extractedAnnotationsRed = "";
		let extractedAnnotationsGreen = "";
		let extractedAnnotationsBlue = "";
		let extractedAnnotationsPurple = "";
		let extractedAnnotationsBlack = "";
		let extractedAnnotationsWhite = "";
		let extractedAnnotationsGray = "";
		let extractedAnnotationsCyan = "";
		let extractedAnnotationsOrange = "";
		let extractedAnnotationsMagenta = "";
		let extractedAnnotationsCustomHex = "";
		let extractedImages = "";
		let extractedUserNote = "";

		//Check the path to the data folder
		if (selectedEntry.attachments[0] !== undefined) {
			//identify the folder on the local computer where zotero/storage is found
			//first look into the same path as the pdf attachment
			let pathZoteroStorage = "";
			let zoteroBuildWindows: boolean = undefined;



			//check if the base path where the attachment is stored is in Zotero/storage
			const zoteroStorageMac = new RegExp(
				/.+?(?=Zotero\/storage)Zotero\/storage\//gm
			);

			if (zoteroStorageMac.test(selectedEntry.attachments[0].path)) {
				pathZoteroStorage = String(
					selectedEntry.attachments[0].path.match(zoteroStorageMac)
				);
				zoteroBuildWindows = false;
			}

			const zoteroStorageWindows = new RegExp(
				/.+?(?=Zotero\\storage\\)Zotero\\storage\\/gm
			);

			if (zoteroStorageWindows.test(selectedEntry.attachments[0].path)) {
				pathZoteroStorage = String(
					selectedEntry.attachments[0].path.match(
						zoteroStorageWindows
					)
				);
				zoteroBuildWindows = true;
			}

			if (
				pathZoteroStorage.length == 0 &&
				this.settings.zoteroStoragePathManual.length > 0
			) {
				pathZoteroStorage = this.settings.zoteroStoragePathManual;
				if (pathZoteroStorage.toLowerCase().endsWith("\\zotero")) {
					pathZoteroStorage = pathZoteroStorage + "\\storage\\";
				}
				if (pathZoteroStorage.toLowerCase().endsWith("\\zotero\\")) {
					pathZoteroStorage = pathZoteroStorage + "storage\\";
				}
				if (pathZoteroStorage.toLowerCase().endsWith("/zotero")) {
					pathZoteroStorage = pathZoteroStorage + "/storage/";
				}
				if (pathZoteroStorage.toLowerCase().endsWith("/zotero/")) {
					pathZoteroStorage = pathZoteroStorage + "storage/";
				}
			}
			this.pathZoteroStorage = pathZoteroStorage;
			this.zoteroBuildWindows = zoteroBuildWindows;
		}

		//run the function to parse the annotation for each note (there could be more than one)
		let noteElements: AnnotationElements[] = [];
		let userNoteElements: AnnotationElements[] = [];
		if (selectedEntry.notes.length > 0) {
			for (
				let indexNote = 0;
				indexNote < selectedEntry.notes.length;
				indexNote++
			) {
				let note = selectedEntry.notes[indexNote].note;


				// Remove special characters that would break the replacement of the text in the template
				//lineElements.rowEdited = lineElements.rowEdited.replaceAll("$>", '$$'); 
				note = note.replaceAll("$&", '$ &');

				//Identify the extraction Type (Zotero vs. Zotfile)
				let extractionType = undefined;

				if (unescape(note).includes("<span class=")) {
					extractionType = "Zotero";
				} else if (
					unescape(note).includes(
						'<a href="zotero://open-pdf/library/'
					)
				) {
					extractionType = "Zotfile";
				}
				//Identify manual notes (not extracted from PDF) extracted from zotero
				else if (unescape(note).includes("div data-schema-version")) {
					extractionType = "UserNote";
				} else {
					extractionType = "Other";
				}
				let noteElementsSingle: AnnotationElements[] = []; // array of elements
				if (extractionType === "Zotero") {
					noteElementsSingle =
						this.parseAnnotationLinesintoElementsZotero(note);
					noteElements = noteElements.concat(noteElementsSingle); //concatenate the annotation element to the next one
				}

				if (extractionType === "Zotfile") {
					noteElementsSingle =
						this.parseAnnotationLinesintoElementsZotfile(note);

					noteElements = noteElements.concat(noteElementsSingle); //concatenate the annotation element to the next one
				}

				if (
					extractionType === "UserNote" ||
					extractionType === "Other"
				) {
					noteElementsSingle =
						this.parseAnnotationLinesintoElementsUserNote(note);
					userNoteElements =
						userNoteElements.concat(noteElementsSingle); //concatenate the annotation element to the next one
				}
				this.noteElements = noteElements;
				this.userNoteElements = userNoteElements;
			}




			//Run the function to edit each line
			const resultsLineElements = this.formatNoteElements(
				this.noteElements,
				selectedEntry.citationKey
			);

			this.keyWordArray = resultsLineElements.keywordArray;

			//Create the annotation by merging the individial elements of rowEditedArray. Do the same for the colour
			extractedAnnotations =
				resultsLineElements.rowEditedArray.join("\n");
			extractedAnnotationsYellow =
				resultsLineElements.highlightsYellow.join("\n");
			extractedAnnotationsRed =
				resultsLineElements.highlightsRed.join("\n");
			extractedAnnotationsGreen =
				resultsLineElements.highlightsGreen.join("\n");
			extractedAnnotationsBlue =
				resultsLineElements.highlightsBlue.join("\n");
			extractedAnnotationsPurple =
				resultsLineElements.highlightsPurple.join("\n");
			extractedAnnotationsBlack =
				resultsLineElements.highlightsBlack.join("\n");
			extractedAnnotationsWhite =
				resultsLineElements.highlightsWhite.join("\n");
			extractedAnnotationsGray =
				resultsLineElements.highlightsGray.join("\n");
			extractedAnnotationsCyan =
				resultsLineElements.highlightsCyan.join("\n");
			extractedAnnotationsOrange =
				resultsLineElements.highlightsOrange.join("\n");
			extractedAnnotationsMagenta =
				resultsLineElements.highlightsMagenta.join("\n");
			extractedAnnotationsCustomHex =
				resultsLineElements.highlightsCustomHex.join("\n");
			extractedImages = resultsLineElements.imagesArray.join("\n");
			//Creates an array with the notes from the user
			const extractedUserNoteArray = Array.from(
				Object.values(this.userNoteElements),
				(note) => note.rowEdited
			);
			extractedUserNote = extractedUserNoteArray.join("\n");
		}

		//Export both the extracted annotations, user annotation, and the keywords extracted in the object extractedNote
		const extractedNote = {
			extractedAnnotations: extractedAnnotations,
			extractedUserNote: extractedUserNote,
			extractedKeywords: this.keyWordArray,
			extractedAnnotationsYellow: extractedAnnotationsYellow,
			extractedAnnotationsRed: extractedAnnotationsRed,
			extractedAnnotationsGreen: extractedAnnotationsGreen,
			extractedAnnotationsBlue: extractedAnnotationsBlue,
			extractedAnnotationsPurple: extractedAnnotationsPurple,
			extractedAnnotationsBlack: extractedAnnotationsBlack,
			extractedAnnotationsWhite: extractedAnnotationsWhite,
			extractedAnnotationsGray: extractedAnnotationsGray,
			extractedAnnotationsCyan: extractedAnnotationsCyan,
			extractedAnnotationsOrange: extractedAnnotationsOrange,
			extractedAnnotationsMagenta: extractedAnnotationsMagenta,
			extractedAnnotationsCustomHex: extractedAnnotationsCustomHex,
			extractedImages: extractedImages,
			noteElements: this.noteElements,
		};
		return extractedNote;
	}

	parseCollection(
		selectedEntry: Reference,
		data: { collections: Collection[] },
		metadata: string
	) {
		//Create object with all the collections
		const exportedCollections: Collection[] = data.collections;

		//identify the ID of the item
		const selectedID = selectedEntry.itemID;

		//Create empty array to store information about the collections of the item
		let collectionArray: string[] = [];

		//Create empty array to store information about the parent of the collections of the item
		const collectionParentCode: string[] = [];
		let collectionParentArray: string[] = [];
		const collectionParentParent: string[] = [];

		//identify the number of collections in the data
		const collectionKeys: string[] = Object.keys(exportedCollections);

		//loop through the collections and search for the ID of the selected reference
		for (
			let indexCollection = 0;
			indexCollection < collectionKeys.length;
			indexCollection++
		) {
			const collectionName =
				exportedCollections[collectionKeys[indexCollection]].name;
			const collectionItem =
				exportedCollections[collectionKeys[indexCollection]].items;
			const collectionParent =
				exportedCollections[collectionKeys[indexCollection]].parent;
			if (collectionItem.includes(selectedID)) {
				collectionArray.push(collectionName);
				collectionParentCode.push(collectionParent);
			}
		}

		//loop through the collections and search for the name of the parent collection
		if (collectionParentCode.length > 0) {
			for (
				let indexCollection = 0;
				indexCollection < collectionKeys.length;
				indexCollection++
			) {
				if (
					collectionParentCode.includes(
						exportedCollections[collectionKeys[indexCollection]].key
					)
				) {
					collectionParentArray.push(
						exportedCollections[collectionKeys[indexCollection]]
							.name
					);
				}
			}
		}

		//loop through the collections and search for the name of the grandparent collection
		if (collectionParentParent.length > 0) {
			for (
				let indexCollection = 0;
				indexCollection < collectionKeys.length;
				indexCollection++
			) {
				if (
					collectionParentParent.includes(
						exportedCollections[collectionKeys[indexCollection]].key
					)
				) {
					collectionParentArray.push(
						exportedCollections[collectionKeys[indexCollection]]
							.name
					);
				}
			}
		}

		//Add Collection to Collection Parent
		collectionParentArray = collectionParentArray.concat(collectionArray);

		//Sort the collections in alphabetical order
		collectionArray = collectionArray.sort();
		collectionParentArray = collectionParentArray.sort();

		//add a space after the divided if it is not present
		let divider = this.settings.multipleFieldsDivider;
		if (divider.slice(-1) !== " ") {
			divider = divider + " ";
		}

		//Replace the keywords in the metadata
		if (collectionArray.length > 0) {
			const collectionArrayBraket = collectionArray.map(makeWiki);
			metadata = replaceTemplate(
				metadata,
				`[[{{collections}}]]`,
				String(collectionArrayBraket.join(divider))
			);

			const collectionArrayQuotes = collectionArray.map(makeQuotes);
			metadata = replaceTemplate(
				metadata,
				`"{{collections}}"`,
				String(collectionArrayQuotes.join(divider))
			);

			const collectionArrayTags = collectionArray.map(makeTags);
			metadata = replaceTemplate(
				metadata,
				`#{{collections}}`,
				String(collectionArrayTags.join(divider))
			);

			metadata = replaceTemplate(
				metadata,
				`{{collections}}`,
				String(collectionArray.join(divider))
			);
			metadata = replaceTemplate(
				metadata,
				`{{collectionsYamlWikiList}}`,
				String(
					collectionArray
						.map((collection) => `- "${makeWiki(collection)}"`)
						.join("\n")
				)
			);
		}

		if (collectionParentArray.length > 0) {
			const collectionParentArrayBraket =
				collectionParentArray.map(makeWiki);
			metadata = replaceTemplate(
				metadata,
				`[[{{collectionsParent}}]]`,
				String(collectionParentArrayBraket.join(divider))
			);

			const collectionParentArrayQuotes =
				collectionParentArray.map(makeQuotes);
			metadata = replaceTemplate(
				metadata,
				`"{{collectionsParent}}"`,
				String(collectionParentArrayQuotes.join(divider))
			);

			const collectionParentArrayTags =
				collectionParentArray.map(makeTags);
			metadata = replaceTemplate(
				metadata,
				`#{{collectionsParent}}`,
				String(collectionParentArrayTags.join(divider))
			);
			metadata = replaceTemplate(
				metadata,
				`{{collectionsParent}}`,
				String(collectionParentArray.join(divider))
			);
		}
		return metadata;
	}

	// Function to extract the notes added manually

	// Function to import the right template

	importTemplate() {
		let template = templatePlain;
		if (this.settings.templateType === "Plain") {
			template = templatePlain;
		} else if (this.settings.templateType === "Admonition") {
			template = templateAdmonition;
		} else if (this.settings.templateType === "Custom") {
			template = this.settings.templateContent;
		}

		return template;
	}

	compareOldNewNote(
		existingNote: string,
		newNote: string,
		authorKey: string
	) {
		//Find the position of the line breaks in the old note
		const newLineRegex = RegExp(/\n/gm);
		const positionNewLine: number[] = [];
		let match = undefined;
		while ((match = newLineRegex.exec(existingNote))) {
			positionNewLine.push(match.index);
		}

		//Create an array to record where in the old note the matches with the new note are found
		const positionOldNote: number[] = [0];
		//Create an array to record which sentences of the new note need to be stored in the old note and their position in the old note
		const newNoteInsertText: string[] = [];
		const newNoteInsertPosition: number[] = [];

		//Split the new note into sentences
		const newNoteArray = newNote.split("\n");

		//Remove markdown formatting from the beginning and end of each line

		//loop through each of the lines extracted in the note
		for (
			let indexLines = 0;
			indexLines < newNoteArray.length;
			indexLines++
		) {
			let segmentWhole = "";
			let segmentFirstHalf = "";
			let segmentSecondHalf = "";
			let segmentFirstQuarter = "";
			let segmentSecondQuarter = "";
			let segmentThirdQuarter = "";
			let segmentFourthQuarter = "";
			//Create an array to record where in the old note the matches with the new note are found
			const positionArray: number[] = [-1];

			// Select the line to be searched

			//Remove formatting added by Zotero Lib View at the beginning of the line
			let selectedNewLine = newNoteArray[indexLines];
			selectedNewLine = selectedNewLine.trim();
			selectedNewLine = selectedNewLine.replace(/^- /gm, "");
			selectedNewLine = selectedNewLine.replace(/^> /gm, "");
			selectedNewLine = selectedNewLine.replace(/^=/gm, "");
			selectedNewLine = selectedNewLine.replace(/^\**/gm, "");
			selectedNewLine = selectedNewLine.replace(/^\*/gm, "");
			selectedNewLine = selectedNewLine.replace(/^"/gm, "");

			//Remove the authorkey at the end of the line
			const authorKey_Zotero = new RegExp(
				"\\(" + authorKey + ", \\d+, p. \\d+\\)$"
			);
			const authorKey_Zotfile = new RegExp(
				"\\(" + authorKey + " \\d+:\\d+\\)$"
			);
			selectedNewLine = selectedNewLine.replace(authorKey_Zotero, "");
			selectedNewLine = selectedNewLine.replace(authorKey_Zotfile, "");

			//Remove formatting added by Zotero Lib View at the end of the line
			selectedNewLine = selectedNewLine.replace(/=$/gm, "");
			selectedNewLine = selectedNewLine.replace(/\**$/gm, "");
			selectedNewLine = selectedNewLine.replace(/\*$/gm, "");
			selectedNewLine = selectedNewLine.replace(/"$/gm, "");

			//Calculate the length of the highlighted text
			if (selectedNewLine == undefined) {
				continue;
			}

			const lengthExistingLine = selectedNewLine.length;
			//Calculate the length of the comment text
			if (lengthExistingLine === 0) {
				continue;
			}

			//CHECK THE PRESENCE OF THE HIGHLIGHTED TEXT IN THE EXISTING ONE

			//Check if the entire line (or part of the line for longer lines) are found in the existing note
			if (lengthExistingLine > 1 && lengthExistingLine < 30) {
				segmentWhole = selectedNewLine;
				positionArray.push(existingNote.indexOf(segmentWhole));
			} else if (lengthExistingLine >= 30 && lengthExistingLine < 150) {
				segmentFirstHalf = selectedNewLine.substring(
					0,
					lengthExistingLine / 2
				);
				positionArray.push(existingNote.indexOf(segmentFirstHalf));

				segmentSecondHalf = selectedNewLine.substring(
					lengthExistingLine / 2 + 1,
					lengthExistingLine
				);
				positionArray.push(existingNote.indexOf(segmentSecondHalf));
			} else if (lengthExistingLine >= 150) {
				segmentFirstQuarter = selectedNewLine.substring(
					0,
					lengthExistingLine / 4
				);
				positionArray.push(existingNote.indexOf(segmentFirstQuarter));

				segmentSecondQuarter = selectedNewLine.substring(
					lengthExistingLine / 4 + 1,
					lengthExistingLine / 2
				);
				positionArray.push(existingNote.indexOf(segmentSecondQuarter));

				segmentThirdQuarter = selectedNewLine.substring(
					lengthExistingLine / 2 + 1,
					(3 * lengthExistingLine) / 4
				);
				positionArray.push(existingNote.indexOf(segmentThirdQuarter));

				segmentFourthQuarter = selectedNewLine.substring(
					(3 * lengthExistingLine) / 4 + 1,
					lengthExistingLine
				);
				positionArray.push(existingNote.indexOf(segmentFourthQuarter));
			}

			// if a match if found with the old note, set foundOld to TRUE
			if (Math.max(...positionArray) > -1) {
				//record the position of the found line in the old note
				const positionOldNoteMax = Math.max(...positionArray);
				positionOldNote.push(positionOldNoteMax);
			}
			// if a match if not found with the old note, set foundOld to FALSE and set positionOld to the position in the old note where the line break is found
			if (Math.max(...positionArray) === -1) {
				const positionOldNoteMax = Math.max(...positionOldNote);
				newNoteInsertText.push(newNoteArray[indexLines]);
				newNoteInsertPosition.push(
					positionNewLine.filter((pos) => pos > positionOldNoteMax)[0]
				);
			}
		}

		let doubleSpaceAdd = "";
		if (this.settings.isDoubleSpaced) {
			doubleSpaceAdd = "\n";
		}

		//Add the new annotations into the old note
		for (
			let indexNoteElements = newNoteInsertText.length - 1;
			indexNoteElements >= 0;
			indexNoteElements--
		) {
			const insertText = newNoteInsertText[indexNoteElements];
			const insertPosition = newNoteInsertPosition[indexNoteElements];
			existingNote =
				existingNote.slice(0, insertPosition) +
				doubleSpaceAdd +
				"\n" +
				insertText +
				existingNote.slice(insertPosition);
		}
		if (this.settings.saveManualEdits == "Save Entire Note") {
			return existingNote;
		}
		if (this.settings.saveManualEdits == "Select Section") {
			//identify the keyword marking the beginning and the end of the section not to be overwritten
			const startSave = this.settings.saveManualEditsStart;
			const endSave = this.settings.saveManualEditsEnd;

			//identify the keyword identifying the beginning of the section to be preserved is empty, the position is the beginning of the string. Otherwise find the match in the text
			let startSaveOld = 0;
			if (startSave !== "") {
				startSaveOld = existingNote.indexOf(startSave);
			}
			if (startSaveOld < 0) {
				startSaveOld = 0;
			}

			//identify the keyword identifying the end of the section to be preserved. If is empty, the position is the end of the string. Otherwise find the match in the text
			let endSaveOld: number = existingNote.length;
			if (endSave !== "") {
				endSaveOld = existingNote.indexOf(endSave) + endSave.length;
			}
			if (endSaveOld < 0) {
				endSaveOld = existingNote.length;
			}

			//Find the sections of the existing note to be preserved
			const existingNotePreserved = existingNote.substring(
				startSaveOld,
				endSaveOld
			);

			//identify the keyword identifying the beginning of the section to be preserved is empty, the position is the beginning of the string. Otherwise find the match in the text
			let startSaveNew = 0;
			if (startSave !== "") {
				startSaveNew = newNote.indexOf(startSave);
			}
			if (startSaveNew < 0) {
				startSaveNew = 0;
			}

			//identify the keyword identifying the ebd of the section to be preserved is empty, the position is the end of the string. Otherwise find the match in the text
			let endSaveNew: number = newNote.length;
			if (endSave !== "") {
				endSaveNew = newNote.indexOf(endSave) + endSave.length;
			}
			if (endSaveNew < 0) {
				endSaveNew = newNote.length;
			}

			//Find the sections of the existing note before the one to be preserved
			const newNotePreservedBefore = newNote.substring(0, startSaveNew);
			//Find the sections of the existing note after the one to be preserved
			const newNotePreservedAfter = newNote.substring(
				endSaveNew,
				newNote.length
			);

			const newNoteCombined =
				newNotePreservedBefore +
				existingNotePreserved +
				newNotePreservedAfter;

			return newNoteCombined;
		}
	}

	createNote(
		selectedEntry: Reference,
		data: {
			collections: Record<string, never> | Collection[];
			config?: Record<string, never>;
			items?: Reference[];
			version?: string;
		}
	) {
		//Extract the reference within bracket to faciliate comparison
		const authorKey = createAuthorKey(selectedEntry.creators);
		//set the authorkey field (with or without first name) on the entry to use when creating the title and to replace in the template
		selectedEntry.authorKey = authorKey;
		selectedEntry.authorKeyInitials = createAuthorKeyInitials(selectedEntry.creators)
		selectedEntry.authorKeyFullName = createAuthorKeyFullName(selectedEntry.creators)



		//create bugout to store and export logs in a file
		let bugout = new Debugout({ realTimeLoggingOn: false });
		if (this.settings.debugMode === true) {
			bugout = new Debugout({ realTimeLoggingOn: true });
		}

		//Load Template
		const templateNote = this.importTemplate();
		bugout.log("Template: \n" + templateNote);

		//Create the metadata
		let litnote: string = this.parseMetadata(selectedEntry, templateNote);
		bugout.log(selectedEntry);

		//Extract the list of collections
		litnote = this.parseCollection(selectedEntry, data, litnote);


		//Define the name and full path of the file to be exported
		const noteTitleFull = createNoteTitle(
			selectedEntry,
			this.settings.exportTitle,
			this.settings.exportPath
		);
		//Extract the annotation and the keyword from the text
		const resultAnnotations = this.extractAnnotation(
			selectedEntry,
			noteTitleFull
		);
		bugout.log(resultAnnotations.noteElements);


		//Replace annotations in the template
		litnote = litnote.replace(
			"{{PDFNotes}}",
			resultAnnotations.extractedAnnotations
		);
		litnote = litnote.replace(
			"{{UserNotes}}",
			resultAnnotations.extractedUserNote
		);


		litnote = litnote.replace(
			"{{Yellow}}",
			resultAnnotations.extractedAnnotationsYellow
		);
		litnote = litnote.replace(
			"{{Red}}",
			resultAnnotations.extractedAnnotationsRed
		);
		litnote = litnote.replace(
			"{{Green}}",
			resultAnnotations.extractedAnnotationsGreen
		);
		litnote = litnote.replace(
			"{{Blue}}",
			resultAnnotations.extractedAnnotationsBlue
		);
		litnote = litnote.replace(
			"{{Purple}}",
			resultAnnotations.extractedAnnotationsPurple
		);
		litnote = litnote.replace(
			"{{Black}}",
			resultAnnotations.extractedAnnotationsBlack
		);
		litnote = litnote.replace(
			"{{White}}",
			resultAnnotations.extractedAnnotationsWhite
		);
		litnote = litnote.replace(
			"{{Gray}}",
			resultAnnotations.extractedAnnotationsGray
		);
		litnote = litnote.replace(
			"{{Cyan}}",
			resultAnnotations.extractedAnnotationsCyan
		);
		litnote = litnote.replace(
			"{{Orange}}",
			resultAnnotations.extractedAnnotationsOrange
		);
		litnote = litnote.replace(
			"{{Magenta}}",
			resultAnnotations.extractedAnnotationsMagenta
		);
		litnote = litnote.replace(
			"{{CustomHex}}",
			resultAnnotations.extractedAnnotationsCustomHex
		);
		litnote = litnote.replace(
			"{{Images}}",
			resultAnnotations.extractedImages
		);

		let extractedKeywords = resultAnnotations.extractedKeywords;
		if (extractedKeywords == undefined) {
			extractedKeywords = [];
		}

		// Join the tags in the metadata with the tags extracted in the text and replace them in the text
		litnote = replaceTagList(
			selectedEntry,
			extractedKeywords,
			litnote,
			this.settings.multipleFieldsDivider
		);

		//delete the missing fields in the metadata
		const missingFieldSetting = this.settings.missingfield;
		litnote = replaceMissingFields(
			litnote,
			missingFieldSetting,
			this.settings.missingfieldreplacement
		);
		// Compare old note and new note
		if (
			this.settings.saveManualEdits !== "Overwrite Entire Note" &&
			fs.existsSync(noteTitleFull)
		) {
			//Check if the settings in settings.saveManualEdits are TRUE. In that case compare existing file with new notes. If false don't look at existing note
			//Check if an old version exists. If the old version has annotations then add the new annotation to the old annotaiton

			const existingNoteAll = String(fs.readFileSync(noteTitleFull));


			litnote = this.compareOldNewNote(
				existingNoteAll,
				litnote,
				authorKey
			);
		}

		//Export the file
		bugout.log("NoteTitleFull: " + noteTitleFull);
		bugout.log("Final Note: " + litnote);
		bugout.log(this.settings);
		if (this.settings.debugMode === true) {
			bugout.downloadLog();
		}
		fs.writeFile(noteTitleFull, litnote, function (err) {
			if (err) console.log(err);
		});
		new Notice(`Imported ${selectedEntry.citationKey}!`);
	}

	checkSQLite() {



		//const db = require('better-sqlite3')('/Users/stefanopagliari/Zotero/zotero.sqlite');

		//const db = new Database('/Users/stefanopagliari/Zotero/zotero.sqlite');
		//const defaultRoot = path.join(homedir(), "Zotero");
		//zoteroDbPath: path.join(defaultRoot, "zotero.sqlite"),

	}

	updateCurrentNote(){
		console.log("Updating Current Note");

		// Check if the json file exists
		const jsonPath = (this.app.vault.adapter as any).getBasePath() + "/" + this.settings.bibPath
		if (!fs.existsSync(jsonPath)) { new Notice("No BetterBibTex Json file found at " + jsonPath) }

		const rawdata = fs.readFileSync(
			(this.app.vault.adapter as any).getBasePath() +
			"/" +
			this.settings.bibPath
		);
		const data = JSON.parse(rawdata.toString()); // rawdata is a buffer, converted to strin

		// Find the citeKey of current note in file name
		const currentNoteName = this.app.workspace.getActiveFile().name
		const noteTitleFormat = this.settings.exportTitle+'.md'

		const citeKey = parseCiteKeyFromNoteName(currentNoteName, noteTitleFormat);
	
		if (citeKey != null){
			// find entry in library using citeKey
			const entryIndex = data.items.findIndex(
				(item: { citationKey: string }) =>
					item.citationKey ===
					citeKey
			);
			if (entryIndex!=-1){
				// update current note
				const currentEntry:Reference = data.items[entryIndex]
				this.createNote(currentEntry, data);
				new Notice("Current Note " + currentNoteName + " updated");
			}
			else{
				new Notice("Current Note " + currentNoteName + " not found in the library");
			}
		}else{
			new Notice("Cannot find citeKey from Current Note:" + currentNoteName);
		}
	}
}

// Helper functions for Zotero Lib View
function discoverLibraryFieldNames(data: any): string[] {
	if (data == null || !Array.isArray(data.items)) return [];
	const fields = new Set<string>();
	for (const item of data.items) {
		if (item == null || typeof item !== "object") continue;
		for (const key of Object.keys(item)) {
			if (EXCLUDED_DYNAMIC_LIBRARY_FIELDS.has(key)) continue;
			fields.add(key);
		}
	}
	return Array.from(fields).sort((a, b) => a.localeCompare(b));
}

function discoverLibrarySubFields(data: any): Record<string, string[]> {
	if (data == null || !Array.isArray(data.items)) return {};
	const result: Record<string, Set<string>> = {};
	for (const item of data.items) {
		if (item == null || typeof item !== "object") continue;
		for (const key of Object.keys(item)) {
			let val = item[key];
			if (Array.isArray(val) && val.length > 0) val = val[0];
			if (val != null && typeof val === "object" && !Array.isArray(val)) {
				if (!result[key]) result[key] = new Set();
				Object.keys(val).forEach(sk => result[key].add(sk));
			}
		}
	}
	const finalResult: Record<string, string[]> = {};
	for (const key in result) {
		finalResult[key] = Array.from(result[key]).sort();
	}
	return finalResult;
}

function collectLibrarySearchValues(value: any, results: string[]) {
	if (value == null) return;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		results.push(String(value));
		return;
	}
	if (Array.isArray(value)) {
		value.forEach(item => collectLibrarySearchValues(item, results));
		return;
	}
	if (typeof value === "object") {
		Object.values(value).forEach(item => collectLibrarySearchValues(item, results));
	}
}

function normalizeDivider(divider: string): string {
	if (divider && divider.slice(-1) !== " ") return divider + " ";
	return divider || "; ";
}

function createNotePathShort(selectedEntry: any, exportTitle: string, exportPath: string): string {
    let title = exportTitle;
    title = title.replace(/\{\{citeKey\}\}/g, selectedEntry.citationKey || "");
    title = title.replace(/\{\{citationKey\}\}/g, selectedEntry.citationKey || "");
    title = title.replace(/\{\{title\}\}/g, selectedEntry.title || "");
    title = title.replace(/\{\{author\}\}/g, selectedEntry.authorKey || "");
    title = title.replace(/\{\{authors\}\}/g, selectedEntry.authorKey || "");
    title = title.replace(/\{\{year\}\}/g, selectedEntry.year || "");
    title = title.replace(/[/\b?%*:|"<>]/g, "");
    return normalizePath(exportPath + "/" + title + ".md");
}

function normalizeItemTypeForLibrary(itemType: string): string {
	switch (itemType) {
		case "journalArticle": return "Article";
		case "book": return "Book";
		case "bookSection": return "Chapter";
		case "conferencePaper": return "Conference";
		case "thesis": return "Thesis";
		case "webpage": return "Web";
		case "report": return "Report";
		default: return itemType ? itemType.charAt(0).toUpperCase() + itemType.slice(1) : "";
	}
}

function normalizeYearForLibrary(date: string): string {
	if (!date) return "";
	const match = date.match(/\d{4}/);
	return match ? match[0] : "";
}

function getTagsForLibraryEntry(entry: any): string[] {
	if (!entry.tags || !Array.isArray(entry.tags)) return [];
	return entry.tags.map((t: any) => t.tag || t).filter((t: any) => !!t);
}

function getCollectionsForLibraryEntry(entry: any, data: any, divider: string): string {
	return getCollectionNamesForLibraryEntry(entry, data, divider, false);
}

function getParentCollectionsForLibraryEntry(entry: any, data: any, divider: string): string {
	return getCollectionNamesForLibraryEntry(entry, data, divider, true);
}

function getCollectionNamesForLibraryEntry(entry: any, data: any, divider: string, parentsOnly: boolean): string {
	const selectedID = entry.itemID == null ? "" : String(entry.itemID);
	const exportedCollections = data?.collections;
	const directCollections = formatLibraryFieldValue(entry.collections, divider);
	if (selectedID === "" || exportedCollections == null) return parentsOnly ? "" : directCollections;

	const collections = Object.values(exportedCollections);
	const collectionsByKey = new Map<string, any>();
	collections.forEach((collection: any) => {
		if (collection?.key != null) collectionsByKey.set(String(collection.key), collection);
	});

	const matchedCollections = collections
		.filter((collection: any) => Array.isArray(collection?.items) && collection.items.map((item: any) => String(item)).includes(selectedID));

	const selectedCollections = new Map<string, any>();
	const addCollection = (collection: any) => {
		if (collection == null) return;
		const key = collection.key != null ? String(collection.key) : String(collection.name || "");
		if (key !== "") selectedCollections.set(key, collection);
	};

	matchedCollections.forEach((collection: any) => {
		if (!parentsOnly) addCollection(collection);
		let parentKey = collection?.parent == null ? "" : String(collection.parent);
		const seenParentKeys = new Set<string>();
		while (parentKey !== "") {
			if (seenParentKeys.has(parentKey)) break;
			seenParentKeys.add(parentKey);
			const parentCollection = collectionsByKey.get(parentKey);
			if (parentCollection == null) break;
			addCollection(parentCollection);
			parentKey = parentCollection.parent == null ? "" : String(parentCollection.parent);
		}
	});

	const collectionNames = Array.from(selectedCollections.values())
		.map((collection: any) => collection?.name)
		.filter((name: any): name is string => typeof name === "string" && name.trim() !== "")
		.sort((first, second) => first.localeCompare(second));

	return collectionNames.length > 0 ? collectionNames.join(divider) : parentsOnly ? "" : directCollections;
}

function formatPrimaryCreatorListForLibrary(creators: any[], divider: string, nameFormat: string): string {
	if (!creators || creators.length === 0) return "";
	const list = creators.filter(c => c.creatorType === "author" || c.creatorType === "editor").map(c => {
		if (c.name) return c.name;
		let name = nameFormat;
		name = name.replace("{{lastName}}", c.lastName || "");
		name = name.replace("{{firstName}}", c.firstName || "");
		return name.trim();
	});
	if (list.length === 0) return "";
	if (list.length === 1) return list[0];
	if (list.length === 2) return list[0] + divider + list[1];
	return list[0] + " et al.";
}

function formatLibraryFieldValue(value: any, divider: string, mappingProperty?: string): string {
	if (value == null) return "";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		let str = String(value);
		if (typeof value === "string") {
			str = str.replace(/<\/?[^>]+(>|$)/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
		}
		return str.trim();
	}
	if (Array.isArray(value)) {
		return value.map(item => formatLibraryFieldValue(item, divider, mappingProperty)).filter(item => item !== "").join(divider);
	}
	if (typeof value === "object") {
		if (typeof value.firstName === "string" || typeof value.lastName === "string") {
			return [value.firstName || "", value.lastName || ""].join(" ").trim();
		}
		if (mappingProperty && (typeof value[mappingProperty] === "string" || typeof value[mappingProperty] === "number")) {
			return formatLibraryFieldValue(value[mappingProperty], divider, mappingProperty);
		}
		const candidateKeys = ["note", "path", "tag", "name", "title", "label", "key", "citationKey", "itemKey", "uri", "url"];
		for (const key of candidateKeys) {
			if (typeof value[key] === "string" || typeof value[key] === "number") {
				return formatLibraryFieldValue(value[key], divider, mappingProperty);
			}
		}
		try {
			return JSON.stringify(value);
		} catch (error) {
			return "";
		}
	}
	return "";
}
