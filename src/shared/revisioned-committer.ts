export class RevisionedCommitter {
  private editedRevision = 0;
  private requestedRevision = 0;
  private savedRevision = 0;
  private commitRequest = 0;
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly save: () => Promise<boolean>) {}

  markDirty(): void {
    this.editedRevision += 1;
  }

  commit(): Promise<void> {
    this.requestedRevision = this.editedRevision;
    this.commitRequest += 1;
    if (!this.flushPromise) {
      this.flushPromise = this.flush().finally(() => {
        this.flushPromise = null;
      });
    }
    return this.flushPromise;
  }

  isDirty(): boolean {
    return this.savedRevision < this.editedRevision;
  }

  private async flush(): Promise<void> {
    while (this.savedRevision < this.requestedRevision) {
      const savingRevision = this.requestedRevision;
      const savingRequest = this.commitRequest;
      const saved = await this.save();
      if (saved) {
        this.savedRevision = Math.max(this.savedRevision, savingRevision);
      } else if (this.commitRequest === savingRequest) {
        return;
      }
    }
  }
}
