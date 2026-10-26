/**
 * pnpm dataset:validate
 * Checks catalog integrity, dataset-shape targets, label isolation, split
 * leakage, synthetic-PII rules and that generated files match a fresh run.
 */
import { loadCatalog, readText } from '../dataset/io.js';
import { validateDataset } from '../dataset/validate.js';
import { DATASET_PATHS } from '../paths.js';

const { catalog, text } = loadCatalog();
const report = validateDataset(catalog, {
  catalogText: text,
  requestsText: readText(DATASET_PATHS.requests),
  labelsText: readText(DATASET_PATHS.labels),
  groupsText: readText(DATASET_PATHS.groups),
  splitsText: readText(DATASET_PATHS.splits),
  manifestText: readText(DATASET_PATHS.manifest),
});

console.log(JSON.stringify(report.stats, null, 2));
for (const warning of report.warnings) console.warn(`warning: ${warning}`);
if (report.errors.length > 0) {
  for (const error of report.errors) console.error(`error: ${error}`);
  console.error(`\nDataset validation FAILED with ${report.errors.length} error(s).`);
  process.exit(1);
}
console.log('\nDataset validation passed.');
