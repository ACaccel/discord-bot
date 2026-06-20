/**
 * Stream-agnostic progress writer, ported verbatim from the standalone
 * `verify_db` tool. Commands wire it to `process.stderr` so the stdout
 * JSON report stays uncluttered; tests inject an in-memory sink to assert
 * on the emitted control sequences.
 *
 * When `tty` is true the writer uses a `\r` + ANSI clear-line escape so
 * the same physical line is rewritten in place (an operator watching live
 * sees one line per step). When false, each call writes a fresh line
 * terminated by `\n` so CI / file-redirected logs stay readable.
 */
export interface ProgressSink {
  write(text: string): void;
}

export const createProgressWriter = (
  sink: ProgressSink,
  tty: boolean,
): ((line: string, terminate: boolean) => void) => {
  return (line: string, terminate: boolean): void => {
    if (tty) {
      sink.write(`\r\x1b[2K${line}${terminate ? '\n' : ''}`);
    } else {
      sink.write(`${line}\n`);
    }
  };
};
