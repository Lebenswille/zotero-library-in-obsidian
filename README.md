# Zotero Library in Obsidian

This project is modified from the original [bibnotes](https://github.com/stefanopagliari/bibnotes) project by Stefano Pagliari, and is maintained at [Lebenswille/zotero-library-in-obsidian](https://github.com/Lebenswille/zotero-library-in-obsidian).

Zotero Library in Obsidian is an Obsidian plugin for importing, updating, and browsing a Zotero library exported as Better BibTeX JSON. It keeps the note-generation workflow of the original bibnotes project, and extends it with a structured in-app library view designed for managing references directly inside Obsidian.

## What This Fork Adds

Compared with the original bibnotes project, this fork adds a Zotero-library-first workflow inside Obsidian:

- a dedicated **Library View** that reads your exported Better BibTeX JSON directly
- open the library in a **normal tab** or in the **right sidebar**
- **custom Obsidian URI support** for opening the library view from links
- `obsidian://zotero-library?vault=YourVault&view=tab`
- `obsidian://zotero-library?vault=YourVault&view=sidebar`
- **automatic sync when `My Library.json` changes**
- **configurable visible columns** in the library table, with custom ordering
- **click-to-sort** table headers
- **note-aware library entries**
- clicking `Notes` opens the corresponding literature note
- if the note does not exist, it is created from the current template and then opened automatically
- if the note was deleted, it can be recreated on demand from the library view
- a **note-page header button** that opens the library view from eligible reference notes
- updated branding, commands, and documentation for the forked project

## Main Features

- import literature notes from a Better BibTeX JSON export
- update existing notes without losing your chosen preservation behavior
- format Zotero annotations and comments into your preferred Obsidian note style
- browse your references in a structured table inside Obsidian
- search, sort, and tailor the displayed metadata columns
- jump from the library view to the generated reference note, Zotero item, or external URL

## Recommended Workflow

1. Export your Zotero library as **Better BibTeX JSON**.
2. Save the exported file inside your Obsidian vault, for example `References/My Library.json`.
3. Point the plugin settings to that JSON file and to your reference-note folder.
4. Let the plugin generate and update literature notes from your template.
5. Use the Library View to search, sort, and open notes directly inside Obsidian.

![](/images/ExampleNote.jpg)

## Installation

The plugin is currently not registered as a standard community plugin for downloading or updating within Obsidian. To install it manually, clone or unzip the latest release into your vault's `.obsidian/plugins/` directory, then enable it in Obsidian.

An alternative if you have the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat/) installed: use `Lebenswille/zotero-library-in-obsidian` to add Zotero Library in Obsidian as a Beta plugin, then enable it in the Community plugins tab.

## Library View

The custom Library View is the main addition of this fork.

- It reads the Better BibTeX JSON file directly.
- It can be opened in a tab or in the sidebar.
- It supports configurable columns such as `Notes`, `Year`, `Type`, `Title`, `Authors`, `Publication`, `Tags`, `Added`, and `Actions`.
- Column order can be customized in plugin settings.
- The search box can search across the full Better BibTeX JSON record for each entry, not only the currently visible columns.
- Clicking a sortable table header changes the sorting order.
- Clicking the leftmost `Obsidian Notes` entry opens the corresponding note, or creates it from the current template if it does not exist yet.
- The view refreshes when the exported library JSON changes.

## Opening The Library View

You can open the library view in several ways:

- from the command palette
- from supported note-page header actions
- from an Obsidian URI link such as
- `obsidian://zotero-library?vault=Research&view=tab`
- `obsidian://zotero-library?vault=Research&view=sidebar`

## Note-Page Header Button

The plugin can add a header button to eligible literature notes so you can jump back to the Library View directly from the note page.

- Open a note created by this plugin or a note that includes the expected `Zotero Library` frontmatter field.
- Look for the library icon in the note header actions area.
- Click it to open the Zotero Library View in a normal tab.
- This is useful when you are reading or editing a literature note and want to return to the library entry quickly.

## Importing your Zotero Library into Obsidian

To import your references and notes from Zotero, export your library as a Better BibTeX JSON file and save it inside your vault. Then follow these steps:

