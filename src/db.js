'use strict';

/**
 * Hide the credentials of a connection string, so that they never end up in a log.
 * @param {string} uri - The connection string.
 */
function redact(uri) {
  return String(uri).replace(/\/\/[^@/]+@/, '//***@');
}

/**
 * The mongo client options for a connection with a custom certificate authority or a client
 * certificate. The driver always uses the new url parser and the unified topology: from version 7 on
 * it rejects the options that used to turn them on.
 *
 * @param {string} caFile - The certificate authority file, relative to the working directory.
 * @param {string} certFile - The certificate key file, relative to the working directory.
 * @returns {object} - The client options.
 */
function tlsOptions(caFile, certFile) {
  const config = {};
  if (caFile || certFile) {
    config.tls = true;
    if (caFile) {
      config.tlsCAFile = `${process.cwd()}/${caFile}`;

      // A custom certificate authority is usually an internal one whose certificates do not name
      // the host being connected to. A client certificate on its own is no reason to stop
      // verifying who we are talking to.
      config.tlsAllowInvalidHostnames = true;
    }
    if (certFile) {
      config.tlsCertificateKeyFile = `${process.cwd()}/${certFile}`;
    }
  }
  return config;
}

/**
 * The name of the collection the server keeps the submissions of a form with its own collection in.
 * The server strips everything but letters and digits from both the project name and the collection.
 *
 * @param {string} projectName - The name of the project.
 * @param {string} collection - The collection setting of the form.
 * @returns {string|null} - The collection name, or null when the project name has nothing left.
 */
function submissionCollectionName(projectName, collection) {
  const project = String(projectName || '').replace(/[^A-Za-z0-9]+/g, '');
  if (!project) {
    return null;
  }
  return `${project}_${String(collection).replace(/[^A-Za-z0-9]+/g, '')}`;
}

module.exports = {redact, tlsOptions, submissionCollectionName};
