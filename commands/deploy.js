'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('deploy <source> <destination>')
    .description('Deploy a project to another server. Source and destination may be the project name on form.io or the full url to any project on a server such as https://test.form.io or https://form.io/project/{projectId}. Source may also be a local json file.')
    .option('--key [key]', 'The API Key to provide to the destination forms.')
    .option('--src-key [key]', 'The API Key to provide to the source form')
    .option('--dst-key [key]', 'The API Key to provide to the destination form')
    .option('--src-admin-key [key]', 'The Admin API Key to provide to the source form')
    .option('--dst-admin-key [key]', 'The Admin API Key to provide to the destination form')
    .action(series([
      require('../src/authenticate')({
        src: 0,
        dst: 1
      }),
      require('../src/deploy')
    ], next));
};
