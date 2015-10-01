var KeyCred = require('keycred');
var prompt = require('prompt');
prompt.start();

// Load the office 365 settings.
module.exports = function(template, next) {

    console.log('');
    console.log('This application supports Office 365 integration.');
    prompt.get({properties: {
        setup: {
            message: 'Would you like to set that up now? (y/N)',
            default: 'y',
            required: true
        }
    }}, function(err, result) {
        if (result.setup.toLowerCase() === 'y') {

            // Setup the office365 settings.
            template.settings = template.settings || {};
            template.settings.office365 = {};
            console.log('');
            console.log('Ok, we need to ask a few questions about your Azure application. See http://help.form.io/integrations/#office365 for help.');

            // Get the required parameters.
            prompt.get({properties: {
                tenant: {
                    message: 'Enter your Office 365 Tenant ID',
                    required: true
                },
                clientId: {
                    message: 'Enter your Office 365 Client ID',
                    required: true
                },
                email: {
                    message: 'Enter your Office 365 Email Address',
                    required: true
                }
            }}, function(err, result) {
                if (err) { return next(err); }
                template.settings.office365.tenant = result.tenant;
                template.settings.office365.clientId = result.clientId;
                template.settings.office365.email = result.email;
                console.log('');
                console.log('Now we need to generate a Certificate for your Office 365 connection.\nPlease answer the following questions for your Certificate.');
                prompt.get({properties: {
                    countryName: {
                        description: 'Country Name (2 letter code) [AU]'
                    },
                    province: {
                        description: 'State or Province Name (full name) [Some-State]'
                    },
                    localityName: {
                        description: 'Locality Name (eg, city) []'
                    },
                    organizationName: {
                        description: 'Organization Name (eg, company) [Internet Widgits Pty Ltd]'
                    },
                    ou: {
                        description: 'Organizational Unit Name (eg, section) []'
                    },
                    commonName: {
                        description: 'Common Name (e.g. server FQDN or YOUR name)'
                    },
                }}, function(err, certparams) {
                    if (err) { return next(err); }

                    // Get the key credentials.
                    var keycred = new KeyCred(certparams);
                    var json = keycred.toJSON();
                    console.log('');
                    console.log('Here are your credentials to place inside of the Application Manifest. See http://help.form.io/integrations/#office365 for more information.');
                    console.log('Key Credentials:');
                    console.log(JSON.stringify(json.keycred, null, 4).green);
                    console.log('');
                    template.settings.office365.cert = json.privateKey;
                    template.settings.office365.thumbprint = json.fingerprint;
                    next(null, template);
                });
            });
        }
        else {

            // Move onto the next thing...
            next(null, template);
        }
    });
};