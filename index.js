/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const _ = require('lodash');
const JsonRefs = require('json-refs');
const YAML = require('js-yaml');
const helpers = require('./lib/helpers');
const ApiDefinition = require('./lib/types/api-definition');
require('native-promise-only'); // Load promises polyfill if necessary

/**
 * A library that simplifies [OpenAPI](https://www.openapis.org/) integrations.
 *
 * @module sway
 */

/**
 * Creates an ApiDefinition object from the provided OpenAPI definition.
 *
 * @param {module:sway.CreateOptions} options - The options for loading the definition(s)
 *
 * @returns {Promise<module:sway.ApiDefinition>} The promise
 *
 * @example
 * Sway.create({
 *   definition: 'https://raw.githubusercontent.com/OAI/OpenAPI-Specification/master/examples/v3.0/petstore.yaml'
 * })
 * .then(function (apiDefinition) {
 *   console.log('Documentation URL: ', apiDefinition.documentationUrl);
 * }, function (err) {
 *   console.error(err.stack);
 * });
 */
function create(options) {
  let allTasks = Promise.resolve();

  // Validate arguments
  allTasks = allTasks.then(() => new Promise((resolve) => {
    if (_.isUndefined(options)) {
      throw new TypeError('options is required');
    } else if (!_.isPlainObject(options)) {
      throw new TypeError('options must be an object');
    } else if (_.isUndefined(options.definition)) {
      throw new TypeError('options.definition is required');
    } else if (!_.isPlainObject(options.definition) && !_.isString(options.definition)) {
      throw new TypeError('options.definition must be either an object or a string');
    } else if (!_.isUndefined(options.jsonRefs) && !_.isPlainObject(options.jsonRefs)) {
      throw new TypeError('options.jsonRefs must be an object');
    } else if (!_.isUndefined(options.customFormats) && !_.isArray(options.customFormats)) {
      throw new TypeError('options.customFormats must be an array');
    } else if (!_.isUndefined(options.customFormatGenerators) && !_.isArray(options.customFormatGenerators)) {
      throw new TypeError('options.customFormatGenerators must be an array');
    } else if (!_.isUndefined(options.customValidators) && !_.isArray(options.customValidators)) {
      throw new TypeError('options.customValidators must be an array');
    }

    helpers.validateOptionsAllAreFunctions(options.customFormats, 'customFormats');
    helpers.validateOptionsAllAreFunctions(options.customFormatGenerators, 'customFormatGenerators');
    helpers.validateOptionsAllAreFunctions(options.customValidators, 'customValidators');

    resolve();
  }));

  // Make a copy of the input options so as not to alter them
  const cOptions = _.cloneDeep(options);

  //
  allTasks = allTasks
    // Resolve relative/remote references
    .then(() => {
      // Prepare the json-refs options
      if (_.isUndefined(cOptions.jsonRefs)) {
        cOptions.jsonRefs = {};
      }

      // Include invalid reference information
      cOptions.jsonRefs.includeInvalid = true;

      // Resolve only relative/remote references
      cOptions.jsonRefs.filter = ['relative', 'remote'];

      // Update the json-refs options to process YAML
      if (_.isUndefined(cOptions.jsonRefs.loaderOptions)) {
        cOptions.jsonRefs.loaderOptions = {};
      }

      if (_.isUndefined(cOptions.jsonRefs.loaderOptions.processContent)) {
        cOptions.jsonRefs.loaderOptions.processContent = (res, cb) => {
          cb(undefined, YAML.load(res.text));
        };
      }

      // Call the appropriate json-refs API
      if (_.isString(cOptions.definition)) {
        return JsonRefs.resolveRefsAt(cOptions.definition, cOptions.jsonRefs);
      }
      return JsonRefs.resolveRefs(cOptions.definition, cOptions.jsonRefs);
    })
    // Resolve local references and merge results
    .then((remoteResults) => {
      // Resolve local references (Remote references should had already been resolved)
      cOptions.jsonRefs.filter = 'local';

      return JsonRefs.resolveRefs(remoteResults.resolved || cOptions.definition, cOptions.jsonRefs)
        .then((results) => {
          _.each(remoteResults.refs, (refDetails, refPtr) => {
            results.refs[refPtr] = refDetails;
          });

          return {
            // The original OpenAPI definition
            definition: _.isString(cOptions.definition) ? remoteResults.value : cOptions.definition,
            // The original OpenAPI definition with its remote references resolved
            definitionRemotesResolved: remoteResults.resolved,
            // The original OpenAPI definition with all its references resolved
            definitionFullyResolved: results.resolved,
            // Merge the local reference details with the remote reference details
            refs: results.refs,
          };
        });
    })
    // Process the OpenAPI document and return an ApiDefinition
    .then((results) => {
      // We need to remove all circular objects as z-schema does not work with them:
      //   https://github.com/zaggino/z-schema/issues/137
      helpers.removeCirculars(results.definition);
      helpers.removeCirculars(results.definitionRemotesResolved);
      helpers.removeCirculars(results.definitionFullyResolved);

      // Create object model
      return new ApiDefinition(
        results.definition,
        results.definitionRemotesResolved,
        results.definitionFullyResolved,
        results.refs,
        options,
      );
    });

  return allTasks;
}

module.exports.create = create;
