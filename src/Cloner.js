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
   * @param {*} options.submissionsOnly - Only clone submissions.
   * @param {*} options.updateExisting - Update project or form if it's found in destination.
   */
  constructor(mongoSrc, mongoDest = '', options = {}) {
    this.mongoSrc = mongoSrc;
    this.mongoDest = mongoDest;
    this.beforeAll = null;
    this.afterAll = null;
    this.createNew = (mongoSrc === mongoDest);
    this.createNewProject = !options.dstProject && !options.updateExisting;
    this.defaultSaltLength = 40;
    this.encryptedFields = [];
    this.formsWithMissingDeps = [];
    this.skipCurrentUpsert = false;
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
    process.on('exit', () => {
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
      process.stdout.write('.');
      this.cloneState[collection] = (new Date(doc.created || null)).toISOString();
    }
    delete this.cloneState[collection];
  }

  async before(collection, beforeEach, srcItem, dstItem) {
    if (beforeEach) {
      await beforeEach(srcItem, dstItem);
    }
    if (this.beforeAll) {
      await this.beforeAll(collection, srcItem, dstItem);
    }
  }

  async after(collection, afterEach, srcItem, dstItem) {
    if (afterEach) {
      await afterEach(srcItem, dstItem);
    }
    if (this.afterAll) {
      await this.afterAll(collection, srcItem, dstItem);
    }
  }

  shouldUpdate(destItem, collection) {
    return !!destItem && this.options.updateExisting && ['projects', 'forms'].includes(collection);
  }

  async tryInsert(collection, item) {
    try {
      return (await this.dest[collection].insertOne(item)).insertedId;
    }
    catch (err) {
      // If duplicate key error encountered, add '-clone' to the failing field and repeat the operation
      if (err.code === 11000) {
        // EX: err.keyValue = {"machineName": "failing-machine-name"}
        Object.keys(err.keyValue).forEach((fieldKey) => {
          // If the failed value is of string type add '-clone' to it and retry insert
          if (typeof err.keyValue[fieldKey] === 'string') {
            item[fieldKey] = `${err.keyValue[fieldKey]}-clone`;
          }
        });
        return this.tryInsert(collection, item);
      }
      // If unhandled error throw to the root catch
      throw err;
    }
  }

  /**
   * Find the last item in the collection by provided query.
   * @param {string} collection - The collection where to run find query.
   * @param {object} query - The query to use to find the item in the database.
   * @param {object} sort - The sort option to use when searching for the item.
   */
  async findLast(collection, query, sort) {
    if (!collection || !query) {
      return;
    }
    sort = _.assign({created: -1}, sort || {});
    const [found] = await _.get(this, collection)
      .find(query)
      .sort(sort)
      .limit(1)
      .toArray();

    return found;
  }

  /**
   * Upsert a record in the destination database.
   * @param {*} collection - The collection to upsert to.
   * @param {*} query - The query to use to find the document in the source database.
   * @param {*} beforeEach - The callback to call before upserting the document.
   * @param {*} afterEach - The callback to call after upserting the document.
   * @param {*} findQuery - The query to use to find the "equivalent" document in the destination database.
   */
  async upsertAll(collection, query, beforeEach, afterEach, findQuery, sort) {
    if (collection === 'projects' && this.oss) {
      // If we are cloning from OSS, then the project is already established from destination.
      await this.before(collection, beforeEach);
      await this.after(collection, afterEach, null, await this.dest[collection].findOne(this.query({
        _id: new ObjectId(this.options.dstProject)
      })));
      return;
    }
    if (!findQuery) {
      findQuery = (current) => {
        return {_id: current._id};
      };
    }
    sort = _.assign({created: -1}, sort || {});

    await this.each(`src.${collection}`, query, async(current) => {
      const srcItem = _.cloneDeep(current);

      try {
        // If there is destProject option passed, skip cloning srcProject
        if (collection === 'projects' && this.options.dstProject) {
          const destItem = await this.dest[collection].findOne(
            this.query({_id: new ObjectId(this.options.dstProject)})
          );
          await this.before(collection, beforeEach, srcItem, destItem);
          await this.after(collection, afterEach, srcItem, destItem);
        }
        else {
          // Find the last item matching the query
          const destItem = await this.findLast(`dest.${collection}`, findQuery(current), sort);

          // If --update-existing option passed and there is an existing item - update it, else - insert it
          if (this.shouldUpdate(destItem, collection)) {
            const updatedItem = _.assign(destItem, srcItem);

            // Update modified date
            if (updatedItem.modified) {
              updatedItem.modified = new Date();
            }

            await this.before(collection, beforeEach, updatedItem, destItem);

            if (!this.skipCurrentUpsert) {
              await this.dest[collection].updateOne(
                findQuery(current),
                {$set: _.omit(updatedItem, ['_id', 'machineName', 'settings_encrypted'])}
              );
            }
          }
          else {
            await this.before(collection, beforeEach, current, destItem);

            if (!this.skipCurrentUpsert) {
              delete current._id;

              // Update created and modified dates
              if (current.created && current.modified) {
                current.created = new Date();
                current.modified = new Date();
              }

              current._id = await this.tryInsert(collection, current);
            }
          }
          // If we skipped current upsert, just reset the flag, otherwise - call after hook with upserted item
          if (this.skipCurrentUpsert) {
            this.skipCurrentUpsert = false;
          }
          else {
            await this.after(collection, afterEach, srcItem, await this.dest[collection].findOne(findQuery(current)));
          }
        }
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
        {deleted: {$gt: parseInt(this.options.deletedAfter, 10)}}
      ];
    }
    else {
      newQuery = this.query(newQuery);
    }
    // eslint-disable-next-line no-prototype-builtins
    if (newQuery.hasOwnProperty('project') && !newQuery.project) {
      delete newQuery.project;
    }
    if (this.options.createdAfter) {
      newQuery.created = {$gt: new Date(parseInt(this.options.createdAfter, 10))};
    }
    if (this.options.modifiedAfter) {
      newQuery.modified = {$gt: new Date(parseInt(this.options.modifiedAfter, 10))};
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
        db: db,
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
    // Connect to the source databases.
    this.src = await this.connectDb(this.mongoSrc, 'src');

    // If there are no source projects, then we can assume we are cloning from OSS.
    this.oss = this.options.dstProject && !(await this.src.projects.findOne({}));

    // Connect to the destination databases.
    if (this.mongoDest) {
      this.dest = await this.connectDb(this.mongoDest, 'dst');
    }
  }

  /**
   * Migrate the data encrypted within a submission to a new secret.
   * @param {*} srcSubmission - The source submission that contains the encrypted data.
   * @param {string} decryptKey - The source key to decrypt data (either project.settings.secret or DB_SECRET).
   */
  async migrateDataEncryption(srcSubmission, decryptKey) {
    if (
      !this.encryptedFields.length ||
      !this.options.srcDbSecret ||
      !this.options.dstDbSecret ||
      this.createNew
    ) {
      return;
    }
    this.encryptedFields.forEach((path) => {
      if (_.get(srcSubmission, path, false)) {
        _.set(srcSubmission, path, this.encrypt(
          this.options.dstDbSecret, this.decrypt(
            decryptKey || this.options.srcDbSecret, _.get(srcSubmission, path)
          )
        ));
      }
    });
  }

  /**
   * Clone submissions from one form to another.
   * @param {*} srcForm - The source form from the database.
   * @param {*} destForm - The destination from from the database.
   * @param {string} decryptKey - The source key to decrypt data (either project.settings.secret or DB_SECRET).
   * @param {function} mutate - Optional function that can mutate the submission before upsert.
   */
  async cloneSubmissions(srcForm, destForm, decryptKey, mutate) {
    process.stdout.write('\n');
    process.stdout.write('         - Submissions:');
    await this.upsertAll('submissions', this.itemQuery({
      form: srcForm._id,
      project: srcForm.project
    }), async(submission) => {
      submission.form = destForm._id;
      submission.project = destForm.project;
      if (mutate) {
        await mutate(submission);
      }
      this.migrateDataEncryption(submission, decryptKey);
      this.migrateRoles(submission.roles);
    }, async(srcSubmission, destSubmission) => {
      await this.cloneSubmissionRevisions(srcSubmission, destSubmission);
    });
  }

  /**
   * Clone submission revisions from one database to another.
   * @param {*} srcSubmission - The source submission.
   * @param {*} destSubmission - The destination submission.
   */
  async cloneSubmissionRevisions(srcSubmission, destSubmission) {
    process.stdout.write('\n');
    process.stdout.write('            - Submission Revisions:');
    await this.upsertAll('submissionrevisions', this.itemQuery({
      _rid: srcSubmission._id
    }), async(submission) => {
      submission._rid = destSubmission._id;
      this.migrateDataEncryption(submission);
    });
  }

  /**
   * Provided the source resource id, and the destination project, this will return the equivalent destination resource id.
   * @param {*} srcId - The source resource id.
   * @param {*} destProjectId - The destination project id.
   */
  async getDestinationResourceId(srcId, destProjectId) {
    const srcResource = await this.src.forms.findOne({_id: new ObjectId(srcId.toString())});
    if (srcResource) {
      // Find last cloned item or original if no clones
      const destResource = await this.findLast('dest.forms', {
        name: this.getCloneFieldRegExp(srcResource.name),
        project: new ObjectId(destProjectId.toString())
      });

      if (destResource) {
        return destResource._id.toString();
      }
    }
    return srcId.toString();
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
  async getDestinationSubmissionIdByDate(destFormId, destProjectId, createdDate) {
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
    }), async(action) => {
      action.form = destForm._id;

      // See if we need to update the resources.
      if (action.settings && action.settings.resources) {
        for (let i = 0; i < action.settings.resources.length; i++) {
          const srcId = action.settings.resources[i];
          action.settings.resources[i] = await this.getDestinationResourceId(srcId, destForm.project);
        }
      }

      // See if we need to update the resource.
      if (action.settings && action.settings.resource) {
        const srcId = action.settings.resource;
        action.settings.resource = await this.getDestinationResourceId(srcId, destForm.project);
      }

      // See if we need to update the role.
      if (action.settings && action.settings.role) {
        const srcId = action.settings.role;
        action.settings.role = await this.getDestinationRoleId(srcId, destForm.project);
      }
    });
  }

  /**
   * Construct RegExp for cloned items based on field value.
   * @param {string} field - Field value.
   */
  getCloneFieldRegExp(field) {
    return new RegExp(`^${field}(?:-clone)*$`);
  }

  /**
   * Clone forms from one project to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   * @param {object} customQuery - Query object that will be used to find the forms to clone.
   */
  async cloneForms(srcProject, destProject, customQuery) {
    process.stdout.write('\n');
    process.stdout.write('   - Forms:');
    const query = customQuery || this.projectQuery(srcProject);
    let submissionsMutate = null;
    await this.upsertAll('forms', query, async(srcForm, destForm) => {
      process.stdout.write('\n');
      process.stdout.write(`- Form: ${srcForm.title}`);

      if (submissionsMutate) {
        submissionsMutate = null;
      }

      await eachComponentAsync(srcForm.components, async(component, path) => {
        if (component.encrypted) {
          this.encryptedFields.push(path);
        }
        // Map Select with resource to the destination
        if (component.data && component.data.resource) {
          const destId = await this.getDestinationResourceId(component.data.resource, destProject._id);

          if (destId === component.data.resource) {
            this.formsWithMissingDeps.push(srcForm._id);
            this.skipCurrentUpsert = true;
          }
          else {
            component.data.resource = destId;
          }
        }
        // Map Nested form to the destination
        if (component.type === 'form' && component.form) {
          const destId = await this.getDestinationResourceId(component.form, destProject._id);
          // If destination form is not yet cloned, store it's id to clone after all forms
          if (destId === component.form) {
            this.formsWithMissingDeps.push(srcForm._id);
            this.skipCurrentUpsert = true;
          }
          else {
            component.form = destId;

            // If nested form submissions are getting by reference
            if (component.reference !== false) {
              let prevSubCreated = null;
              // Point every submission to dest submission
              submissionsMutate = async(sub) => {
                const destSub = await this.getDestinationSubmissionIdByDate(
                  destId,
                  destProject._id,
                  prevSubCreated || sub.created
                );

                if (destSub) {
                  prevSubCreated = destSub.created;
                  _.set(sub, `data.${path}`, {_id: destSub._id});
                }
              };
            }
          }
        }
      });

      if (this.skipCurrentUpsert) {
        return;
      }

      this.setCollection(srcForm, srcProject, destProject);

      if (destForm && !this.options.updateExisting) {
        srcForm.title = `${destForm.title} (Clone)`;
        srcForm.name = `${destForm.name}-clone`;
        srcForm.path = `${destForm.path}-clone`;
      }

      srcForm.project = destProject._id;

      await this.migrateFormAccess(srcForm);
    }, async(srcForm, destForm) => {
      const decryptKey = _.get(srcProject, 'settings.secret', null);
      await this.cloneSubmissions(srcForm, destForm, decryptKey, submissionsMutate);
      await this.cloneActions(srcForm, destForm);
      await this.cloneFormRevisions(srcForm, destForm);
      this.encryptedFields = [];
    }, (srcForm) => {
      const query = {
        name: this.getCloneFieldRegExp(srcForm.name),
      };
      if (!this.oss && destProject) {
        query.project = destProject._id;
      }
      return query;
    },
    // Clone resources first
    {type: -1});
  }

  async cloneRoles(srcProject, destProject) {
    process.stdout.write('\n');
    process.stdout.write('   - Roles:');
    await this.upsertAll('roles', this.projectQuery(srcProject), (role) => {
      role.project = destProject._id;
    });
  }

  async cloneTags(srcProject, destProject) {
    process.stdout.write('\n');
    process.stdout.write('   - Tags:');
    await this.upsertAll('tags', this.projectQuery(srcProject), (tag) => {
      tag.project = destProject._id;
    });
  }

  async cloneFormRevisions(srcForm, destForm) {
    process.stdout.write('\n');
    process.stdout.write('   - Revisions:');
    const query = this.itemQuery({
      _rid: srcForm._id,
      project: srcForm.project
    });
    await this.upsertAll('formrevisions', query, (srcRevision, dstRevision) => {
      // If the revision already exists in the destination, don't upsert it
      if (dstRevision) {
        this.skipCurrentUpsert = true;
        return;
      }
      srcRevision._rid = destForm._id;
      srcRevision.project = destForm.project;
    }, null, (current) => {
      return {
        project: destForm.project,
        _rid: destForm._id,
        _vid: current._vid
      };
    });
  }

  async cloneAllSubmissions() {
    process.stdout.write('\n');
    process.stdout.write(`Cloning submissions from ${this.sourceProject} to ${this.options.dstProject}.`);
    process.stdout.write('\n');
    if (!this.options.dstProject) {
      return console.log('You must provide a destination project. --dst-project=<project_id>');
    }

    if (!this.sourceProject) {
      return console.log('You must provide a source project. --src-project=<project_id>');
    }

    // Load the source project.
    const srcProj = await this.src.projects.findOne({_id: new ObjectId(this.sourceProject)});

    // Load the destination project.
    const destProj = await this.dest.projects.findOne({_id: new ObjectId(this.options.dstProject)});

    // Iterate through each form.
    this.each('dest.forms', this.query({
      project: new ObjectId(this.options.dstProject)
    }), async(destForm) => {
      // Find the equivalent form in the source project.
      const srcForm = await this.src.forms.findOne({
        project: new ObjectId(this.sourceProject),
        name: destForm.name
      });
      if (!srcForm) {
        return;
      }
      this.setCollection(srcForm, srcProj, destProj);
      console.log('');
      if (this.options.deleteSubmissions) {
        console.log(`Deleting submissions from ${destForm.title}`);
        await this.dest.submissions.deleteMany(this.itemQuery({
          project: destForm.project,
          form: destForm._id
        }));
      }
      await this.cloneSubmissions(srcForm, destForm);
    });
  }

  /**
   * Migrate a roles array to use destination roles instead of source roles.
   * @param {*} roles - An array of role ids that need to be migrated.
   */
  migrateRoles(roles) {
    if (roles && roles.length) {
      roles.forEach((roleId, roleIndex) => {
        const srcRole = this.srcRoles.find((role) => role._id.toString() === roleId.toString());
        if (!srcRole) {
          return;
        }
        const roleTitle = srcRole.title;
        const dstRole = this.destRoles.find((role) => role.title === roleTitle);
        if (!dstRole || !dstRole._id) {
          return;
        }
        roles[roleIndex] = new ObjectId(dstRole._id.toString());
      });
    }
  }

  /**
   * Migrate access array to use destination roles instead of source roles.
   * @param {*} access - An access array.
   */
  migrateAccess(access) {
    if (access && access.length) {
      access.forEach((roleAccess) => this.migrateRoles(roleAccess.roles));
    }
  }

  /**
   * Migrate the form access to use destination roles instead of source roles.
   * @param {*} item
   */
  async migrateFormAccess(item) {
    this.migrateAccess(item.access);
    this.migrateAccess(item.submissionAccess);
  }

  /**
   * Migrate the project settings from one project encryption to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   */
  async migrateSettings(srcProject, destProject) {
    if (
      !srcProject ||
      !destProject ||
      !srcProject.settings ||
      !this.options.srcDbSecret ||
      !this.options.dstDbSecret ||
      this.createNew
    ) {
      return;
    }
    const srcSettings = this.decrypt(this.options.srcDbSecret, srcProject.settings);
    destProject.settings = this.encrypt(this.options.dstDbSecret, srcSettings);
  }

  /**
   * Clone the project from one database to another.
   */
  async cloneProject() {
    process.stdout.write('\n');
    process.stdout.write('Fetching formio project owner.');
    const formioProject = await this.findLast({name: this.getCloneFieldRegExp('formio')});
    const formioOwner = formioProject ? formioProject.owner : null;
    await this.upsertAll('projects', this.projectQuery(), async(srcProject, destProject) => {
      if (!srcProject) {
        process.stdout.write('\n');
        process.stdout.write(`- Cloning Open Source deployment to ${this.options.dstProject}:`);
        return;
      }
      process.stdout.write('\n');
      process.stdout.write(`- Project ${srcProject.title}:`);

      if (this.createNewProject && destProject) {
        await this.cloneRoles(srcProject, destProject);
      }
      // Set the source and destination roles for this project.
      this.srcRoles = await this.findLast('src.roles', {project: srcProject._id});
      this.destRoles = destProject ? await this.findLast('dest.roles', {project: destProject._id}) : [];

      if (this.createNewProject) {
        if (srcProject.type === 'stage') {
          // If the user tries to create clone of a project from stage
          process.stdout.write('\n');
          process.stdout.write('Creating a clone of a project from stage is not allowed.');
          process.exit();
        }

        if (destProject) {
          srcProject.title = `${destProject.title} (Clone)`;
          srcProject.name = `${destProject.name}-clone`;
        }

        if (formioOwner) {
          srcProject.owner = formioOwner;
        }

        // Migrate the settings.
        await this.migrateSettings(srcProject, destProject);
        await this.migrateFormAccess(srcProject);

        // Keep the team access.
        if (srcProject.access) {
          let newAccess = [];
          srcProject.access.forEach((access) => {
            if (access.type.indexOf('team_') === -1) {
              newAccess.push(access);
            }
          });
          if (destProject) {
            destProject.access.forEach((access) => {
              if (access.type.indexOf('team_') === 0) {
                newAccess.push(access);
              }
            });
          }
          srcProject.access = newAccess;
        }
      }
    }, async(srcProject, destProject) => {
      // Do not include the formio project unless specifically specified.
      if (
        (srcProject && srcProject.name === 'formio') &&
        (this.sourceProject !== srcProject._id.toString())
      ) {
        return;
      }
      await this.cloneForms(srcProject, destProject);
      await this.cloneTags(srcProject, destProject);
      // Clone forms that had missing destination dependencies
      if (this.formsWithMissingDeps.length) {
        const missingFormsQuery = _.assign(this.projectQuery(srcProject), {
          _id: {$in: this.formsWithMissingDeps}
        });
        await this.cloneForms(srcProject, destProject, missingFormsQuery);
        this.formsWithMissingDeps = [];
      }
    }, (srcProject) => {
      return {
        name: this.getCloneFieldRegExp(srcProject.name)
      };
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
    if (this.options.submissionsOnly) {
      // Clone only the submissions.
      await this.cloneAllSubmissions();
    }
    else {
      // Clone the entire project.
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
  }
}

module.exports = Cloner;
