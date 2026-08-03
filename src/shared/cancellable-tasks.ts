export class TaskCancelledError extends Error {
  constructor() {
    super("작업을 취소했습니다.");
    this.name = "TaskCancelledError";
  }
}

export async function runCancellableTasks<Input, Output>(
  inputs: readonly Input[],
  run: (input: Input) => Promise<Output>,
  isCancelled: () => boolean
): Promise<Output[]> {
  const outputs: Output[] = [];
  for (const input of inputs) {
    if (isCancelled()) throw new TaskCancelledError();
    const output = await run(input);
    if (isCancelled()) throw new TaskCancelledError();
    outputs.push(output);
  }
  return outputs;
}
