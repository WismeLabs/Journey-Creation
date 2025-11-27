const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// Initialize AJV with strict mode and all formats
const ajv = new Ajv({ 
  allErrors: true, 
  strict: false,  // Allow additional properties for flexibility
  verbose: true 
});
addFormats(ajv);

// Load schemas
const conceptsSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../schemas/concepts.schema.json'), 'utf8')
);
const episodePlanSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../schemas/episode_plan.schema.json'), 'utf8')
);

// Compile validators
const validateConcepts = ajv.compile(conceptsSchema);
const validateEpisodePlan = ajv.compile(episodePlanSchema);

/**
 * Validate concept extraction output
 * @param {Object} data - Concepts data to validate
 * @returns {Object} { valid: boolean, errors: array|null }
 */
function validateConceptsOutput(data) {
  const valid = validateConcepts(data);
  
  if (!valid) {
    logger.error({
      action: 'schema_validation_failed',
      schema: 'concepts',
      errors: validateConcepts.errors,
      errorCount: validateConcepts.errors.length
    });
    
    return {
      valid: false,
      errors: formatValidationErrors(validateConcepts.errors)
    };
  }
  
  logger.info({
    action: 'schema_validation_passed',
    schema: 'concepts',
    conceptCount: data.concepts?.length || 0
  });
  
  return { valid: true, errors: null };
}

/**
 * Validate episode plan output
 * @param {Object} data - Episode plan data to validate
 * @returns {Object} { valid: boolean, errors: array|null }
 */
function validateEpisodePlanOutput(data) {
  const valid = validateEpisodePlan(data);
  
  if (!valid) {
    logger.error({
      action: 'schema_validation_failed',
      schema: 'episode_plan',
      errors: validateEpisodePlan.errors,
      errorCount: validateEpisodePlan.errors.length
    });
    
    return {
      valid: false,
      errors: formatValidationErrors(validateEpisodePlan.errors)
    };
  }
  
  logger.info({
    action: 'schema_validation_passed',
    schema: 'episode_plan',
    episodeCount: data.episodes?.length || 0
  });
  
  return { valid: true, errors: null };
}

/**
 * Format AJV validation errors into human-readable messages
 * @param {Array} errors - AJV errors array
 * @returns {Array} Formatted error messages
 */
function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) return [];
  
  return errors.map(err => {
    const path = err.instancePath || err.dataPath || '/';
    const message = err.message || 'Unknown error';
    const params = err.params ? JSON.stringify(err.params) : '';
    
    return {
      path,
      message,
      keyword: err.keyword,
      params: err.params,
      formatted: `${path}: ${message} ${params}`.trim()
    };
  });
}

/**
 * Get detailed validation report with suggestions
 * @param {Object} result - Validation result from validateConceptsOutput or validateEpisodePlanOutput
 * @param {string} schemaName - Name of the schema for error messages
 * @returns {string} Human-readable validation report
 */
function getValidationReport(result, schemaName) {
  if (result.valid) {
    return `✅ ${schemaName} validation passed`;
  }
  
  const errorList = result.errors.map(e => `  - ${e.formatted}`).join('\n');
  
  return `❌ ${schemaName} validation failed with ${result.errors.length} error(s):\n${errorList}\n\nPlease check the LLM output and prompt to ensure it matches the expected schema.`;
}

module.exports = {
  validateConceptsOutput,
  validateEpisodePlanOutput,
  formatValidationErrors,
  getValidationReport
};
