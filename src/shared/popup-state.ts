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

export function shouldApplyRuntimeSnapshot(
  requestRevision: number,
  currentRevision: number
): boolean {
  return requestRevision === currentRevision;
}

export function shouldApplyTranslationJobAction(
  targetRequestId: string,
  currentJob: TranslationJobState | null,
  responseJob: TranslationJobState | null
): boolean {
  if (targetRequestId !== currentJob?.requestId) return false;
  if (responseJob?.requestId !== currentJob.requestId) return true;
  if (responseJob.updatedAt < currentJob.updatedAt) return false;
  return !(
    currentJob.state !== "running" &&
    responseJob.state === "running"
  );
}

export function shouldLockModelControls(options: {
  preparing: boolean;
  clearingCache: boolean;
  updatingSettings: boolean;
}): boolean {
  return options.preparing || options.clearingCache || options.updatingSettings;
}

export function shouldApplyUntrackedTranslationResponse(options: {
  requestRevision: number;
  currentRevision: number;
  jobRequestIdAtStart: string | null;
  currentJobRequestId: string | null;
}): boolean {
  return (
    options.requestRevision === options.currentRevision &&
    options.jobRequestIdAtStart === options.currentJobRequestId
  );
}

export function shouldApplyTrackedTranslationResponse(
  requestId: string,
  currentJob: TranslationJobState | null
): boolean {
  return currentJob?.requestId === requestId && currentJob.state === "running";
}
import type { TranslationJobState } from "./protocol";
