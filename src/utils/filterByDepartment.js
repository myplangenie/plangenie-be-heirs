/**
 * Department filtering utilities for collaborator access control
 */

const VALID_DEPARTMENTS = [
  'marketing',
  'sales',
  'operations',
  'financeAdmin',
  'peopleHR',
  'partnerships',
  'technology',
  'communityImpact',
];

/**
 * Check if user has restricted department access
 */
function hasDepartmentRestriction(user) {
  return user?.viewOnly && user?.accessType === 'department' && Array.isArray(user?.allowedDepartments) && user.allowedDepartments.length > 0;
}

/**
 * Filter action assignments/plans object by allowed departments
 * actionAssignments: { marketing: [...], sales: [...], ... }
 */
function filterActionAssignments(actionAssignments, allowedDepartments) {
  if (!actionAssignments || typeof actionAssignments !== 'object') return actionAssignments;
  if (!Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return actionAssignments;

  return Object.fromEntries(
    Object.entries(actionAssignments).filter(([key]) => allowedDepartments.includes(key))
  );
}

/**
 * Filter org structure array by department
 * org: [{ department: 'marketing', roles: [...] }, ...]
 */
function filterOrg(org, allowedDepartments) {
  if (!Array.isArray(org)) return org;
  if (!Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return org;

  return org.filter((item) => allowedDepartments.includes(item?.department));
}

/**
 * Filter departments array
 * departments: ['marketing', 'sales', ...]
 */
function filterDepartments(departments, allowedDepartments) {
  if (!Array.isArray(departments)) return departments;
  if (!Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return departments;

  return departments.filter((dept) => allowedDepartments.includes(dept));
}

/**
 * Filter team members by department
 * teamMembers: [{ department: 'marketing', name: '...' }, ...]
 */
function filterTeamMembers(teamMembers, allowedDepartments) {
  if (!Array.isArray(teamMembers)) return teamMembers;
  if (!Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return teamMembers;

  return teamMembers.filter((member) => allowedDepartments.includes(member?.department));
}

/**
 * Filter core project details by department
 * coreProjectDetails: { marketing: {...}, sales: {...}, ... }
 */
function filterCoreProjectDetails(coreProjectDetails, allowedDepartments) {
  if (!coreProjectDetails || typeof coreProjectDetails !== 'object') return coreProjectDetails;
  if (!Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return coreProjectDetails;

  return Object.fromEntries(
    Object.entries(coreProjectDetails).filter(([key]) => allowedDepartments.includes(key))
  );
}

/**
 * Apply department filtering to a compiled plan object
 */
function filterCompiledPlan(plan, allowedDepartments) {
  if (!plan || !Array.isArray(allowedDepartments) || allowedDepartments.length === 0) return plan;

  return {
    ...plan,
    actionPlans: filterActionAssignments(plan.actionPlans, allowedDepartments),
    org: filterOrg(plan.org, allowedDepartments),
    coreProjectDetails: filterCoreProjectDetails(plan.coreProjectDetails, allowedDepartments),
  };
}

module.exports = {
  VALID_DEPARTMENTS,
  hasDepartmentRestriction,
  filterActionAssignments,
  filterOrg,
  filterDepartments,
  filterTeamMembers,
  filterCoreProjectDetails,
  filterCompiledPlan,
};
