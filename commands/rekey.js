/* eslint-disable max-len */
'use strict';

/**
 * Collect an option that can be given more than once.
 * @param {string} value - This value.
 * @param {string[]} previous - The values given before it.
 */
function collect(value, previous) {
  return previous.concat([value]);
}

module.exports = function(program, next) {
  program
    .command('rekey <mongo_url>')
    .description('Re-encrypt the project settings and encrypted submission data of a database with a new DB_SECRET.')
    .requiredOption('--new-db-secret <secret>', 'The DB_SECRET the database should be encrypted with.')
    .option('--old-db-secret <secret>', 'A secret the data may currently be encrypted with. Give it more than once to try several.', collect, [])
    .option('-p, --project <project_id,...>', 'Only re-key these projects (comma separated). All projects by default.')
    .option('--dry-run', 'Change nothing. Report how much would be re-keyed, and what cannot be decrypted.', false)
    .option('--no-submission-revisions', 'Leave the submission revisions alone.')
    .option('--batch-size <size>', 'The number of documents written at a time (default - 1000).')
    .option('--ca <ca>', 'The TLS certificate authority for the mongo url.')
    .option('--cert <cert>', 'The TLS certificate key file for the mongo connection.')
    .action((mongoUrl, options) => require('../src/rekey')(mongoUrl, options));
};
