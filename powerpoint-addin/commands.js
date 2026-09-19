/**
 * Ribbon command function handlers (registered via commands.html's
 * FunctionFile). Currently no ExecuteFunction ribbon buttons are defined in
 * manifest.xml (the "Live Survey" button uses ShowTaskpane instead), so this
 * file just registers Office.actions with Office.onReady for forward
 * compatibility, in case future ribbon buttons need direct actions (e.g. a
 * one-click "Refresh all slides" command) without opening the task pane.
 */

Office.onReady(() => {
  // Example of how a future direct ribbon action would be registered:
  //
  // Office.actions.associate('refreshAllSlides', async (event) => {
  //   try {
  //     // ... call backend + PowerPoint.run to refresh every slide's shapes ...
  //   } finally {
  //     event.completed();
  //   }
  // });
});
