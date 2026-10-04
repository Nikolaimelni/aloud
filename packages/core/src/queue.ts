/**
 * Calls `run` in arrival order, each one after the last has settled. A worker gets its
 * messages as they come, and an async handler would otherwise start the next before the
 * previous one finished with the state they share.
 */
export function queued<T>(run: (input: T) => Promise<void>): (input: T) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return (input) => {
    const turn = tail.then(() => run(input));
    tail = turn.catch(() => undefined);
    return turn;
  };
}
