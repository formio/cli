'use strict';
module.exports = {
  textFormFirstSrc : {
    title: 'textForm',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'textField',
        type: 'textfield',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textForm1',
    path: 'textform1',

  },

  textFormSecondSrc : {
    title: 'textForm2',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'textField',
        type: 'textfield',
        input: true
      },
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'secondField',
        type: 'textfield',
        input: true
      },
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'thirdField',
        type: 'textfield',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textForm2',
    path: 'textform2'

  },

  textFormThirdSrc : {
    title: 'textForm3',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'textField',
        type: 'textfield',
        input: true
      },
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'secondField',
        type: 'textfield',
        input: true
      },
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'thirdField',
        type: 'textfield',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textForm3',
    path: 'textform3',

  },

  textFormFirstDst : {
    title: 'textForm',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'textField',
        type: 'textfield',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textFormDst',
    path: 'textformDst',

  },

  textFormSrcResource : {
    title: 'textForm',
    display: 'form',
    type: 'resource',
    components: [
      {
        label: 'Text Field',
        applyMaskOn: 'change',
        tableView: true,
        key: 'textField',
        type: 'textfield',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textFormSrcResource',
    path: 'textformsrcresource',

  },

  textFormDstResource : {
    title: 'textForm',
    display: 'form',
    type: 'resource',
    components: [
      {
        label: 'Select',
        widget: 'choicesjs',
        tableView: true,
        key: 'select',
        type: 'select',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textFormDstResource',
    path: 'textformdstresource',

  },

  textFormFirstDst2 : {
    title: 'textForm',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Select',
        widget: 'choicesjs',
        tableView: true,
        key: 'select',
        type: 'select',
        input: true
      },
      {
        type: 'button',
        label: 'Submit',
        key: 'submit',
        disableOnInvalid: true,
        input: true,
        tableView: false
      }
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'textFormDst2',
    path: 'textformDst2',

  },

  submissionFirst : {
    data: {
      textField: '1',
      submit: true
    },
    metadata: {
      timezone: 'Europe/Minsk',
      offset: 180,
      origin: 'http://localhost:3000',
      referrer: 'http://localhost:3000/',
      browserName: 'Netscape',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      pathName: '/',
      onLine: true
    },
    state: 'submitted',
    created: Date.parse(new Date(2011, 0, 2)),
    _vnote: ''

  },

  submissionSecond : {
    data: {
      textField: '2',
      submit: true
    },
    metadata: {
      timezone: 'Europe/Minsk',
      offset: 180,
      origin: 'http://localhost:3000',
      referrer: 'http://localhost:3000/',
      browserName: 'Netscape',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      pathName: '/',
      onLine: true
    },
    state: 'submitted',
    _vnote: ''

  },

  submissionThird : {
    data: {
      textField: '3',
      submit: true
    },
    metadata: {
      timezone: 'Europe/Minsk',
      offset: 180,
      origin: 'http://localhost:3000',
      referrer: 'http://localhost:3000/',
      browserName: 'Netscape',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      pathName: '/',
      onLine: true
    },
    state: 'submitted',

    _vnote: ''

  },

  formCopyChainSrc : {
    title: 'textForm',
    display: 'form',
    type: 'form',
    'components': [
      {
        input: true,
        tableView: false,
        key: 'validationStatus',
        label: 'Validation Status',
        protected: true,
        unique: false,
        persistent: true,
        type: 'hidden'
      },
      {
        validate: {
          required: true
        },
        type: 'email',
        persistent: true,
        unique: false,
        protected: false,
        defaultValue: '',
        suffix: '',
        prefix: '',
        placeholder: 'Enter an email for a contact for this project',
        key: 'contactEmail',
        label: 'Contact Email',
        inputType: 'email',
        tableView: true,
        input: true
      },

    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'formCopyChainSrc',
    path: 'formcopychainsrc',

  },

  formDeployCheck : {
    title: 'formDeployCheck',
    display: 'form',
    type: 'form',
    'components': [
      {
        input: true,
        tableView: false,
        key: 'validationStatus',
        label: 'Validation Status',
        protected: true,
        unique: false,
        persistent: true,
        type: 'hidden'
      },

    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'formDeployCheck',
    path: 'formdeploycheck',

  },

  formCopyChainDst : {
    title: 'formCopyChainDst',
    display: 'form',
    type: 'form',
    components: [
      {
        label: 'Select',
        widget: 'choicesjs',
        tableView: true,
        key: 'select',
        type: 'select',
        input: true
      },
    ],
    access: [],
    submissionAccess: [],
    controller: '',
    properties: {},
    settings: {},
    builder: false,
    name: 'formCopyChainDst',
    path: 'formcopychaindst',

  },

};
