/* globals describe, it */
'use strict';
const assert = require('assert');
const fs = require('fs');
const {seedProject} = require('./fixtures');
const {useTestDatabases, createCloner, quiet, cloneStateExists, capturedOutput} = require('./helper');

/**
 * The error the server answers with when it no longer knows a cursor.
 */
function cursorNotFound() {
  const err = new Error('cursor id 6139749903913888395 not found');
  err.code = 43;
  err.codeName = 'CursorNotFound';
  return err;
}

/**
 * Make the source drop the cursors of the submission walks, the way a server does once a cursor
 * has not been read from for too long.
 *
 * @param {Cloner} cloner - The cloner.
 * @param {Function} shouldDrop - Called before every read with how many documents the cursor, and
 *                                all of them together, handed over; the read fails when it returns true.
 * @returns {object} - How many times a cursor was dropped.
 */
function dropSubmissionCursors(cloner, shouldDrop) {
  const stats = {dropped: 0, read: 0};
  const connect = cloner.connect.bind(cloner);
  cloner.connect = async() => {
    await connect();
    // The submissions collection of the source is swapped for each form, back to this one.
    const submissions = cloner.src.ogSubmissions;
    const find = submissions.find.bind(submissions);
    const dropping = Object.create(submissions);
    cloner.src.ogSubmissions = dropping;
    cloner.src.submissions = dropping;
    dropping.find = (query, ...args) => {
      const cursor = find(query, ...args);
      if (!query || !query.form) {
        return cursor;
      }
      let read = 0;
      const wrapper = {
        sort: (...sortArgs) => {
          cursor.sort(...sortArgs);
          return wrapper;
        },
        batchSize: (...sizeArgs) => {
          cursor.batchSize(...sizeArgs);
          return wrapper;
        },
        project: (...projectArgs) => {
          cursor.project(...projectArgs);
          return wrapper;
        },
        hasNext: async() => {
          if (shouldDrop(read, stats.read)) {
            stats.dropped++;
            throw cursorNotFound();
          }
          return cursor.hasNext();
        },
        next: async() => {
          read++;
          stats.read++;
          return cursor.next();
        },
        close: () => cursor.close()
      };
      return wrapper;
    };
  };
  return stats;
}

/**
 * Run a clone with a cloner that was prepared beforehand.
 * @param {Cloner} cloner - The cloner.
 */
async function run(cloner) {
  try {
    await cloner.clone();
  }
  finally {
    cloner.destroy();
  }
}

/**
 * Record the forms whose submissions a clone walks.
 * @param {Cloner} cloner - The cloner.
 */
function recordForms(cloner) {
  const walked = [];
  const cloneSubmissions = cloner.cloneSubmissions.bind(cloner);
  cloner.cloneSubmissions = (srcForm, ...args) => {
    walked.push(srcForm._id.toString());
    return cloneSubmissions(srcForm, ...args);
  };
  return walked;
}

/**
 * Fail the clone of the submissions of some forms.
 * @param {Cloner} cloner - The cloner.
 * @param {Function} failing - Whether the submission of a form fails.
 * @param {boolean} fatal - Whether the failure stops the clone.
 */
function failSubmissions(cloner, failing, fatal = false) {
  const writeItem = cloner.writeItem.bind(cloner);
  cloner.writeItem = async(collection, srcItem, ...args) => {
    if (collection === 'submissions' && failing(srcItem)) {
      const err = new Error('the destination refused it');
      err.fatal = fatal;
      throw err;
    }
    return writeItem(collection, srcItem, ...args);
  };
}

/**
 * The saved clone state.
 */
function savedState() {
  return JSON.parse(fs.readFileSync('clonestate.json', 'utf8'));
}

