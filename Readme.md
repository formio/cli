The Form.io Command Line Interface
=================================
This project is the command line interface for Form.io, which allows you to quickly bootstrap full working projects as
well as interface with the Form.io API.

Official Documentation
--------------------------
For the latest documentation, release information, and guides, always refer to the official Form.io Help Documentation available here:

**[https://help.form.io](https://help.form.io/dev/cli-tool#introduction)**

Installation
-------------------
Installation is easy... Simply type the following in your command line.

```
npm install -g @formio/cli
```

The CLI requires Node.js 22.12.0 or newer.

### Upgrading from 2.x
Version 3.0 requires Node.js 22.12.0 or newer, and uses version 7 of the MongoDB Node.js driver, so check that the
MongoDB servers you clone from and to are supported by it. See the [Changelog](Changelog.md) for everything that
changed. If an earlier version cloned encrypted data with the wrong secret, or into custom submission collections,
see [Rekey](#rekey) and [Clone Encrypted Data](#clone-encrypted-data).

Commands
-------------

### Migrate

> **Deprecated:** the ```migrate``` command prints a warning, and will be removed in a future release. Use
> [Clone](#clone) to copy a project between databases, and [Deploy](#deploy) to copy forms and resources between
> servers.

    formio migrate <source> [<transformer>] <destination> --src-key [SOURCE_API_KEY] --dst-key [DESTINATION_API_KEY]

   The migrate command allows you to migrate submission data from one source to another using a simple command. You can either migrate data from a CSV into a form, or from a form into another form. This works by taking the data from ```<source>```, sending it through a middleware function called ```<transformer>``` (which you provide) that transforms the data into the correct format, and then saving that data as a submission into the ```<destination>``` form. If you are migrating data from one form to the same form within two different projects, you will just provide ```form``` as your transform and your command would be as follows.

    formio migrate <source> form <destination> --src-key [SOURCE_API_KEY] --dst-key [DESTINATION_API_KEY]

   As an example, if you wish to move submission data from one form in a project to your remotely deployed project. You can use the following command.

    formio migrate https://myproject.form.io/myform form https://formio.mydomain.com/myproject/myform --src-key abc1234 --dst-key cde2468

  Where you would replace the domains of your from and to, but also need to replace the ```src-key``` and ```dst-key``` with the API Keys from the from project and API key of your destination project respectively.

#### Migrating an entire project
  You can also migrate an entire project by using the "project" transform as follows.

    formio migrate https://myproject.form.io project https://forms.mydomain.com/myproject --src-key=abc1234 --dst-key=cde2468

#### Migrating from CSV
In many cases, you may wish to migrate data from a local CSV file into a project submission table. This requires the transform middleware where you will map the columns of your CSV file into the Submission data going into Form.io.

   Example: Let's suppose you have the following CSV file of data.

   ***import.csv***
   ```
   First Name, Last Name, Email
   Joe, Smith, joe@example.com
   Jane, Thompson, jane@example.com
   Terry, Jones, terry@example.com
   ```
   And now you wish to import all of that data into a form. You can create the transform file like the following.

   ***transform.js***
   ```
   var header = true;
   module.exports = function(record, next) {
     if (header) {
       // Ignore the header row.
       header = false;
       return next();
     }
     next(null, {
       data: {
         firstName: record[0],
         lastName: record[1],
         email: record[2]
       }
     });
   };
   ```

   This transform middleware file can be a complete Node.js middleware method and works asynchronously so if you need to perform asynchronous behavior, you can do that by only calling the ```next``` function when the record is ready.

   You can now migrate that data into your form with the following command.

    formio migrate import.csv transform.js https://myproject.form.io/myform --key [YOUR_API_KEY]

#### Migrate and Delete
In many cases, when you migrate, you may wish to delete previous submissions during the migration phase. You can do this by adding the following option to your command.

```
--delete-previous
```

For example, the following will perform a migration and delete any previous migration records during the migration.

```
formio migrate https://myproject.form.io project https://forms.mydomain.com/myproject --src-key=abc1234 --dst-key=cde2468 --delete-previous
```

#### Migrate and Delete Before and After
You can also provide a window of records that should be deleted using the ```--delete-after``` and ```--delete-before``` flags. The values should be in the format ```2022-05-30T12:00:00.000Z```.  For example, if you wish to migrate your data, but also remove any records before 2022-05-30T09:00:00.000Z and 2022-05-30T12:00:00.000Z, you would provide the following command.

```
formio migrate https://myproject.form.io project https://forms.mydomain.com/myproject --src-key=abc1234 --dst-key=cde2468 --delete-after=2022-05-30T09:00:00.000Z --delete-before=2022-05-30T12:00:00.000Z --delete-previous
```

### Clone

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID]

   Clones a project from one database into another, and includes all forms, submissions, and every other resources within the project. This command
   also retains any _id's from the source database.
   
### Clone Options

   | Option | What it does |
   | --- | --- |
   | ```-s, --src-project <ids>``` | The source project id, or a comma separated list of them. |
   | ```-d, --dst-project <id>``` | The destination project to clone into. |
   | ```-p, --project <id>``` | Used as both the source and the destination project id. |
   | ```--forms <ids>``` | Only clone these form ids. |
   | ```--exclude <ids>``` | Skip these form ids, and their submissions. |
   | ```-o, --submissions-only``` | Only clone submissions, leaving the forms of the destination alone. |
   | ```-f, --delete-submissions``` | Delete the destination submissions of a form before cloning it. |
   | ```-a, --all``` | Include deleted items. |
   | ```--deleted-after <ms>``` | Also include items deleted after this UNIX timestamp, in milliseconds. |
   | ```--created-after <ms>``` | Only clone items created after this UNIX timestamp, in milliseconds. |
   | ```--modified-after <ms>``` | Only clone items modified after this UNIX timestamp, in milliseconds. |
   | ```--include-form-revisions``` | Also clone form revisions. |
   | ```--include-submission-revisions``` | Also clone submission revisions. |
   | ```-u, --update-existing``` | Update the projects and forms the destination already has (the default). |
   | ```--no-update-existing``` | Leave the projects and forms the destination already has untouched. |
   | ```--update-existing-submissions``` | Also update submissions that already exist in the destination. |
   | ```--dry-run``` | Change nothing, report what is missing from the destination or out of date there. |
   | ```--extra``` | With ```--dry-run```, list the records themselves, not only the counts. |
   | ```--batch-size <n>``` | Documents written at a time, and how often the resume point is saved (1000). |
   | ```--max-batch-bytes <n>``` | Bytes of documents held in memory before writing them out (8388608). |
   | ```--src-ca / --dst-ca <file>``` | The TLS certificate authority of the source / destination. |
   | ```--src-cert / --dst-cert <file>``` | The TLS certificate key file of the source / destination. |
   | ```--src-db-secret / --dst-db-secret``` | The DB_SECRET of the source / destination, for encrypted settings and fields. |
   | ```--api-source``` | The source is an API url rather than a mongo connection string. |
   | ```-k, --key <key>``` | The API key used to read from an API source. |
   | ```-l, --limit <n>``` | How many records to request from the API at a time (1000). |

### Clone Multiple Projects

   It is also possible to clone multiple projects at the same time by providing a comma separated list of the project ids, like this.
   
    formio clone <source_db> <destination_db> --src-project=234234234234,345345345345345,45456456456456

### Clone only records created after a certain date

   You can also clone only the records that have been created after a certain UNIX timestamp, in milliseconds. This is useful if you wish to perform multiple migrations and only wish to clone records since the last clone command was called.
   
    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --created-after=1717200000000

### Clone Submissions

    formio clone -o <source_db> <destination_db> --src-project=[PROJECT_ID]

   This command only clones the submissions from one environment to another.

### Clone only records deleted after a certain date

   By default deleted records are skipped. ```--deleted-after``` additionally includes the records that were
   deleted after the provided UNIX timestamp (in milliseconds), while ```--all``` includes every deleted record.

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --deleted-after=1717200000000

### Clone Dry Run

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --dry-run

   Changes nothing. It compares every submission of the source against the destination and reports what has not
   arrived intact, a line per project and per form, ending with the totals:

```
project myproject (61051ac21bbda812c36dcbe8)
  contactform (614484c56b5bd13268625b8b)
    3 missing, 12 out of date

Dry run complete. No changes were made to the destination.
  missing from the destination : 3
  out of date                  : 12
```

   The comparison covers every record of every form, not only the ones a clone would write, so it reports records an
   earlier clone skipped even when they are older than the last record it cloned. Only the ids and the timestamps are
   read, so it is quick and safe to run against forms holding large files.

   Add ```--extra``` to list the records themselves: ```Created``` for one the destination does not have,
   ```Updated``` for one that is there but is not the version the source holds, and ```Extra``` for one that only the
   destination has.

```
project myproject (61051ac21bbda812c36dcbe8)
  contactform (614484c56b5bd13268625b8b)
    Created 5e7e0e1a0f0e4e0001c6f0a1 form=614484c56b5bd13268625b8b
    Updated 5e7e0e1a0f0e4e0001c6f0a3 form=614484c56b5bd13268625b8b
    1 missing, 1 out of date, 0 only in the destination
```

   Everything goes to stdout, so redirect it if you want to keep it:

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --dry-run --extra > audit.txt

   A project that was asked for but is not in the source is named, rather than quietly skipped.

### Clone Progress

   Every project and form shows its position (```- Form: Contact (…) [12/340]```), and the submissions of
   each form show a progress bar with the rate and the time left:

```
- Project Customer Portal: [1/1]
   - Roles: 3
   - Form: Contact (65f1…) [12/340]
      - Submissions: [##########--------------] 41% 41,200/100,000 1,830/s ETA 32s
      - Actions: 2
```

   In a terminal the bar is redrawn in place, at most ten times a second however fast the clone runs. When the
   output goes to a file or a pipe, a progress line is written every 30 seconds instead. The totals come from a
   count of what is left to clone; when a count takes more than 2 seconds (no index for it), the clone stops
   counting and shows a running count instead. A dry run shows no progress.

### Clone Performance

   Documents are written to the destination in batches of 1000, which can be changed with ```--batch-size```. The
   same number controls how often the clone state is saved, so a smaller batch resumes more precisely after an
   interruption, and a larger batch writes faster.

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --batch-size=5000

   Memory does not grow with the size of the database. The clone holds at most one batch of documents
   at a time, capped both by ```--batch-size``` (1000 documents) and by ```--max-batch-bytes```
   (8 MB), whichever comes first. Lower ```--max-batch-bytes``` if the submissions carry large files:

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --max-batch-bytes=2097152

   With ```--update-existing-submissions```, the source is first read with only the timestamps that decide
   whether a submission changed, and the data of a submission is read only when it is going to be written.
   Re-running a clone where little has changed therefore reads almost nothing, however large the submissions are.

   For large clones, make sure these indexes exist, otherwise Mongo sorts the submissions in memory:

```
// On the source database
db.submissions.createIndex({form: 1, project: 1, created: 1});
db.submissionrevisions.createIndex({_rid: 1});

// On the destination database
db.submissions.createIndex({form: 1, project: 1, created: -1});
```

   The clone keeps a ```clonestate.json``` file in the current directory, saved after every batch that is written,
   so a clone that is interrupted (Ctrl+C), terminated or even killed outright continues from the last batch that
   was written the next time it is run. A clone that finishes removes the file. Delete it to start over.

### Clone Encrypted Data

   Give the ```DB_SECRET``` of both servers when the projects have encrypted settings or encrypted fields:

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --src-db-secret=[SOURCE_SECRET] --dst-db-secret=[DESTINATION_SECRET]

   The project settings are re-encrypted with the destination ```DB_SECRET```. The values of encrypted fields,
   including the ones within the rows of a datagrid or an editgrid and within containers, are re-encrypted with the
   secret the destination server reads them with: the ```secret``` of the project settings, or the destination
   ```DB_SECRET``` when the project has none. When both secrets are the same, everything is copied as it is. A value
   that cannot be decrypted with the source secret is reported and left as it is.

   If a clone was already run with the wrong ```--dst-db-secret```, use [Rekey](#rekey) to fix the destination
   rather than cloning again.

   Forms with their own submission collection are cloned to the collection the server reads them from. The server
   strips everything but letters and digits from the project name and the collection, so the submissions of the
   ```records``` collection of the ```my-project``` project are in ```myproject_records```, and their revisions in
   ```myproject_records_revisions```. Versions before 3.0 used the names as they are (```my-project_records```), where
   the server never reads them. The clone warns when the destination still has submissions there; those collections
   can be dropped once the clone is done.

### When a clone fails

   A clone that could not write everything it read exits with an error naming how many documents were lost, and
   keeps its ```clonestate.json``` so that running it again retries from the last document that was actually
   written, including documents older than ones that did arrive. It never reports success for data that did not
   arrive. Documents that already exist in the destination (the same ```_id```) are not a failure: they are simply
   not cloned again. A document that conflicts
   with a different destination document on another unique index is a failure.

   Projects and forms are written as soon as they are cloned. When one cannot be written, nothing within it (its
   roles, forms, actions or submissions) is cloned, so the destination never holds submissions of a form it does
   not have.

   A document that cannot be cloned (bad data, or a hook that throws) is reported and skipped, the rest of the
   clone carries on, and the clone exits with an error at the end. The same programming error on several documents
   in a row stops the clone straight away.

   When ```--src-db-secret``` and ```--dst-db-secret``` differ, project settings are re-encrypted for the
   destination. The settings a destination project already has are never replaced. A project whose settings cannot
   be decrypted (a wrong secret) is not created in the destination, and the clone exits with an error naming it.
   Running it again with the same secrets will not help: check the secrets first.

   Resuming a clone with ```--delete-submissions``` deletes the destination submissions of the form it stopped in
   and clones all of them again, rather than continuing from where it stopped.

### Resuming and Updating

   By default the clone updates the projects and forms of the destination that have changed in the source. Use
   ```--no-update-existing``` to leave everything that already exists in the destination untouched, and
   ```--update-existing-submissions``` to also update submissions that already exist in the destination.

    formio clone <source_db> <destination_db> --src-project=[PROJECT_ID] --update-existing-submissions

### Rekey

    formio rekey <mongo_db> --new-db-secret=[NEW_SECRET] --old-db-secret=[OLD_SECRET] [--old-db-secret=[ANOTHER_OLD_SECRET]]

   Re-encrypts the project settings and the encrypted submission data of a database with a new ```DB_SECRET```, for
   example after a clone was run with the wrong ```--dst-db-secret```.

   The project settings are encrypted with the ```DB_SECRET```. Encrypted submission data is encrypted with the
   ```secret``` of its project settings or, when the project has none, with the ```DB_SECRET```. Every value is
   first tried with the secret it should be encrypted with, and left alone when it already is. Otherwise each of
   the old secrets is tried, and the value is re-encrypted and read back before it is written. Give every secret
   the data may be encrypted with: after a clone that is both the wrong destination secret and the source secret.

   | Option | What it does |
   | --- | --- |
   | ```--new-db-secret <secret>``` | The ```DB_SECRET``` the database should be encrypted with (required). |
   | ```--old-db-secret <secret>``` | A secret the data may currently be encrypted with. Give it more than once to try several. |
   | ```-p, --project <ids>``` | Only re-key these projects (comma separated). All projects by default. |
   | ```--dry-run``` | Change nothing. Report how much would be re-keyed, and what cannot be decrypted. |
   | ```--no-submission-revisions``` | Leave the submission revisions alone. |
   | ```--batch-size <size>``` | The number of documents written at a time (default 1000). |
   | ```--ca <file>```, ```--cert <file>``` | The TLS certificate authority and certificate key file for the connection, absolute or relative to the working directory. |

   For example, to fix a destination that was cloned with the wrong secret, after a dry run:

    formio rekey <mongo_db> --new-db-secret=[DESTINATION_SECRET] --old-db-secret=[WRONG_SECRET] --old-db-secret=[SOURCE_SECRET] --dry-run

   Back up the database, and stop the servers that use it, before re-keying: a server running with the wrong
   secret keeps writing data encrypted with it. Start with a ```--dry-run```.

   The submissions of forms with their own collection are re-keyed too, and so are the submissions and revisions
   that versions of the clone before 3.0 left in misnamed collections or in the default ```submissionrevisions```
   collection. Those are re-keyed where they are, and the command says where they should be.

   Values none of the secrets can decrypt are listed and left as they are, and the command exits with an error.
   A project whose settings cannot be decrypted is skipped entirely, because the secret of its data is in those
   settings. A document that changes while it is being re-keyed is never overwritten. Values that are already
   encrypted with the new secret are skipped, so the command can be stopped and run again as often as needed.

### Deploy

   ```
   formio deploy [src] [dst]
   ```

   You can deploy a project on a paid plan on form.io to a hosted server with this command or deploy a project from an open source server to an enterprise project. Specify the source and destination servers and the project will be created or updated on the destination server.

   Examples:

   ```
   // A project without a server is implied from https://form.io
   formio deploy myproject http://myproject.localhost:3000

   // Projects can be specified with a subdomain.
   formio deploy https://myproject.form.io http://myproject.localhost:3000

   // Projects can also be referred to with their project id which will need to be looked up.
   formio deploy https://form.io/project/{projectId} http://localhost:3000/project/{projectId}
   
   // Forms and Resources from an open source server can be deployed to an enterprise project by using the following command
   // This will copy all your forms and resources from the open source formio server to the enterprise project
   formio deploy <openSourceServerDomain> <enterpriseServerDomain>/<projectAlias> --src-key <openSourceServerX-Token> --dst-key <enterpriseServerX-Token>
   formio deploy http://localhost:3001 http://localhost:3000/pfcelycsrkqjccq --src-key 123 --dst-key 456 
   ```

   Each server will require authentication so you will need to add an API Key to each of the projects.  
   Documentation on how to do that can be found here: https://help.form.io/userguide/projects/project-settings#api-settings  
   For adding an API Key to the open source server you will need to set the environment variable API_KEYS. You can view our formio README if you need help on how to do this https://github.com/formio/formio/blob/master/README.md


### Copy

```
formio copy form [src] [dest]
```

This command will copy the components of a form into another form. **This will overwrite all components within the destination form if that form exists**.
You can also chain together multiple source forms which will aggregate the components of those forms into the destination form.

Examples:

```
// Copy a form from one project to another.
formio copy form https://myapp.form.io/myform https://myotherapp.form.io/myform

// Aggregate multiple forms into the same form.
formio copy form https://myapp.form.io/form1,https://myapp.form.io/form2 https://myapp.form.io/allforms
```

### Submissions

```
formio submissions <form_url> [each]
```

Reads the submissions of a form. Without ```[each]``` they are written to the terminal as a JSON array, after a
```RESULT:``` prefix. With it, ```[each]``` is the path, relative to the working directory, of a Node.js module that
exports a function, which is called with ```(submission, index, options, next)``` for every submission.

| Option | What it does |
| --- | --- |
| ```--key <key>``` | The API key of the project. |
| ```--admin-key <key>``` | The admin API key of the server. |

Examples:

```
// Write the submissions of a form to the terminal.
formio submissions https://myproject.form.io/myform --key abc1234

// Hand each submission to a script.
formio submissions https://myproject.form.io/myform each.js --key abc1234
```

Development
-------------

The project uses Yarn 4 through Corepack:

```
corepack enable
yarn install
```

| Command | What it runs |
| --- | --- |
| ```yarn lint``` | ESLint. |
| ```yarn test:cli``` | The command line parsing tests. They need nothing else. |
| ```yarn test:cloner``` | The clone and rekey tests, against a MongoDB container started with Docker on port 27018. |
| ```yarn test``` | The CLI tests, then the end to end tests against two Form.io Enterprise API servers started with Docker. These need a valid Form.io Enterprise license in the ```LICENSE_KEY``` environment variable. |

The clone tests do not need a license key. They cover every clone flag, the dry run output, resuming an interrupted
clone, cloning from an API source (served by a stub API), and the rekey command, against a real MongoDB database. To
run them against a MongoDB of your own, set ```CLONER_TEST_SRC``` and ```CLONER_TEST_DST``` to the connection strings
of two throw-away databases and run ```yarn mocha ./test/cloner/index.js -t 60000 --exit```.
