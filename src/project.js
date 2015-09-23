var fs = require('fs-extra');
module.exports = function(formio) {
    return {
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
            if (!fs.existsSync(options.directory + '/template.json')) {
                return next('Missing template.json file');
            }

            if (!fs.existsSync(options.directory + '/config.template.js')) {
                return next('Missing config.template.js file');
            }

            var template = {};
            try {
                template = JSON.parse(fs.readFileSync(options.directory + '/template.json'));
            }
            catch (err) {
                next(err);
            }

            // Use a generated name.
            template.name = this.domain();
            console.log('Creating your project...');
            var project = new formio.Project();
            project.create(template).then(function() {
                console.log('Project created');
                var config = fs.readFileSync(options.directory + '/config.template.js');
                var newConfig = config.toString().replace(/{{.*}}/g, template.name);
                fs.writeFileSync(options.directory + '/config.js', newConfig);
                next(null, template);
            }).catch(next);
        }
    };
};