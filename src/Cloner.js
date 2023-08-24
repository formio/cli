/* eslint-disable max-depth */
'use strict';
const {MongoClient, ObjectId} = require('mongodb');
const fs = require('fs');
const _ = require('lodash');
const crypto = require('crypto');
const keygenerator = require('keygenerator');
const {eachComponentAsync}  = require('./eachComponentAsync');

class Cloner {
  /**
   * @param {*} mongoSrc - The source mongo connection string.
   * @param {*} mongoDest - The destination mongo connection string.
   * @param {*} options - The options for the cloner.
   * @param {*} options.srcCa - The source CA file.
   * @param {*} options.srcCert - The source certificate file.
   * @param {*} options.srcDbSecret - The source database secret.
   * @param {*} options.dstCa - The destination CA file.
   * @param {*} options.dstCert - The destination certificate file.
   * @param {*} options.dstDbSecret - The destination database secret.
   * @param {*} options.all - Clone all data including deleted data.
   * @param {*} options.project - The source project to clone.
   * @param {*} options.srcProject - Alias for options.project.
   * @param {*} options.dstProject - The destination project to clone to.
   * @param {*} options.deletedAfter - Clone only data deleted after a certain date.
   * @param {*} options.createdAfter - Clone only data created after a certain date.
   * @param {*} options.modifiedAfter - Clone only data modified after a certain date.
   * @param {*} options.deleteSubmissions - Delete the submissions of a form before cloning it.
   * @param {*} options.includeFormRevisions - Include form revisions when cloning forms.
   * @param {*} options.includeSubmissionRevisions - Include submission revisions when cloning submissions.
   * @param {*} options.submissionsOnly - Only clone submissions.
   */
  constructor(mongoSrc, mongoDest = '', options = {}) {
    this.mongoSrc = mongoSrc;
    this.mongoDest = mongoDest;
    this.beforeAll = null;
    this.afterAll = null;
    this.createNew = (mongoSrc === mongoDest);
    this.defaultSaltLength = 40;
    this.options = options;
    this.src = null;
    this.dest = null;
    this.cloneState = {};

    try {
      this.cloneState = JSON.parse(fs.readFileSync('clonestate.json', 'utf8'));
    }
    catch (e) {
      this.cloneState = {};
      console.log('No clonestate.json file found.');
    }
    process.on('exit', async() => {
      await this.disconnect();
      fs.writeFileSync('clonestate.json', JSON.stringify(this.cloneState, null, 2));
    });
  }

  /**
   * Encrypt data or settings using a secret.
   * @param {*} secret
   * @param {*} rawData
   * @param {*} nosalt
   * @returns
   */
  encrypt(secret, rawData, nosalt) {
    if (!secret || !rawData) {
      return null;
    }
    const salt = nosalt ? '' : keygenerator._({
      length: this.defaultSaltLength
    });
    const cipher = crypto.createCipher('aes-256-cbc', secret);
    const decryptedJSON = JSON.stringify(rawData) + salt;
    return Buffer.concat([
      cipher.update(decryptedJSON),
      cipher.final()
    ]);
  }

  /**
   * Decrypt data or settings using a secret.
   * @param {*} secret
   * @param {*} cipherbuffer
   * @param {*} nosalt
   * @returns
   */
  decrypt(secret, cipherbuffer, nosalt) {
    if (!secret || !cipherbuffer) {
      return null;
    }
    let data = {};
    try {
      const buffer = Buffer.isBuffer(cipherbuffer) ? cipherbuffer : cipherbuffer.buffer;
      const decipher = crypto.createDecipher('aes-256-cbc', secret);
      const decryptedJSON = Buffer.concat([
        decipher.update(buffer), // Buffer contains encrypted utf8
        decipher.final()
      ]);
      data = JSON.parse(nosalt ? decryptedJSON : decryptedJSON.slice(0, -this.defaultSaltLength));
    }
    catch (e) {
      console.log(e);
      data = null;
    }
    return data;
  }

