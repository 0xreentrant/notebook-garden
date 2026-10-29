# Manual tests

## Tailscale

- [ ] `npm run dev:tailscale` prints `https://notebook-garden.<tailnet>.ts.net`. That URL loads the app. `npm run dev` still serves `http://localhost:5176`.

Short checks for user-visible behavior that automated tests do not fully cover. The merge routes are covered in `test/notebook-merge.e2e.test.ts`. These steps are the screens.

## Merge notebooks

- [ ] Notebooks: select two notebooks whose source counts add up to 50 or fewer. Merge. The notebook with more sources is already selected. Merge. The dialog says how many sources were added, the destination count matches, and the other notebook is still in the list.
- [ ] Select notebooks whose source counts add up to more than 50. The warning names that total and loads a source checklist. Sources already on the destination are checked and locked. Duplicates and sources with no URL are unchecked and locked. Merge stays disabled. Uncheck sources until the count is 50 or under, then Merge. The destination count matches that number, the other notebooks are unchanged, and the notebooks you had checked stay checked.
- [ ] In that same over-50 dialog, choose New notebook, type a title, and leave enough sources checked to stay at or under 50. Merge opens the new notebook's count at that number. The selected notebooks are still in the list, and their checkboxes are still checked.
- [ ] After a merge that stayed at or under 50, those notebook checkboxes are cleared.

## Add sources across connectors

- [ ] Check items on YouTube and Bookmarks, then on LinkedIn or Reddit open Bulk add to existing notebook. The dialog count is the total from every connector, and Add to notebook plants all of those URLs. The same is true for Bulk insert to new notebook. Pin, tag, and delete still apply only to the open connector. If a second add finishes while the first NotebookLM create is still running, the first create does not replace the newer notebook link.

## Add sources over 50

- [ ] YouTube: select enough videos that a new notebook would pass 50 sources. Bulk insert to new notebook. Choose sources opens. Uncheck until the count is at or under 50. Create notebook stays disabled until then. Create notebook opens NotebookLM and links only the checked videos. Back on YouTube, every video you had selected before the dialog is still checked, including ones you unchecked only inside Choose sources.
- [ ] YouTube: open that same path and Cancel Choose sources. The same videos stay checked, and the selected count is unchanged.
- [ ] YouTube: Bulk add to existing notebook, pick a notebook that would pass 50 with the selection. Choose sources shows that notebook's current count. Uncheck until it fits. Add to notebook adds only the checked URLs. The YouTube selection is still checked afterward. Cancel on this dialog also leaves the selection checked.
- [ ] Bookmarks: repeat the new-notebook and existing-notebook paths, including Cancel. Duplicates in the checklist are unchecked and locked. Bookmark checks stay on after Cancel and after Create notebook or Add to notebook.

## Selection across connector tabs

- [ ] YouTube: check a few videos. Open Bookmarks and check a bookmark. Open Notebooks and check a notebook. Return to YouTube: the same videos are still checked. Bookmarks: that bookmark is still checked. Notebooks: that notebook is still checked. Each tab keeps its own selection.

## Reddit saved

- [ ] `npm run reddit:saved-login` opens the login page once and does not reload it. It prints `Reddit saved login OK`. `npm run reddit:saved-collect -- --limit 5` then Reload lists those saves. A 429 stops either script without another request. Create notebook on a link post uses the outbound URL. Create notebook on a self post or comment uses the Reddit permalink. Copy text copies the body. A later collect keeps a local delete and a notebook link.
