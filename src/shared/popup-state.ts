export function shouldApplyInitialSelection(options: {
  requestRevision: number;
  currentRevision: number;
  currentValue: string;
  selectionText: string;
}): boolean {
  return (
    Boolean(options.selectionText) &&
    options.requestRevision === options.currentRevision &&
    options.currentValue.length === 0
  );
}
