// Department normalization utility (backend)
// Mirrors frontend normalization in plangenie/src/config/departments.ts

const DEFAULT_DEPARTMENTS = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'sales', label: 'Sales' },
  { key: 'operations', label: 'Operations' },
  { key: 'finance', label: 'Finance' },
  { key: 'peopleHR', label: 'Human Resources' },
  { key: 'partnerships', label: 'Partnerships' },
  { key: 'technology', label: 'Technology' },
  { key: 'sustainability', label: 'Sustainability' },
];

const DEFAULT_DEPT_KEYS = DEFAULT_DEPARTMENTS.map((d) => d.key);

const LEGACY_KEY_MAP = {
  'Central (Executive View)': 'executive',
  'Central Executive': 'executive',
  centralExecutive: 'executive',
  centralExecutiveView: 'executive',
  financeAdmin: 'finance',
  'Finance & Admin': 'finance',
  'Finance and Admin': 'finance',
  communityImpact: 'sustainability',
  'Community Impact': 'sustainability',
  peopleHR: 'peopleHR',
  'People and Culture': 'peopleHR',
  'Human Resources': 'peopleHR',
  'Partnerships and Alliances': 'partnerships',
  'Technology and Infrastructure': 'technology',
};

function normalizeDepartmentKey(input) {
  if (!input) return '';
  const trimmed = String(input).trim();

  if (LEGACY_KEY_MAP[trimmed]) return LEGACY_KEY_MAP[trimmed];
  if (DEFAULT_DEPT_KEYS.includes(trimmed)) return trimmed;

  const matchByLabel = DEFAULT_DEPARTMENTS.find(
    (d) => d.label.toLowerCase() === trimmed.toLowerCase()
  );
  if (matchByLabel) return matchByLabel.key;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+(.)/g, (_, ch) => ch.toUpperCase())
    .replace(/\s/g, '');

  if (['centralExecutive', 'centralExecutiveView', 'executive'].includes(normalized)) return 'executive';

  return normalized;
}

module.exports = { normalizeDepartmentKey };
