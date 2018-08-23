'use strict';
const PDFParser = require('pdf2json');
const Formio = require('formio-service');
const Chance = require('chance');
const chance = new Chance();
const _ = require('lodash');

module.exports = function(options, done) {
  var action = options.params[0];
  var pdfFile = options.params[1];
  var dest = options.params[2];

  if (!action) {
    return done('You must provide an action (create, update).');
  }

  if ( ( action === 'update' || action === 'create') === false ){
    return done('create and update are only currently supported.');
  }

  if (!pdfFile) {
    return done('You must provide a source pdf file.');
  }

  if (!dest) {
    return done('You must provide a destination.');
  }

  const getPDFSchema = function(done) {
    const pdfParser = new PDFParser();
    pdfParser.loadPDF(pdfFile);
    pdfParser.on("pdfParser_dataError", errData => done(errData.parserError));
    // wait to read the stream
    pdfParser.on("pdfParser_dataReady", pdfData => {
      // TODO get all keys that exists in a form to check it when updating
      const components = [];

      try{
        // get all fields for all the pages
        // this is where fields will exists for each page
        pdfData.formImage.Pages.forEach( (page, key) =>{
          // lets inject each field on this page

          // conversion base to pixel
          const base = 28.5; // 1 pdf unit = 28.5 pixels
          const shiftDimensionsBy = 0.9; // change of shift
          
          // move from index 0
          const pageNumber = key + 1;
          // FIXME classify each input type method
          // run the text inputs
          page.Fields.forEach((field, index) => {

            // if(!field){
            //   console.log('>>> not a field :: ', field);
            //   return;
            // }

            let width = parseFloat((field.w * base).toFixed(4));
            let height = parseFloat((field.h * base).toFixed(4));
            // 90% for alignment
            width = width * shiftDimensionsBy;
            height = height * shiftDimensionsBy;
            // key
            const fieldId = field.id.Id.replace(/\s+/g, '_').toLowerCase();
            // check if it exists
            const label = field.TU ? field.TU:field.id.Id;
            // build the form component
            let component = {
              label: label,
              key: fieldId, // need to make it a key
              type: 'textfield', // default
              // inputType: 'textfield', // default
              input: true, // TODO this could be false in some cases on PDF
              overlay: {
                page: pageNumber,
                top: parseFloat(((field.y * base) ).toFixed(4)),
                left: parseFloat((field.x * base).toFixed(4)),
                width: width,
                height: height
              }
            };
            
            // try {
            //   // for Dropdown
            //   if(field.PL){
            //     // createFormComponentDropdown(field);
            //   }
            // }catch(e){
            //   console.log('Page : ', page,'Field > ', field,e);
            // }

            // add component
            components.push(component);
          });

          // run the checkboxes
          page.Boxsets.forEach((set) => {

            // conversion base to pixel
            const base = 28.5; // 1 pdf unit = 28.5 pixels
            const shiftDimensionsBy = 0.5; // change of shift
            
            set.boxes.forEach( (field) => {

              // if (!field) {
              //   console.log('>>> not a field :: ', field);
              //   return;
              // }

              let width = parseFloat((field.w * base).toFixed(4));
              let height = parseFloat((field.h * base).toFixed(4));
              // 90% for alignment
              width = width * shiftDimensionsBy;
              height = height * shiftDimensionsBy;
              // key
              const fieldId = field.id.Id.replace(/\s+/g, '_').toLowerCase();
              // check if it exists
              const label = field.TU ? field.TU : field.id.Id;
              // build the form component
              let component = {
                label: label,
                key: fieldId, // need to make it a key
                type: 'checkbox', // default
                // inputType: 'textfield', // default
                input: true, // TODO this could be false in some cases on PDF
                overlay: {
                  page: pageNumber,
                  top: parseFloat(((field.y * base)).toFixed(4)),
                  left: parseFloat((field.x * base).toFixed(4)),
                  width: width,
                  height: height
                }
              };
              // add component
              components.push(component);
            });
          });
        });
        // done
        done(null, components);
      }catch(e){
        console.log(e);
      }
      // stream end
    });
  };

  /**
   * Either get a new form object, or an existing form to update.
   *
   * @param cb
   * @return {*}
   */
  const getForm = function(cb) {
    let form = null;
    if (action === 'create') {
      form = (new options.formio.Form(`${dest}/form`));
      const num = chance.integer({min: 0, max: 99999});
      form.form = {
        title: `PDF${num}`,
        name: `pdf${num}`,
        path: `pdf${num}`,
        components: []
      };
      return cb(form);
    }
    else if (action === 'update') {
      form = (new options.formio.Form(dest));
      form.load().then(() => cb(form));
    }
  };

  // Load the form JSON.
  getForm((form) => {
    getPDFSchema((err, components) => {
      if (err) {
        return done(err.message || err);
      }

      form.form.components = components;
      const formOp = (action === 'create') ? form.create(form.form) : form.save();
      formOp.then((err) => done()).catch(done);
    });
  });
};