  /**
   * Create the database configuration for the given database source type.
   * @param {*} type - The type of database source.
   * @returns MongoDB configuration.
   */
  dbConfig(type) {
    const config = {
      useNewUrlParser: true,
      useUnifiedTopology: true
    };
    if (this.options[`${type}Ca`]) {
      const caFile = this.options[`${type}Ca`];
      config.tls = true;
      config.tlsCAFile = `${process.cwd()}/${caFile}`;
      if (this.options[`${type}Cert`]) {
        const certFile = this.options[`${type}Cert`];
        config.tlsCertificateKeyFile = `${process.cwd()}/${certFile}`;
      }
      config.tlsAllowInvalidHostnames = true;
    }
    return config;
  }

  /**
   * Iterate through each document in a collection.
   *
   * @param {*} collection - The collection to iterate through.
   * @param {*} query - The query to use to find the documents.
   * @param {*} cb - The callback to call for each document.
   */
  async each(collection, query, cb, sort = {created: 1}) {
    if (!query._id && this.cloneState[collection]) {
      query.created = {$gt: new Date(this.cloneState[collection])};
    }
    const cursor = _.get(this, collection).find(query).sort(sort);
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      // eslint-disable-next-line callback-return
      await cb(doc);
      process.stdout.write(collection === 'src.submissionrevisions' ? '_' : '.');
      this.cloneState[collection] = (new Date(doc.created || null)).toISOString();
    }
    delete this.cloneState[collection];
  }

  /**
   * Before handler for each document.
   *
   * @param {*} collection - The collection to run the before handler on.
   * @param {*} beforeEach - The callback to call before each document.
   * @param {*} src - The source document.
   * @param {*} update - The updated document.
   * @param {*} dest - The destination document.
   */
  async before(collection, beforeEach, src, update, dest) {
    if (beforeEach) {
      await beforeEach(src, update, dest);
    }
    if (this.beforeAll) {
      await this.beforeAll(collection, src, update, dest);
    }
  }

  /**
   * After handler for each document.
   * @param {*} collection - The collection to run the after handler on.
   * @param {*} afterEach - The callback to call after each document.
   * @param {*} srcItem - The source item.
   * @param {*} update - The updated item.
   * @param {*} dest - The destination item.
   */
  async after(collection, afterEach, srcItem, update, dest) {
    if (afterEach) {
      await afterEach(srcItem, update, dest);
    }
    if (this.afterAll) {
      await this.afterAll(collection, srcItem, update, dest);
    }
  }

  /**
   * Find the last item in the collection by provided query.
   * @param {string} collection - The collection where to run find query.
   * @param {object} query - The query to use to find the item in the database.
   * @param {object} sort - The sort option to use when searching for the item.
   */
  async findLast(collection, query) {
    if (!collection || !query) {
      return;
    }
    const [found] = await _.get(this, collection)
      .find(query)
      .sort({created: -1})
      .limit(1)
      .toArray();

    return found;
  }

  /**
   * Determine if we should clone the given item.
   * @param {*} srcItem - The source item to check.
   */
  shouldClone(collection, srcItem) {
    if (this.options.submissionsOnly && collection !== 'submissions') {
      return false;
    }
    if (this.options.createdAfter && srcItem.created < parseInt(this.options.createdAfter, 10)) {
      return false;
    }
    if (this.options.modifiedAfter && srcItem.modified < parseInt(this.options.modifiedAfter, 10)) {
      return false;
    }
    return true;
  }

  /**
   * Find a query.
   * @param {*} current - The current record.
   */
  findQuery(current, findQuery = null) {
    if (findQuery) {
      return findQuery(current);
    }
    if (findQuery === false) {
      return null;
    }
    return {_id: current._id};
  }

  /**
   * Upsert a record in the destination database.
   * @param {*} collection - The collection to upsert to.
   * @param {*} query - The query to use to find the document in the source database.
   * @param {*} beforeEach - The callback to call before upserting the document.
   * @param {*} afterEach - The callback to call after upserting the document.
   * @param {*} find - The query to use to find the "equivalent" document in the destination database.
   */
  async upsertAll(collection, query, eachItem, beforeEach, afterEach, find = null) {
    await this.each(`src.${collection}`, query, async(current) => {
      const srcItem = _.cloneDeep(current);
      if (eachItem) {
        eachItem(srcItem);
      }

      try {
        // Create the item we will be inserting/updating.
        const destItem = await this.findLast(`dest.${collection}`, this.findQuery(current, find));
        const updatedItem = _.assign(destItem || {}, _.omit(srcItem, ['_id']));

        // Call before handler and then update if it says we should.
        if (
          this.shouldClone(collection, srcItem) &&
          await this.before(collection, beforeEach, srcItem, updatedItem, destItem) !== false
        ) {
          if (destItem) {
            await this.dest[collection].updateOne(this.findQuery(destItem),
              {$set: _.omit(updatedItem, ['_id', 'machineName'])}
            );
          }
          else {
            updatedItem._id = srcItem._id;
            await this.dest[collection].insertOne(updatedItem);
          }
        }

        // Call the after handler.
        await this.after(collection, afterEach, srcItem, updatedItem, destItem);
      }
      catch (err) {
        console.error(`Error creating ${collection} ${current._id}`, err);
      }
    });
  }

  /**
   * Create a query for the given collection.
   * @param {*} query - The default query to decorate.
   * @returns - The decorated query.
   */
  query(query) {
    let newQuery = _.cloneDeep(query);
    if (!this.options.all) {
      newQuery.deleted = {$eq: null};
    }
    return newQuery;
  }

  /**
   * Get the destination project id.
   */
  get destProject() {
    return this.options.dstProject || this.options.project;
  }

  /**
   * Get the source project id.
   */
  get sourceProject() {
    return this.options.srcProject || this.options.project;
  }

  /**
   * Create a decorated query for a single item.
   * @param {*} query - The default query to decorate.
   * @returns - The decorated query.
   */
  itemQuery(query) {
    let newQuery = _.cloneDeep(query);
    if (this.options.deletedAfter) {
      newQuery['$or'] = [
        {deleted: {$eq: null}},
        {deleted: {$gt: new Date(parseInt(this.options.deletedAfter, 10))}}
      ];
    }
    else {
      newQuery = this.query(newQuery);
    }
    // If it's OSS, then project would be undefined
    // eslint-disable-next-line no-prototype-builtins
    if (newQuery.hasOwnProperty('project') && !newQuery.project) {
      delete newQuery.project;
    }
    return newQuery;
  }

  /**
   * Adding a query for created and modified dates.
   * @param {*} query - The default query to decorate.
   */
  afterQuery(query, createdAfter, modifiedAfter) {
    const newQuery = this.itemQuery(query);
    createdAfter = createdAfter || this.options.createdAfter;
    modifiedAfter = modifiedAfter || this.options.modifiedAfter;
    if (createdAfter) {
      newQuery.created = {$gt: new Date(parseInt(createdAfter, 10))};
    }
    if (modifiedAfter) {
      newQuery.modified = {$gt: new Date(parseInt(modifiedAfter, 10))};
    }
    return newQuery;
  }

  /**
   * Create a decorated query for project searching.
   * @param {*} srcProject - The source project to use.
   * @param {*} defaultQuery - The default query to decorate.
   * @returns - The decorated project query.
   */
  projectQuery(srcProject = null, defaultQuery = {}) {
    const query = this.itemQuery(defaultQuery);
    if (srcProject && srcProject._id) {
      query.project = srcProject._id;
    }
    else {
      const sourceProject = this.sourceProject;
      if (sourceProject) {
        if (sourceProject.indexOf(',') === -1) {
          query._id = new ObjectId(sourceProject);
        }
        else {
          query._id = {$in: sourceProject.split(',').map((id) => new ObjectId(id))};
        }
      }
    }
    return query;
  }

  /**
   * Sets the submission collection configuration for the destination imports.
   * @param {*} form - The form we are currently cloning.
   * @param {*} srcProj - The source project.
   * @param {*} destProj - The destination project.
   */
  setCollection(form, srcProj, destProj) {
    const subsCollection = _.get(form, 'settings.collection');
    if (!subsCollection) {
      this.src.submissions = this.src.ogSubmissions;
      this.dest.submissions = this.dest.ogSubmissions;
      return;
    }
    console.log(`Using collection - ${subsCollection}`);
    // eslint-disable-next-line max-len
    this.src.submissions = srcProj && subsCollection ? this.src.db.collection(`${srcProj.name}_${subsCollection}`) : this.src.ogSubmissions;
    // eslint-disable-next-line max-len
    this.dest.submissions = destProj && subsCollection ? this.dest.db.collection(`${destProj.name}_${subsCollection}`) : this.dest.ogSubmissions;
  }

  /**
   * Connnect to a mongodb database.
   * @param {*} uri - The uri to connect to.
   * @param {*} type - The type of database to connect to.
   * @returns - A promise that resolves to an object with all database collections.
   */
  async connectDb(uri, type) {
    try {
      console.log(`Connecting to ${uri}\n`);
      const client = new MongoClient(uri, this.dbConfig(type));
      await client.connect();
      const db = await client.db();
      console.log(`Succesfully connected to ${uri}`);
      return {
        client,
        db,
        projects: db.collection('projects'),
        forms: db.collection('forms'),
        ogSubmissions: db.collection('submissions'),
        submissions: db.collection('submissions'),
        submissionrevisions: db.collection('submissionrevisions'),
        roles: db.collection('roles'),
        actions: db.collection('actions'),
        actionItems: db.collection('actionitems'),
        formrevisions: db.collection('formrevisions'),
        tags: db.collection('tags')
      };
    }
    catch (err) {
      throw new Error(`Could not connect to database ${uri}: ${err.message}`);
    }
  }

  async connect() {
    if (this.mongoSrc === this.mongoDest) {
      throw new Error('Source and destination databases cannot be the same.');
    }

    // Connect to the source databases.
    this.src = await this.connectDb(this.mongoSrc, 'src');

    // If there are no source projects, then we can assume we are cloning from OSS.
    this.oss = !(await this.src.projects.findOne({}));

    // Connect to the destination databases.
    if (this.mongoDest) {
      this.dest = await this.connectDb(this.mongoDest, 'dst');
    }
  }

  /**
   * Disconnect the database connections.
   */
  async disconnect() {
    // Disconnect from the source and destination databases.
    await this.src.client.close();
    await this.dest.client.close();
  }

  /**
   * Migrate the data encrypted within a submission to a new secret.
   * @param {*} src - The source record
   * @param {*} update - The updated record
   * @param {string} decryptKey - The source key to decrypt data (either project.settings.secret or DB_SECRET).
   */
  migrateDataEncryption(src, update, compsWithEncryptedData) {
    const srcSecret = this.srcSecret || this.options.srcDbSecret;
    const destSecret = this.destSecret || this.options.dstDbSecret;
    if (
      !compsWithEncryptedData.length ||
      !srcSecret ||
      !destSecret ||
      srcSecret === destSecret
    ) {
      return;
    }
    compsWithEncryptedData.forEach((compPath) => {
      if (_.get(src, `data.${compPath}`, false)) {
        _.set(update, `data.${compPath}`,
          this.encrypt(destSecret, this.decrypt(srcSecret, _.get(src, `data.${compPath}`)))
        );
      }
    });
  }

  /**
   * Clone submissions from one form to another.
   * @param {*} srcForm - The source form from the database.
   * @param {*} destForm - The destination from from the database.
   * @param {string[]} compsWithEncryptedData - Array with paths of components that are encrypted.
   */
  async cloneSubmissions(srcForm, destForm, compsWithEncryptedData) {
    process.stdout.write('\n');
    process.stdout.write('         - Submissions:');

    // Determine the last one cloned, and ensure that we only fetch submissions after that date.
    const lastSubmission = await this.findLast('dest.submissions', {
      form: destForm._id,
      project: destForm.project
    });

    // Submissions always "create new" so we need to ensure we only clone the ones that have not yet been cloned.
    const query = this.afterQuery({
      form: srcForm._id,
      project: srcForm.project
    }, lastSubmission && lastSubmission.created ? lastSubmission.created.getTime() : null);

    // Clone the submissions.
    await this.upsertAll('submissions', query, null, async(src, update) => {
      update.form = destForm._id;
      update.project = destForm.project;
      if (compsWithEncryptedData.length) {
        this.migrateDataEncryption(src, update, compsWithEncryptedData);
      }
      this.migrateAccess(src.access, update.access);
    }, async(srcSubmission, destSubmission) => {
      await this.cloneSubmissionRevisions(srcSubmission, destSubmission, compsWithEncryptedData);
    }, false);
  }

  /**
   * Clone submission revisions from one database to another.
   * @param {*} srcSubmission - The source submission.
   * @param {*} destSubmission - The destination submission.
   */
  async cloneSubmissionRevisions(srcSubmission, destSubmission, compsWithEncryptedData) {
    if (!this.options.includeSubmissionRevisions) {
      return;
    }
    await this.upsertAll('submissionrevisions', this.afterQuery({
      _rid: srcSubmission._id
    }), null, async(src, update) => {
      update._rid = destSubmission._id;
      this.migrateDataEncryption(src, update, compsWithEncryptedData);
    });
  }

  /**
   * Provided the source role id, and the destination project, this will return the equivalent destination role id.
   * @param {ObjectId|string} srcId - The source resource id.
   * @param {ObjectId|string} destProjectId - The destination project id.
   */
  async getDestinationRoleId(srcId, destProjectId) {
    const srcRole = await this.src.roles.findOne({_id: new ObjectId(srcId.toString())});
    if (srcRole) {
      // eslint-disable-next-line max-len
      const destRole = await this.dest.roles.findOne({title: srcRole.title, project: new ObjectId(destProjectId.toString())});
      if (destRole) {
        return destRole._id.toString();
      }
    }
    return srcId.toString();
  }

  /**
   * Provided the destination form id, the destination project id and the date of submission creation, will return the next created submission.
   * @param {ObjectId} destFormId - The destination form id.
   * @param {ObjectId} destProjectId - The destination project id.
   * @param {Date|string} createdDate - Date or date string when the submission was created.
   */
  async getDestinationSubmissionByDate(destFormId, destProjectId, createdDate) {
    return await _.get(this, 'dest.submissions').findOne({
      form: new ObjectId(destFormId.toString()),
      project: new ObjectId(destProjectId.toString()),
      created: {$gt: _.isDate(createdDate) ? createdDate : new Date(createdDate)}
    });
  }

  /**
   * Clone actions from one form to another.
   * @param {*} srcForm - The source form to clone actions from.
   * @param {*} destForm - The destination form to clone actions to.
   */
  async cloneActions(srcForm, destForm) {
    process.stdout.write('\n');
    process.stdout.write('         - Actions:');
    await this.upsertAll('actions', this.itemQuery({
      form: srcForm._id
    }), null, async(src, update) => {
      update.form = destForm._id;
      if (!update.settings) {
        return;
      }
      if (update.settings.role) {
        const srcId = update.settings.role;
        update.settings.role = await this.getDestinationRoleId(srcId, destForm.project);
      }
    });
  }

  /**
   * Clone forms from one project to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   */
  async cloneForms(srcProject, destProject) {
    process.stdout.write('\n');
    process.stdout.write('   - Forms:');
    let compsWithEncryptedData = [];
    await this.upsertAll('forms', this.projectQuery(srcProject), (form) => {
      process.stdout.write('\n');
      process.stdout.write(`- Form: ${form.title}`);
    }, async(src, update, dest) => {
      if (this.options.submissionsOnly) {
        return false;
      }

      await eachComponentAsync(update.components, async(component, path) => {
        if (component.encrypted) {
          compsWithEncryptedData.push(path);
        }
      });

      this.setCollection(update, srcProject, destProject);
      update.project = destProject._id;
      this.migrateFormAccess(src, update);
    }, async(srcForm, destForm) => {
      if (this.options.deleteSubmissions) {
        console.log(`Deleting submissions from ${destForm.title}`);
        await this.dest.submissions.deleteMany(this.itemQuery({
          project: destForm.project,
          form: destForm._id
        }));
      }
      await this.cloneSubmissions(srcForm, destForm, compsWithEncryptedData);
      await this.cloneActions(srcForm, destForm);
      await this.cloneFormRevisions(srcForm, destForm);
      compsWithEncryptedData = [];
    });
  }

  async cloneRoles(srcProject, destProject) {
    process.stdout.write('\n');
    process.stdout.write('   - Roles:');
    await this.upsertAll('roles', this.projectQuery(srcProject), null, (src, update) => {
      update.project = destProject._id;
    }, null, (current) => {
      return {
        project: destProject._id,
        title: current.title
      };
    });
  }

  async cloneTags(srcProject, destProject) {
    process.stdout.write('\n');
    process.stdout.write('   - Tags:');
    await this.upsertAll('tags', this.projectQuery(srcProject), null, (src, update) => {
      update.project = destProject._id;
    });
  }

  async cloneFormRevisions(srcForm, destForm) {
    if (!this.options.includeFormRevisions) {
      return;
    }
    process.stdout.write('\n');
    process.stdout.write('   - Revisions:');
    await this.upsertAll('formrevisions', this.afterQuery({
      _rid: srcForm._id,
      project: srcForm.project
    }), null, (src, update, dest) => {
      // If the revision already exists in the destination, don't upsert it
      if (dest) {
        return false;
      }
      update._rid = destForm._id;
      update.project = destForm.project;
    });
  }

  destRole(roleId) {
    const srcRole = this.srcRoles.find((role) => role._id.toString() === roleId.toString());
    if (!srcRole) {
      return new ObjectId(roleId);
    }
    const roleTitle = srcRole.title;
    const dstRole = this.destRoles.find((role) => role.title === roleTitle);
    if (!dstRole || !dstRole._id) {
      return new ObjectId(roleId);
    }
    return new ObjectId(dstRole._id.toString());
  }

  /**
   * Migrate a roles array to use destination roles instead of source roles.
   * @param {*} roles - An array of role ids that need to be migrated.
   */
  migrateRoles(roles) {
    const newRoles = [];
    if (roles && roles.length) {
      roles.forEach((roleId) => newRoles.push(this.destRole(roleId)));
    }
    return newRoles;
  }

  /**
   * Migrate access array to use destination roles instead of source roles.
   * @param {*} access - An access array.
   */
  migrateAccess(srcAccess, dstAccess) {
    if (srcAccess && srcAccess.length) {
      srcAccess.forEach((roleAccess) => {
        if (!roleAccess.type || roleAccess.type.indexOf('team_') === -1) {
          const existing = dstAccess.find((access) => access.type === roleAccess.type);
          if (existing) {
            existing.roles = this.migrateRoles(roleAccess.roles);
          }
          else {
            dstAccess.push(_.assign({}, roleAccess, {roles: this.migrateRoles(roleAccess.roles)}));
          }
        }
      });
    }
  }

  /**
   * Migrate the form access to use destination roles instead of source roles.
   * @param {*} item
   */
  migrateFormAccess(src, dest) {
    if (src && dest) {
      this.migrateAccess(src.access, dest.access);
      this.migrateAccess(src.submissionAccess, dest.submissionAccess);
    }
  }

  /**
   * Migrate the project settings from one project encryption to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   */
  async migrateSettings(src, update, dest) {
    if (
      !src ||
      !src['settings_encrypted'] ||
      !this.options.srcDbSecret ||
      !this.options.dstDbSecret ||
      this.options.srcDbSecret === this.options.dstDbSecret
    ) {
      return;
    }
    const decryptedDstSettings = dest ? this.decrypt(this.options.dstDbSecret, dest['settings_encrypted'], true) : {};
    if (decryptedDstSettings.secret) {
      this.dstSecret = decryptedDstSettings.secret;
    }

    // Do not overwrite existing destination project settings.
    if (dest && dest['settings_encrypted']) {
      update['settings_encrypted'] = dest['settings_encrypted'];
      return;
    }

    // Decrypt the source, and set the update to the re-encrypted settings object.
    const decryptedSrcSettings = this.decrypt(this.options.srcDbSecret, src['settings_encrypted'], true);
    if (decryptedSrcSettings.secret) {
      this.srcSecret = decryptedSrcSettings.secret;
    }

    update['settings_encrypted'] = this.encrypt(this.options.dstDbSecret, decryptedSrcSettings, true);
  }

  /**
   * Close all items within a project.
   * @param {*} srcProject - The source project
   * @param {*} destProject - The destination project.
   */
  async cloneProjectItems(srcProject, destProject) {
    if (!destProject) {
      throw new Error('Destination project not found for this cloning operation.');
    }
    await this.cloneRoles(srcProject, destProject);
    this.srcRoles = await this.src.roles.find(srcProject ? {project: srcProject._id} : {}).toArray();
    this.destRoles = await this.dest.roles.find({project: destProject._id}).toArray();
    if (srcProject && destProject) {
      this.migrateFormAccess(srcProject, destProject);
      await this.dest.projects.updateOne(
        {_id: destProject._id},
        {$set: {access: destProject.access}}
      );
    }
    await this.cloneForms(srcProject, destProject);
  }

  /**
   * Clone the project from one database to another.
   */
  async cloneProject() {
    process.stdout.write('\n');
    process.stdout.write('Fetching formio project owner.');
    const formioProject = await this.dest.projects.findOne({name: 'formio'});
    const formioOwner = formioProject ? formioProject.owner : null;
    const query = this.projectQuery();
    await this.upsertAll('projects', query, (project) => {
      if (project.name === 'formio') {
        return false;
      }
      process.stdout.write('\n');
      process.stdout.write(`- Project ${project.title}:`);
    }, async(src, update, dest) => {
      // Do not update if they provide a destination project or we are the "formio" project.
      if (src.name === 'formio') {
        return false;
      }

      if (formioOwner) {
        update.owner = formioOwner;
      }

      // Migrate the settings.
      this.srcSecret = null;
      this.dstSecret = null;
      await this.migrateSettings(src, update, dest);

      // Keep the access settings.
      update.access = dest ? dest.access : [];
    }, async(src, dest) => {
      if (src.name === 'formio') {
        return;
      }

      await this.cloneProjectItems(src, dest);
      await this.cloneTags(src, dest);
    });
  }

  /**
   * Clone a number of projects from one database to another.
   */
  async clone(beforeAll = null, afterAll = null) {
    this.beforeAll = beforeAll;
    this.afterAll = afterAll;

    // Connect to the source and destination.
    await this.connect();

    // If they wish to only clone submissions, then do that.
    if (this.options.dstProject || this.options.submissionsOnly || this.oss) {
      process.stdout.write('\n');
      process.stdout.write(`Cloning forms and submissions of ${this.sourceProject} to ${this.destProject}.`);
      process.stdout.write('\n');
      if (!this.destProject) {
        throw new Error('You must provide a destination project id.');
      }
      await this.cloneProjectItems(
        await this.src.projects.findOne(this.itemQuery({_id: new ObjectId(this.sourceProject)})),
        await this.dest.projects.findOne(this.itemQuery({_id: new ObjectId(this.destProject)}))
      );
    }
    else {
      await this.cloneProject();
    }
    try {
      fs.rmSync('clonestate.json');
    }
    catch (err) {
      // Do nothing.
    }

    // Say we are done.
    process.stdout.write('\n');
    console.log('Done!');
    await this.disconnect();
  }
}

module.exports = Cloner;