- install within Zotero the plugin ["Better BibTex for Zotero"](https://retorque.re/zotero-better-bibtex/installation/). For more information on how to install the plugin see the instructions on the [website of the plugin](https://retorque.re/zotero-better-bibtex/installation/).
- in the main menu of Zotero go to File > Export Library (to export the entire library). It is also possible to to export a specific collection or group of references by selecting these, right-click, and then selecting "export collection" (in the case of a folder) or "export items" (in the case of a collection of references.
- select the export format "**BetterBibTex Json**".
- select "Export Notes" if you would like to import into Obsidian the annotation.
- *(Optional)* select "Keep updated" to automatically update the exported library once an entry is added/deleted/amended
- save the BetterBibTex JSON file in a folder **within** your Obsidian Vault
- in the plugin settings within Obsidian add the relative path within your vault of the library to be imported, as well as the relative path within your vault of the folder where you would like the literature notes to be stored. For instance, add `library.json` if the file (library.json) is in the root folder. Instead, if the file is in a subfolder, specify first the subfolder followed by the name of the file (e.g. 'zotero/library.json' if the json file is located in a subfolder of your vault called 'zotero'.

![](/images/Export_Zotero.jpg)

## Commands

The plugin includes the original note-generation workflow together with the new library view workflow:

- **Create/Update Literature Note**: when you select this command you will be prompted to chose one of references from the library you have imported. If the reference has not been imported yet in the specified folder, a new note will be generated. If a note already exists, its content will be updated without over-writing the existing annotation (e.g. comments added manually from within Obsidian and block-references will not be over-written). The first option ("Entire Library") can be selected to create/update all the notes from the imported library.

![](/images/SelectCommandExample.png)

- **Update Library**: when you select this command, the plugin will generate/update all the notes that have been modified from Zotero since the last time the same command was selected. If this is the first time that you select this command, then the plugin will create/update literature notes for all the entries in the imported bibliography.

- **Open Zotero Library View in Tab**: open the structured library view in a normal Obsidian tab.

- **Open Zotero Library View in Sidebar**: open the structured library view in the sidebar.

## Create Literature Notes

By default the plugin will export both the metadata and the notes stored in Zotero for the selected reference. Both can be deselected in the plugin settings. The main configurations related to the format of the notes are the following:

- **Export Path**: in the plugin settings, add the relative folder within your Obsidian vault where the literature notes will be stored. In the field is left empty, the notes will be exported in the main folder.
- **Note Title**: In the plugin setting you can specify the format of the note title. Possible values include:
  - {{citeKey}},
  - {{title}},
  - {{author}},
  - {{year}}
- **Template**: It is possible to select among two existing templates (one presenting the metadata as a simple list and the other wrapping the information into boxes using the Admonition plugin) or to or provide a custom template (see below).
- **Fields**: It is possible to include in your custom template all the fields found in the Better Bibtex json file, as well as additional ones created by the plugin. These include:
  - {{title}}
  - {{shortTitle}}
  - {{citeKey}} or {{citationKey}}
  - {{itemType}}
  - {{author}}
  - {{editor}}
  - {{creator}}: all the individual listed as creators, including authors, editors, etc...
  - {{translator}}
  - {{publisher}}
  - {{place}}
  - {{series}}
  - {{seriesNumber}}
  - {{publicationTitle}}
  - {{volume}}
  - {{issue}}
  - {{pages}}
  - {{year}}
  - {{dateAdded}}
  - {{dateModified}}
  - {{DOI}}
  - {{ISBN}}
  - {{ISSN}}
  - {{abstractNote}}
  - {{url}}
  - {{uri}}: link to the entry on the Zotero website
  - {{eprint}}
  - {{file}}: local path of the file attached to the entry
  - {{filePath}}: links to the attachments associated with this entry within zotero (without opening the reader).
  - "{{zoteroReaderLink}}": links to open the specific attachment within the Zotero reader. This is different from {{file}} that opens the attachment in an external reader
  - {{localLibrary}}: link to the entry on the Zotero app
  - {{select}}: link to the attachment on the Zotero app
  - {{keywordsZotero}}: tags found in the metadata of the entry
  - {{keywordsPDF}}: tags extracted from the PDF
  - {{keywords}}, {{keywordsAll}}: both tags found in the metadata of the entry and tags extracted from the PDF
  - {{collections}}: collections/folders where the entry is located
  - {{collectionsParent}}: collections/folders where the entry is located, plus the parent folders to these
  - {{PDFNotes}}: all the highlights, comments, and images extracted from the PDF, in the order in which they appear
  - {{Yellow}}, {{Red}}, {{Green}}, {{Black}}, {{White}}, {{Gray}}, {{Cyan}}, {{Magenta}}, {{Orange}}: all the highlights of a certain colour
  - {{UserNotes}}: notes manually created within Zotero
  - {{Images}}: all the images extracted via the Zotero PDF Reader
- It is also possible to wrap the placeholders into [[ ]] in order to create notes or to preface them with a tag(#). You can also preface a field with :: in order to create Dataview fields.
- **Missing Fields**: Fields that are present in the template but missing in the entry are deleted by default. This can be changed in the settings.

## Basic Formatting

In the settings of the plugin, it is possible to select the formatting of the **highlights** and **comments** extracted from the text. These include:

- **Double Space**
- **Italic**
- **Bold**
- **Quotation Marks**
- **Highlight**
- **Bullet Points**
- **Blockquote**
- **Custom text before or after all highlights**
- **Custom text before or after all comments**

## Additional Highlight Formatting

It is possible to perform additional transformations to designated highlighted sentences. The transformations currently included in the plugin are:

- **Heading**: Turn highlighted text into a heading (Level 1 to 6).

![](/images/exampleHeading.png)

- **MergeAbove**: Append highlight to the previous one (e.g. to merge paragraph across two pages).

![](/images/exampleMergeAbove.jpg)

- **Preprend Comment**: Place the text of the comment at the beginning of the highlight (rather than at the end as by default).

![](/images/exampleCommentPrepend.jpg)

- **Keyword**: Add the highlighted text to the list of keywords listed under the ({{keywords}}) placeholder in the template.

![](/images/exampleKeyword.png)

- **Todo**: Transform the highlight or comments into a task ("- [ ]").

![](/images/exampleToDo.png)

- **Custom Text**: Add custom text before or after a specific highlight

### Keywords

Transformations can be triggered by adding a dedicated "keyword" at the beginning of the comment to the specific highlight. This can be a single character (e.g. #) or a single word (e.g. todo). When this character/word is found at the beginning of a comment, the text of the comment or the highlighted text will be reformatted. The keywords can be defined in the settings of the plugin

### Highlight Colour

In addition to using dedicated keywords at the beginning of a comment, it is possible to apply specific styling or transformations to highlights based on the colour of the highlight. The plugin recognize the highlight colour extracted by:

- **Zotero** native reader (yellow, red, green, blue, purple)
- **Zotfile** plugin (black, white, gray, red,orange, yellow, green, cyan, blue, magenta). In order to export the highlight colour you will need to activate this function by going to the main menu of Zoter and selecting Preferences --> Advanced --> Config Editor. Search for "extensions.zotfile.pdfExtraction.colorAnnotations" and turn the value to "true". It is also important that the value "extensions.zotfile.pdfExtraction.colorCategories" is restored to the default value.

### Updating Existing Notes

In the case you are updating an existing note, you can decide in the plugin settings whether to

- over-write the existing note completely ("Overwrite Entire Note")
- preserve the existing note and only add new sentences that were not included in the existing note ("Save Entire Note")  
- preserve the existing note and add non-overlapping sentences only in a specific section, while over-writing the rest ("Select Section"). When the "Select Section" is chosen, the plugin will ask for a string identifying the beginning and/or end of the section to be updated (rather than overwritten). If the "start" field is left empty, the existing text will be preserved from to the beginning of the note. If the "end" field is left empty, the existing text will be preserved until  the end of the note. For instance, in order to over-write the metadata but maintain changes made manually to the extracted annotations, the start of the section to be preserved should be set to the unique title used in the template before the metadata (e.g. "## Extracted Annotations").
