'use strict';

const fs = require('fs');
const PDFParser = require('pdf2json');
const Formio = require('formio-service');

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

  let pdf = null;
  let pdfParser = null;
  try {
    pdf = fs.readFileSync(pdfFile);
    pdfParser = new PDFParser();
  }
  catch (err) {
    return done(err.message);
  }

  const getPDFSchema = function(form, done) {
    // load the pdfFile
    pdfParser.loadPDF(pdfFile);
    pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
    // wait to read the stream
    pdfParser.on("pdfParser_dataReady", pdfData => {
      // TODO get all keys that exists in a form to check it when updating

      // form.components = [];
      //   {
      //     label: 'FIRST_NAME',
      //     key: 'FIRST_NAME',
      //     input: true,
      //     overlay: {
      //       page: 1,
      //       top: (13.416 * base) + (1.292 * base), // top: 218,   // 13.416,
      //       left: 4.227 * base, // left: 154,  // 4.227,
      //       width: 4.541 * base, // width: 165, // 4.541,
      //       height: 1.292 * base // height: 27, // 1.292
      //     },
      //     type: 'textfield'
      //   }
      // ];
      // done();
      // return;

      const components = [];

      try{
        // get all fields for all the pages
        // this is where fields will exists for each page
        pdfData.formImage.Pages.forEach( (page, key) =>{
          // lets inject each field on this page

          // conversion base to pixel
          const base = 28.5; // 1 pdf unit = 28.5 pixels
          const shiftDimensionsBy = 0.9;
          
          // move from index 0
          const pageNumber = key + 1;
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
            const shiftDimensionsBy = 0.5;
            
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
          // push final components
          form.components = components.concat(form.components);
        });
        // done
        done(null, form.components);
      }catch(e){
        console.log(e);
      }
      // stream end
    });
  };

  // Load the form JSON.
  const form = (new options.formio.Form(dest));
  form.load().then(function (form) {
    getPDFSchema(form.form, (err, schema) => {
      if (err) {
        return done(err.message);
      }

      // final setup
      // if(action === 'create'){
      //   form.components = components; // .concat(form.components);
      // }
      console.log('pre-processed');
      // if(action == 'update'){
        form.form.components = schema; // .concat(form.form.components);
      // }
      console.log('processed');

      // console.log(form);


      // console.log(formInstance);
      // console.log(schema);
      form.save().then((err, save) => {
        console.log('saved');
        if (err) {
          return done(err.message);
        }
        done();
        // done(null, 'Successfully updated');
      }, err => console.log).catch( err => console.log );
    });
  });
};
