'use strict';

// How often, at most, the progress line is redrawn in a terminal. Drawing is throttled by time rather
// than by document, so that cloning a million small documents costs no more output than a hundred.
const REDRAW_INTERVAL = 100;

// How often a progress line is written when the output is not a terminal (a log file or a pipe),
// where a line cannot be redrawn in place.
const LOG_INTERVAL = 30000;

const BAR_WIDTH = 24;

// The rate, and the time left, are measured over this much of the most recent progress, so that they
// follow how fast the clone is going now rather than how fast it went on average.
const RATE_WINDOW = 20000;

// How often a point of the rate window is recorded.
const SAMPLE_INTERVAL = 1000;

/**
 * Format a number with thousands separators.
 * @param {number} value - The number.
 */
function number(value) {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Format a duration, in milliseconds, as something like "1h 4m" or "52s".
 * @param {number} ms - The duration.
 */
function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The progress of one collection being cloned: a bar when the number of documents is known, and a
 * running count when it is not.
 */
class Progress {
  /**
   * @param {string} label - What is being counted, such as "         - Submissions:".
   * @param {object} options - The progress options.
   * @param {number|null} options.total - How many documents there are, when it is known.
   * @param {object} options.stream - Where the progress is written (defaults to stdout).
   * @param {boolean} options.interactive - Whether the line can be redrawn in place.
   */
  constructor(label, options = {}) {
    this.label = label;
    this.total = (typeof options.total === 'number') ? options.total : null;
    this.stream = options.stream || process.stdout;
    this.interactive = (typeof options.interactive === 'boolean') ? options.interactive : !!this.stream.isTTY;
    this.count = 0;
    this.started = Date.now();

    // The rate is measured from the first document, never from the start: the source can take a long
    // time to hand over its first document (sorting a large form), and that wait is not progress.
    this.firstTick = null;
    this.samples = [];

    // A terminal shows the line straight away; a log only hears about it every LOG_INTERVAL.
    this.drawn = this.interactive ? 0 : this.started;
    this.logged = false;
    this.stream.write(`\n${label}`);
  }

  /**
   * The number of documents became known after the progress started: draw it as a bar from now on.
   * @param {number} total - The number of documents.
   */
  setTotal(total) {
    this.total = total;
    if (this.interactive) {
      this.drawn = 0;
    }
  }

  /**
   * Count documents that have been cloned.
   * @param {number} count - How many.
   */
  tick(count = 1) {
    const now = Date.now();
    if (this.firstTick === null) {
      this.firstTick = now;
      this.samples.push({time: now, count: this.count});
    }
    this.count += count;
    if (now - this.samples[this.samples.length - 1].time >= SAMPLE_INTERVAL) {
      this.samples.push({time: now, count: this.count});
      // Keep one point from before the window, so that the whole window is measured.
      while (this.samples.length > 2 && this.samples[1].time <= now - RATE_WINDOW) {
        this.samples.shift();
      }
    }
    if (now - this.drawn >= (this.interactive ? REDRAW_INTERVAL : LOG_INTERVAL)) {
      this.drawn = now;
      this.render(now, false);
    }
  }

  /**
   * Something else is about to be written (an error): end the progress line so that it does not end
   * up in the middle of it. The line is drawn again on the next tick.
   */
  interrupt() {
    if (this.interactive) {
      this.stream.write('\n');
      this.drawn = 0;
    }
  }

  /**
   * Write the final state of the progress.
   */
  done() {
    this.render(Date.now(), true);
  }

  /**
   * Describe the progress.
   * @param {number} now - The current time.
   * @param {boolean} final - Whether this is the final state.
   */
  text(now, final) {
    const elapsed = now - this.started;
    const parts = [];
    if (this.total) {
      const ratio = Math.min(this.count / this.total, 1);
      const filled = Math.round(ratio * BAR_WIDTH);
      parts.push(`[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`);
      parts.push(`${Math.floor(ratio * 100)}%`);
      parts.push(`${number(this.count)}/${number(this.total)}`);
    }
    else {
      parts.push(number(this.count));
    }
    const rate = this.rate(now, final);
    // A rate below one a second rounds to nothing useful, so it is left out.
    if ((rate >= 1) && (this.count > 1)) {
      parts.push(`${number(rate)}/s`);
    }
    if (final) {
      if (elapsed >= 1000) {
        parts.push(`in ${duration(elapsed)}`);
      }
    }
    else if (this.total && (rate > 0) && (this.count < this.total)) {
      parts.push(`ETA ${duration(((this.total - this.count) / rate) * 1000)}`);
    }
    return parts.join(' ');
  }

  /**
   * The number of documents a second: over the recent window while the clone is going, and over the
   * whole run (from the first document) once it is done.
   * @param {number} now - The current time.
   * @param {boolean} final - Whether this is the final state.
   */
  rate(now, final) {
    if (this.firstTick === null) {
      return 0;
    }
    const from = final ? {time: this.firstTick, count: 0} : this.samples[0];
    const elapsed = now - from.time;
    return elapsed >= 1000 ? (this.count - from.count) / (elapsed / 1000) : 0;
  }

  /**
   * Draw the progress line.
   * @param {number} now - The current time.
   * @param {boolean} final - Whether this is the final state.
   */
  render(now, final) {
    const text = this.text(now, final);
    if (this.interactive) {
      // The line is cut to the width of the terminal: a line that wraps can no longer be redrawn.
      const width = Math.max((this.stream.columns || 80) - 1, 1);
      this.stream.write(`\r${`${this.label} ${text}`.slice(0, width)}\x1b[K`);
    }
    else if (final && !this.logged) {
      this.stream.write(` ${text}`);
    }
    else {
      this.logged = true;
      this.stream.write(`\n${this.label} ${text}`);
    }
  }
}

module.exports = Progress;
