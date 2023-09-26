/* eslint-disable max-len */
'use strict';
module.exports = function(program, next) {
  program
    .command('clone <source> <destination>')
    .description('Clone a database (project) from one place to another.')
    .option('--deleted-after [timestamp]', 'Only clone items deleted after the provided UNIX timestamp (in milliseconds).')
    .option('--created-after [timestamp]', 'Only clone items created after the provided UNIX timestamp (in milliseconds).')
    .option('--modified-after [timestamp]', 'Only clone items modified after the provided UNIX timestamp.')
    .option('-a, --all', 'Include All items (including deleted items', false)
    .option('-o, --submissions-only', 'Only clone the submissions within a project', false)
    .option('--include-form-revisions', 'Include all form revisions', false)
    .option('--include-submission-revisions', 'Include all submission revisions', false)
    .option('-f, --delete-submissions', 'Delete all submissions on the receiving form before cloning', false)
    .option('-s, --src-project <project_id,...>', 'The Source project ID, or comma separated projects for multiple')
    .option('-d, --dst-project <project_id>', 'The Destination project ID')
    .option('-p, --project <project_id>', 'The project ID that you wish to clone from one database to another.')
    .option('-u, --update-existing', 'Update existing Projects and Forms instead of cloning (No OSS).', true)
    .option('--update-existing-submissions', 'Update existing Submissions when found in the destination (slows down the clone process if set).', false)
    .option('--src-ca <source_ca>', 'The TLS certificate authority for the source mongo url')
    .option('--src-cert <source_cert>', 'Allows you to provide the TLS certificate file for connections.')
    .option('--dst-ca <destination_ca>', 'The TLS certificate authority for the destination mongo url')
    .option('--dst-cert <destination_cert>', 'Allows you to provide the TLS certificate file for connections.')
    .option('--server', 'Allows to recognize what is the source(server or db)')
    .option('-k, --key [key]', 'The API Key to provide to the source API.')
    .option(
      '--src-db-secret <source_db_secret>',
      'Source API DB_SECRET config (provide this if your project has encrypted settings of fields).'
    )
    .option(
      '--dst-db-secret <destination_db_secret>',
      'Destination API DB_SECRET config (provide this if your project has encrypted settings of fields).'
    )
    .action((source, destination, options) => require('../src/clone')(source, destination, options));
};
