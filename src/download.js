var http = require('http');
var fs = require('fs-extra');
var request = require('request');
var ProgressBar = require('progress');
var ghdownload = require('github-download');
module.exports = function(formio) {
    return function(options, next) {
        if (!options.path) {
            return next('No application path provided.');
        }

        // If this is a local file, then it is downloaded.
        if (options.path && fs.existsSync(options.path)) {
            options.directory = options.path;
            return next();
        }

        // If the zipfile is already provided then skip.
        if (options.zipfile) {
            return next();
        }

        // Ensure that this is a GitHub url.
        if (options.path.indexOf('http') === 0 && options.path.indexOf('https://github.com/') !== 0) {
            return next('The project URL must be a GitHub URL');
        }

        // Set the project options.path.
        var projectUrl = (options.path.indexOf('https://github.com/') === 0) ? options.path : 'https://github.com/' + options.path;
        var projectName = projectUrl.match(/\/([^/]*\/[^/]*$)/);
        if (projectName.length !== 2) {
            return next('Invalid GitHub project name');
        }

        // Set the project name to the matched text.
        projectName = projectName[1];

        // Create the directory if it does not exist.
        if (!options.directory) {
            options.directory = projectName.replace('/', '-');
        }

        if (fs.existsSync(options.directory + '.zip')) {
            options.zipfile = options.directory + '.zip';
            return next();
        }

        // Perform the download.
        ghdownload(options.path, options.directory)
            .on('error', next)
            .on('end', function() {
                next();
            });
    };
};