describe('Recovery', function() {
  const dbs = useTestDatabases();

  describe('Dropped cursors', function() {
    it('Should read on from the last document when the source drops the cursor', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 7});
      const cloner = createCloner({batchSize: 2});
      let dropped = false;
      const stats = dropSubmissionCursors(cloner, (read) => {
        if (!dropped && read === 3) {
          dropped = true;
          return true;
        }
        return false;
      });

      await quiet(() => run(cloner));

      assert.equal(stats.dropped, 1);
      const cloned = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
      assert.equal(cloned.length, 7, `Every submission should be cloned, got ${cloned.length}.`);
      assert.equal(new Set(cloned).size, 7, 'No submission should be cloned twice.');
      assert.equal(cloneStateExists(), false, 'The clone completed, so there is nothing to resume.');
    });

    it('Should read on with --update-existing-submissions', async function() {
      await seedProject(dbs.src, {forms: 2, submissions: 5});
      const cloner = createCloner({batchSize: 2, updateExistingSubmissions: true});
      const stats = dropSubmissionCursors(cloner, (read) => read === 2 || read === 4);

      await quiet(() => run(cloner));

      assert.ok(stats.dropped >= 2);
      assert.equal(await dbs.dst.count('submissions'), 10);
    });

    it('Should give up on a cursor that is dropped over and over', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 3});
      const cloner = createCloner({batchSize: 2});
      const stats = dropSubmissionCursors(cloner, () => true);

      await assert.rejects(() => quiet(() => run(cloner)), /did not complete|not found/);
      assert.ok(stats.dropped > 1 && stats.dropped <= 10, `Expected a few attempts, got ${stats.dropped}.`);
    });
  });

  describe('Failures', function() {
    it('Should only retry the form that failed', async function() {
      const seed = await seedProject(dbs.src, {forms: 3, submissions: 2});
      const failingForm = seed.forms[1]._id.toString();

      const first = createCloner({});
      failSubmissions(first, (sub) => sub.form.toString() === failingForm);
      await assert.rejects(() => quiet(() => run(first)), /could not be cloned/);
      assert.equal(await dbs.dst.count('submissions'), 4);

      const state = savedState();
      assert.deepEqual(state[`retry:src.forms:${seed.project._id}`], [failingForm],
        `The failed form should be retried, got ${JSON.stringify(state)}`);

      const second = createCloner({});
      const walked = recordForms(second);
      await quiet(() => run(second));

      assert.deepEqual(walked, [failingForm], 'Only the form that failed should be cloned again.');
      const output = capturedOutput();
      assert.match(output, /Forms resumed from the previous clone: 1 left, 1 of them to retry\./,
        'A resumed clone should say so, and count only what it has left.');
      assert.match(output, /Form: .*\[1\/1\]/, `The position should count what is left, got ${output}`);
      assert.doesNotMatch(output, /\[1\/3\]/, 'The forms cloned already should not be counted.');
      assert.equal(await dbs.dst.count('submissions'), 6);
      assert.equal(cloneStateExists(), false, 'Everything was cloned, so there is nothing to resume.');
    });

    it('Should keep saving progress after a failure', async function() {
      const seed = await seedProject(dbs.src, {forms: 3, submissions: 2});
      const failingForm = seed.forms[0]._id.toString();
      const cloner = createCloner({});
      failSubmissions(cloner, (sub) => sub.form.toString() === failingForm);

      // Interrupt the clone once the last form is reached: the forms after the one that failed must
      // not be cloned again.
      const cloneSubmissions = cloner.cloneSubmissions.bind(cloner);
      cloner.cloneSubmissions = async(srcForm, ...args) => {
        if (srcForm._id.toString() === seed.forms[2]._id.toString()) {
          const err = new Error('interrupted');
          err.fatal = true;
          throw err;
        }
        return cloneSubmissions(srcForm, ...args);
      };
      await assert.rejects(() => quiet(() => run(cloner)), /interrupted/);

      const state = savedState();
      const formsKey = `src.forms:${seed.project._id}`;
      assert.equal(state[formsKey]._id, seed.forms[1]._id.toString(),
        `The resume point should have moved past the form that failed, got ${JSON.stringify(state)}`);
      assert.deepEqual(state[`retry:${formsKey}`], [failingForm]);

      const second = createCloner({});
      const walked = recordForms(second);
      await quiet(() => run(second));
      assert.deepEqual(walked.sort(), [failingForm, seed.forms[2]._id.toString()].sort());
      assert.equal(await dbs.dst.count('submissions'), 6);
    });

    it('Should finish a failed form whose cursor was dropped', async function() {
      const seed = await seedProject(dbs.src, {forms: 2, submissions: 4});
      const first = createCloner({batchSize: 2});
      dropSubmissionCursors(first, (read, total) => total >= 2);
      await assert.rejects(() => quiet(() => run(first)), /did not complete/);

      const second = createCloner({batchSize: 2});
      await quiet(() => run(second));
      const cloned = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
      assert.equal(cloned.length, 8, `Every submission should be cloned, got ${cloned.length}.`);
      assert.equal(new Set(cloned).size, 8);
      assert.equal(seed.forms.length, 2);
    });
  });

  describe('Stages', function() {
    it('Should not clone the primary project again when resuming its stages', async function() {
      const primary = await seedProject(dbs.src, {forms: 2, submissions: 1, project: {title: 'Primary'}});
      const stage = await seedProject(dbs.src, {forms: 2, submissions: 1, project: {
        title: 'Stage', type: 'stage', project: primary.project._id
      }});
      const options = {project: primary.project._id.toString(), includeStages: true};

      const first = createCloner(options);
      failSubmissions(first, (sub) => sub.project.toString() === stage.project._id.toString(), true);
      await assert.rejects(() => quiet(() => run(first)), /refused/);

      const second = createCloner(options);
      const walked = recordForms(second);
      await quiet(() => run(second));

      const primaryForms = primary.forms.map((frm) => frm._id.toString());
      assert.deepEqual(walked.filter((id) => primaryForms.includes(id)), [],
        'The primary project was cloned already, and should not be walked again.');
      assert.deepEqual(walked, stage.forms.map((frm) => frm._id.toString()));
      assert.equal(await dbs.dst.count('submissions'), 4);
    });
  });
});
