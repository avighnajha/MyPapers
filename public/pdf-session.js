// PDF.js 6 disposes documents through their loading task, not PDFDocumentProxy.
export async function closePdfSession(state) {
  const task = state.pdfTask;
  state.pdfTask = null;
  state.pdf = null;
  if (task) await task.destroy();
}
