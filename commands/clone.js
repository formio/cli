'use strict';
module.exports = function(program, next) {
  program
    .command('clone <source> <destination>')
    .description('Clone a database (project) from one place to another.')
    .option('--deleted-after [timestamp]', 'Only clone items deleted after the provided UNIX timestamp.')
    .option('-a, --all', 'Include All items (including deleted items', false)
    .option('-o, --submissions-only', 'Only clone the submissions within a project', false)
    .option('-f, --delete-submissions', 'Delete all submissions on the receiving form before cloning', false)
    .option('-s, --src-project <project_id>', 'The Source project ID')
    .option('-d, --dst-project <project_id>', 'The Destination project ID')
    .option('-p, --project <project_id>', 'The project ID that you wish to clone from one database to another.')
    .option('--src-ca <source_ca>', 'The SSL validation certificate for the source mongo url')
    .option('--dst-ca <destination_ca>', 'The SSL validation certificate for the destination mongo url')
    .action((source, destination, options) => require('../src/clone')(source, destination, options));
};
