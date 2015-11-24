module.exports = function(options) {
    var method = options.params[0];
    var formio = require('../src/formio')(options);
    var project = new formio.Project(options.projectUrl);
    project.load().then(function() {
        project.bind(options.formName, method, function(err, data) {
            if (err) {
                console.log(err.red);
            }
            console.log(JSON.stringify(data.body).blue);
        }).then(function() {
            var msg = 'Succesfully bound to ' + options.params[1];
            console.log(msg.green);
        }).catch(function(err) {
            console.log(err.toString().red);
        });
    }).catch(function(err) {
        console.log(err.toString().red);
    });
};