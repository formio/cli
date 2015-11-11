var fs = require('fs-extra');
var nunjucks = require('nunjucks');
nunjucks.configure([], {watch: false});
var _ = require('lodash');

module.exports = {
    /**
     * Generate a random domain for the project.
     *
     * @returns {string}
     */
    domain: function() {
        var chars = 'abcdefghijklmnopqrstuvwxyz';
        var rand = '';
        for (var i = 0; i < 15; i++) {
            var randNum = Math.floor(Math.random() * chars.length);
            rand += chars[randNum];
        }
        return rand;
    },

    /**
     * Creates a new project on Form.io with the directory provided.
     * @param directory
     */
    create: function(options, next) {

        // Get the package json file.
        var info = {};
        try {
            info = JSON.parse(fs.readFileSync(options.directory + '/package.json'));
        }
        catch (err) {
            next(err);
        }

        // Change the document root if we need to.
        if (info.formio && info.formio.docRoot) {
            options.directory += '/' + info.formio.docRoot;
        }

        if (!fs.existsSync(options.directory + '/project.json')) {
            return next('Missing project.json file');
        }

        if (!fs.existsSync(options.directory + '/config.template.js')) {
            return next('Missing config.template.js file');
        }

        var template = {};
        try {
            template = JSON.parse(fs.readFileSync(options.directory + '/project.json'));
        }
        catch (err) {
            next(err);
        }

        // Get the form.io service.
        var formio = require('./formio')(options);

        // Use a generated name.
        template.name = this.domain();

        var createProject = function(template) {
            var params = {
                path: template.name,
                protocol: options.protocol ? options.protocol : 'https',
                host: options.host ? options.host : 'form.io',
                server: options.server ? options.server : 'https://form.io'
            };
            console.log('Creating your project...');

            template.settings = template.settings || {};
            if (!template.settings.cors) {
                template.settings.cors = '*';
            }

            // Create a project from a template.
            var project = {
                title: template.title,
                description: template.description,
                name: template.name,
                template: _.omit(template, 'title', 'description', 'name'),
                settings: template.settings
            };

            var formioProject = new formio.Project();
            formioProject.create(project).then(function() {
                console.log('Project created');
                params.path = formioProject.project.name;
                var config = fs.readFileSync(options.directory + '/config.template.js');
                var newConfig = nunjucks.renderString(config.toString(), params);
                fs.writeFileSync(options.directory + '/config.js', newConfig);
                next(null, template);
            }).catch(next);
        };

        // Determine if settings need to be loaded...
        if (template.settings) {

            // See if they need office 365 settings.
            if (template.settings.office365) {

                // Get the office 365 settings.
                var office365 = require('./office365')(template, function(err, template) {
                    if (err) { return next(err); }
                    createProject(template);
                });
            }
        }
        else {
            createProject(template);
        }
    }
};